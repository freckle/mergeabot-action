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

interface RequestedReviewers {
  users: string[];
  teams: string[];
}

export interface BotPrStatus {
  number: number;
  hasReviewRequest: boolean;
  hasFailingStatus: boolean;
}

export interface GitHubClient {
  listPrFiles(prNumber: number): Promise<string[]>;
  listRequestedReviewers(prNumber: number): Promise<RequestedReviewers>;
  removeRequestedReviewers(
    prNumber: number,
    reviewers: string[],
    teamReviewers: string[],
  ): Promise<void>;
  requestReviewers(
    prNumber: number,
    reviewers: string[],
    teamReviewers: string[],
  ): Promise<void>;
  createComment(issueNumber: number, body: string): Promise<void>;
  listCommentBodies(issueNumber: number): Promise<string[]>;
  searchQuarantinedPrs(query: string): Promise<QuarantinedPr[]>;
  searchBotPrStatuses(query: string): Promise<BotPrStatus[]>;
  // null when the file doesn't exist.
  getFileContent(path: string): Promise<string | null>;
  enableAutoMerge(pullRequestId: string, strategy: Strategy): Promise<void>;
  approve(prNumber: number): Promise<void>;
}
