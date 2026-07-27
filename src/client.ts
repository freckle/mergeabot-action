import type { Strategy } from "./config.js";

export interface QuarantinedPr {
  id: string;
  number: number;
  title: string;
  createdAt: string;
  reviewDecision: string | null;
}

export interface RequestedReviewers {
  users: string[];
  teams: string[];
}

export interface GithubClient {
  listPrFiles(prNumber: number): Promise<string[]>;
  listRequestedReviewers(prNumber: number): Promise<RequestedReviewers>;
  removeRequestedReviewers(
    prNumber: number,
    reviewers: string[],
    teamReviewers: string[],
  ): Promise<void>;
  createComment(issueNumber: number, body: string): Promise<void>;
  searchQuarantinedPrs(query: string): Promise<QuarantinedPr[]>;
  enableAutoMerge(pullRequestId: string, strategy: Strategy): Promise<void>;
  approve(prNumber: number): Promise<void>;
}
