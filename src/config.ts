export type Strategy = "merge" | "rebase" | "squash";

export interface Config {
  excludeTitleRegex: RegExp | null;
  quarantineDays: number;
  strategy: Strategy;
  removeReviewers: boolean;
  botAuthors: string[];
  actor: string;
  owner: string;
  repo: string;
  token: string;
  dryRun: boolean;
}

export interface RawConfig {
  excludeTitleRegex: string;
  quarantineDays: string;
  strategy: string;
  removeReviewers: boolean;
  botAuthors: string[];
  actor: string;
  repository: string;
  token: string;
  dryRun: string;
}

export function parseConfig(raw: RawConfig): Config {
  const strategy = raw.strategy.trim();
  if (strategy !== "merge" && strategy !== "rebase" && strategy !== "squash") {
    throw new Error(
      `Invalid strategy: must be merge, rebase, or squash (got "${raw.strategy}")`,
    );
  }

  const [owner, repo] = raw.repository.split("/");
  if (!owner || !repo) {
    throw new Error(
      `Invalid github-repository: expected "owner/repo", got "${raw.repository}"`,
    );
  }

  return {
    excludeTitleRegex: raw.excludeTitleRegex
      ? new RegExp(raw.excludeTitleRegex)
      : null,
    quarantineDays: Number(raw.quarantineDays),
    strategy,
    removeReviewers: raw.removeReviewers,
    botAuthors: raw.botAuthors,
    actor: raw.actor,
    owner,
    repo,
    token: raw.token,
    dryRun: Number(raw.dryRun) !== 0,
  };
}
