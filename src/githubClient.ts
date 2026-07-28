import * as github from "@actions/github";

import type { Strategy } from "./config.js";
import type { GithubClient, QuarantinedPr } from "./client.js";

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
      reviewDecision: string | null;
    }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export function createGithubClient(
  token: string,
  owner: string,
  repo: string,
  octokitOptions?: OctokitOptions,
): GithubClient {
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

    async createComment(issueNumber, body) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });
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
