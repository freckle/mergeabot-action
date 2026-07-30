import * as github from "@actions/github";

import type { Strategy } from "./inputs.js";
import type {
  BotPrStatus,
  GitHubClient,
  QuarantinedPr,
  ReviewDecision,
} from "./client.js";

type OctokitOptions = Parameters<typeof github.getOctokit>[1];

// type: ISSUE (the default/legacy search backend) silently ignores explicit
// "OR" in the query string -- it just returns zero results. ISSUE_ADVANCED is
// the search type that actually supports it.
const SEARCH_QUERY = `
  query ($searchQuery: String!, $after: String) {
    search(query: $searchQuery, type: ISSUE_ADVANCED, first: 100, after: $after) {
      nodes {
        ... on PullRequest {
          id
          number
          title
          createdAt
          reviewDecision
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const BOT_PR_STATUS_QUERY = `
  query ($searchQuery: String!, $after: String) {
    search(query: $searchQuery, type: ISSUE_ADVANCED, first: 100, after: $after) {
      nodes {
        ... on PullRequest {
          number
          reviewRequests {
            totalCount
          }
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  state
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const ENABLE_AUTO_MERGE_MUTATION = `
  mutation ($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
    enablePullRequestAutoMerge(
      input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }
    ) {
      clientMutationId
    }
  }
`;

const MERGE_METHODS: Record<Strategy, "MERGE" | "REBASE" | "SQUASH"> = {
  merge: "MERGE",
  rebase: "REBASE",
  squash: "SQUASH",
};

const SEARCH_RESULT_LIMIT = 1000;

interface SearchPage<TNode> {
  search: {
    nodes: TNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

type SearchNode = {
  id: string;
  number: number;
  title: string;
  createdAt: string;
  reviewDecision: ReviewDecision;
};

type BotPrStatusNode = {
  number: number;
  reviewRequests: { totalCount: number };
  commits: {
    nodes: { commit: { statusCheckRollup: { state: string } | null } }[];
  };
};

const FAILING_ROLLUP_STATES = ["ERROR", "FAILURE"];

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  );
}

export function createGitHubClient(
  token: string,
  owner: string,
  repo: string,
  octokitOptions?: OctokitOptions,
): GitHubClient {
  const octokit = github.getOctokit(token, octokitOptions);

  // Shared by every search method below: page through `query`/`searchQuery`
  // via GraphQL, mapping each node, and stop at SEARCH_RESULT_LIMIT.
  async function paginateSearch<TNode, TItem>(
    query: string,
    searchQuery: string,
    mapNode: (node: TNode) => TItem,
  ): Promise<TItem[]> {
    const items: TItem[] = [];
    let after: string | null = null;

    do {
      const response: SearchPage<TNode> = await octokit.graphql(query, {
        searchQuery,
        after,
      });

      for (const node of response.search.nodes) {
        items.push(mapNode(node));
      }

      after = response.search.pageInfo.hasNextPage
        ? response.search.pageInfo.endCursor
        : null;
    } while (after !== null && items.length < SEARCH_RESULT_LIMIT);

    return items.slice(0, SEARCH_RESULT_LIMIT);
  }

  return {
    async listPrFiles(prNumber) {
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: prNumber,
      });
      return files.map((file) => file.filename);
    },

    async listRequestedReviewers(prNumber) {
      const { data } = await octokit.rest.pulls.listRequestedReviewers({
        owner,
        repo,
        pull_number: prNumber,
      });
      return {
        users: data.users.map((user) => user.login),
        teams: data.teams.map((team) => team.slug),
      };
    },

    async removeRequestedReviewers(prNumber, reviewers, teamReviewers) {
      await octokit.rest.pulls.removeRequestedReviewers({
        owner,
        repo,
        pull_number: prNumber,
        reviewers,
        team_reviewers: teamReviewers,
      });
    },

    async requestReviewers(prNumber, reviewers, teamReviewers) {
      await octokit.rest.pulls.requestReviewers({
        owner,
        repo,
        pull_number: prNumber,
        reviewers,
        team_reviewers: teamReviewers,
      });
    },

    async createComment(issueNumber, body) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });
    },

    async listCommentBodies(issueNumber) {
      const comments = await octokit.paginate(
        octokit.rest.issues.listComments,
        {
          owner,
          repo,
          issue_number: issueNumber,
        },
      );
      return comments.map((comment) => comment.body ?? "");
    },

    async searchQuarantinedPrs(searchQuery) {
      return paginateSearch<SearchNode, QuarantinedPr>(
        SEARCH_QUERY,
        searchQuery,
        (node) => ({
          id: node.id,
          number: node.number,
          title: node.title,
          createdAt: node.createdAt,
          reviewDecision: node.reviewDecision,
        }),
      );
    },

    async searchBotPrStatuses(searchQuery) {
      return paginateSearch<BotPrStatusNode, BotPrStatus>(
        BOT_PR_STATUS_QUERY,
        searchQuery,
        (node) => ({
          number: node.number,
          hasReviewRequest: node.reviewRequests.totalCount > 0,
          hasFailingStatus: FAILING_ROLLUP_STATES.includes(
            node.commits.nodes[0]?.commit.statusCheckRollup?.state ?? "",
          ),
        }),
      );
    },

    async getFileContent(path) {
      try {
        // The raw media type returns the file body as a string, which octokit's
        // types (which describe the JSON response) don't reflect.
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
          mediaType: { format: "raw" },
        });
        return data as unknown as string;
      } catch (error: unknown) {
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },

    async enableAutoMerge(pullRequestId, strategy) {
      await octokit.graphql(ENABLE_AUTO_MERGE_MUTATION, {
        pullRequestId,
        mergeMethod: MERGE_METHODS[strategy],
      });
    },

    async approve(prNumber) {
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        event: "APPROVE",
      });
    },
  };
}
