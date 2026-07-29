import type { Strategy } from "./inputs.js";

export type ReviewDecision =
  "CHANGES_REQUESTED" | "APPROVED" | "REVIEW_REQUIRED" | null;

export interface QuarantinedPr {
  id: string;
  number: number;
  title: string;
  createdAt: string;
  reviewDecision: ReviewDecision;
}

export interface RequestedReviewers {
  users: string[];
  teams: string[];
}

export interface GitHubClient {
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
