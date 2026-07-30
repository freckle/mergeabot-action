import { vi, type Mock } from "vitest";

import type { GitHubClient } from "./client.js";

export type MockedGitHubClient = {
  [K in keyof GitHubClient]: Mock<GitHubClient[K]>;
};

export function fakeClient(
  overrides: Partial<GitHubClient> = {},
): MockedGitHubClient {
  const defaults: GitHubClient = {
    listPrFiles: async () => [],
    listRequestedReviewers: async () => ({ users: [], teams: [] }),
    removeRequestedReviewers: async () => undefined,
    requestReviewers: async () => undefined,
    createComment: async () => undefined,
    listCommentBodies: async () => [],
    searchQuarantinedPrs: async () => [],
    searchBotPrStatuses: async () => [],
    getFileContent: async () => null,
    enableAutoMerge: async () => undefined,
    approve: async () => undefined,
  };
  const merged = { ...defaults, ...overrides };

  return {
    listPrFiles: vi.fn(merged.listPrFiles),
    listRequestedReviewers: vi.fn(merged.listRequestedReviewers),
    removeRequestedReviewers: vi.fn(merged.removeRequestedReviewers),
    requestReviewers: vi.fn(merged.requestReviewers),
    createComment: vi.fn(merged.createComment),
    listCommentBodies: vi.fn(merged.listCommentBodies),
    searchQuarantinedPrs: vi.fn(merged.searchQuarantinedPrs),
    searchBotPrStatuses: vi.fn(merged.searchBotPrStatuses),
    getFileContent: vi.fn(merged.getFileContent),
    enableAutoMerge: vi.fn(merged.enableAutoMerge),
    approve: vi.fn(merged.approve),
  };
}
