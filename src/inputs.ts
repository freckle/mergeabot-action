import * as core from "@actions/core";

export type Strategy = "merge" | "rebase" | "squash";

export interface Inputs {
  excludeTitleRegex: RegExp | null;
  quarantineDays: number;
  strategy: Strategy;
  removeReviewers: boolean;
  botAuthors: string[];
  escalate: boolean;
  escalationFallbackTeam: string;
  escalationTeamPrefix: string;
  codeownersPath: string;
  actor: string;
  owner: string;
  repo: string;
  token: string;
  dryRun: boolean;
}

export interface RawInputs {
  excludeTitleRegex: string;
  quarantineDays: string;
  strategy: string;
  removeReviewers: boolean;
  botAuthors: string[];
  escalate: boolean;
  escalationFallbackTeam: string;
  escalationTeamPrefix: string;
  codeownersPath: string;
  actor: string;
  repository: string;
  token: string;
  dryRun: boolean;
}

export function parseInputs(raw: RawInputs): Inputs {
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
    escalate: raw.escalate,
    escalationFallbackTeam: raw.escalationFallbackTeam,
    escalationTeamPrefix: raw.escalationTeamPrefix,
    codeownersPath: raw.codeownersPath,
    actor: raw.actor,
    owner,
    repo,
    token: raw.token,
    dryRun: raw.dryRun,
  };
}

export function getInputs(): Inputs {
  return parseInputs({
    excludeTitleRegex: core.getInput("exclude-title-regex"),
    quarantineDays: core.getInput("quarantine-days", { required: true }),
    strategy: core.getInput("strategy", { required: true }),
    removeReviewers: core.getBooleanInput("remove-reviewers", {
      required: true,
    }),
    botAuthors: core.getMultilineInput("bot-authors", { required: true }),
    escalate: core.getBooleanInput("escalate", { required: true }),
    // No { required: true }: this input's default is empty, which getInput
    // would reject (as with exclude-title-regex).
    escalationFallbackTeam: core.getInput("escalation-fallback-team"),
    escalationTeamPrefix: core.getInput("escalation-team-prefix", {
      required: true,
    }),
    codeownersPath: core.getInput("codeowners-path", { required: true }),
    actor: core.getInput("github-actor", { required: true }),
    repository: core.getInput("github-repository", { required: true }),
    token: core.getInput("github-token", { required: true }),
    dryRun: core.getBooleanInput("dry-run", { required: true }),
  });
}
