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

interface SearchResponse {
  search: {
    nodes: {
      id: string;
      number: number;
      title: string;
      createdAt: string;
      reviewDecision: ReviewDecision;
    }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface BotPrStatusResponse {
  search: {
    nodes: {
      number: number;
      reviewRequests: { totalCount: number };
      commits: {
        nodes: {
          commit: { statusCheckRollup: { state: string } | null };
        }[];
      };
    }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

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
      const prs: QuarantinedPr[] = [];
      let after: string | null = null;

      do {
        const response: SearchResponse = await octokit.graphql(SEARCH_QUERY, {
          searchQuery,
          after,
        });

        for (const node of response.search.nodes) {
          prs.push({
            id: node.id,
            number: node.number,
            title: node.title,
            createdAt: node.createdAt,
            reviewDecision: node.reviewDecision,
          });
        }

        after = response.search.pageInfo.hasNextPage
          ? response.search.pageInfo.endCursor
          : null;
      } while (after !== null && prs.length < SEARCH_RESULT_LIMIT);

      return prs.slice(0, SEARCH_RESULT_LIMIT);
    },

    async searchBotPrStatuses(searchQuery) {
      const prs: BotPrStatus[] = [];
      let after: string | null = null;

      do {
        const response: BotPrStatusResponse = await octokit.graphql(
          BOT_PR_STATUS_QUERY,
          { searchQuery, after },
        );

        for (const node of response.search.nodes) {
          prs.push({
            number: node.number,
            hasReviewRequest: node.reviewRequests.totalCount > 0,
            hasFailingStatus: FAILING_ROLLUP_STATES.includes(
              node.commits.nodes[0]?.commit.statusCheckRollup?.state ?? "",
            ),
          });
        }

        after = response.search.pageInfo.hasNextPage
          ? response.search.pageInfo.endCursor
          : null;
      } while (after !== null && prs.length < SEARCH_RESULT_LIMIT);

      return prs.slice(0, SEARCH_RESULT_LIMIT);
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
