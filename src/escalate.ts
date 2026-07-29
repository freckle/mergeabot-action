import * as core from "@actions/core";

import type { Inputs } from "./inputs.js";
import type { GitHubClient } from "./client.js";
import {
  parseCodeowners,
  resolveTeamForPaths,
  type CodeownersRule,
} from "./codeowners.js";
import { ESCALATION_MARKER, hasEscalationComment } from "./predicates.js";
import { buildEscalationSearchQuery } from "./search.js";

function escalationCommentBody(): string {
  return `${ESCALATION_MARKER}
This bot PR has failing statuses and cannot auto-merge. It has been re-assigned for human intervention.

If you are the new reviewer, you should:

- [ ] Check for failing statuses and address any (click the status link on this PR for details)
- [ ] Approve the PR`;
}

async function loadCodeowners(
  inputs: Inputs,
  client: GitHubClient,
): Promise<CodeownersRule[]> {
  const content = await client.getFileContent(inputs.codeownersPath);

  if (content === null) {
    core.warning(
      `Could not read ${inputs.codeownersPath}; using fallback team only`,
    );
    return [];
  }

  const rules = parseCodeowners(content, inputs.escalationTeamPrefix);
  core.info(
    `Loaded ${rules.length} CODEOWNERS rule(s) from ${inputs.codeownersPath}`,
  );
  return rules;
}

export async function escalateFailingPrs(
  inputs: Inputs,
  client: GitHubClient,
): Promise<void> {
  const rules = await loadCodeowners(inputs, client);

  const query = buildEscalationSearchQuery(
    inputs.owner,
    inputs.repo,
    inputs.botAuthors,
  );
  const prs = await client.searchBotPrStatuses(query);
  const candidates = prs.filter(
    (pr) => !pr.hasReviewRequest && pr.hasFailingStatus,
  );

  let hadFailure = false;

  for (const pr of candidates) {
    try {
      core.info(`Failing bot PR (#${pr.number})`);

      const files = await client.listPrFiles(pr.number);
      const team = resolveTeamForPaths(
        rules,
        files,
        inputs.escalationFallbackTeam,
      );
      core.info(`  Routed to team: ${team || "<none>"}`);

      if (!team) {
        core.info("  => Skip (no team resolved and no fallback configured)");
        continue;
      }

      if (hasEscalationComment(await client.listCommentBodies(pr.number))) {
        core.info("  => Skip (already escalated)");
        continue;
      }

      if (inputs.dryRun) {
        core.info(
          `  => [dry-run] Would request ${team} and post escalation comment`,
        );
        continue;
      }

      core.info(`  => Requesting review from ${team} and posting comment`);
      await client.requestReviewers(pr.number, [], [team]);
      await client.createComment(pr.number, escalationCommentBody());
    } catch (error: unknown) {
      // One PR's failure (e.g. a token lacking permission to request a team
      // reviewer) shouldn't abort the whole sweep -- keep going, but still
      // fail the run afterwards so the problem isn't silently swallowed.
      hadFailure = true;
      const message = error instanceof Error ? error.message : String(error);
      core.error(`  Failed to escalate #${pr.number}: ${message}`);
    }
  }

  if (prs.length === 0) {
    core.info("No open bot PRs found.");
  } else if (candidates.length === 0) {
    core.info("No failing bot PRs without a reviewer found.");
  }

  if (hadFailure) {
    throw new Error("Failed to escalate some PRs");
  }
}
