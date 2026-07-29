import * as core from "@actions/core";

import type { Inputs } from "./inputs.js";
import type { EventContext } from "./context.js";
import type { GitHubClient } from "./client.js";
import {
  isBotPrEvent,
  isExcludedByTitle,
  touchesWorkflows,
} from "./predicates.js";
import { buildSearchQuery } from "./search.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function describeWhen(quarantineDays: number, now: number): string {
  if (quarantineDays <= 0) {
    return "the next time it runs";
  }
  const until = formatDate(now + quarantineDays * DAY_MS);
  return `after ${quarantineDays} day(s), on ${until}`;
}

async function handleBotPrEvent(
  inputs: Inputs,
  context: EventContext,
  client: GitHubClient,
  now: number,
): Promise<boolean> {
  const title = context.prTitle ?? "";
  const number = context.prNumber;

  if (isExcludedByTitle(title, inputs.excludeTitleRegex)) {
    return false;
  }

  if (number === undefined) {
    return false;
  }

  if (touchesWorkflows(await client.listPrFiles(number))) {
    return false;
  }

  if (context.prAction === "opened") {
    // dry-run only gates the scan loop's merge/approve calls below, not these
    // -- removing reviewers and commenting were never gated in the original
    // bash either.
    if (inputs.removeReviewers) {
      const { users, teams } = await client.listRequestedReviewers(number);
      if (users.length > 0 || teams.length > 0) {
        core.info("Removing requested reviewers");
        await client.removeRequestedReviewers(number, users, teams);
      }
    }

    const whenMessage = describeWhen(inputs.quarantineDays, now);
    const body = `:heavy_check_mark: If all status checks pass, and no other reviews are submitted, [mergeabot][] will merge this PR ${whenMessage}.

As long as that's OK, no other action is necessary.

[mergeabot]: https://github.com/freckle/mergeabot-action`;

    await client.createComment(number, body);
  }

  return true;
}

async function scanForQuarantinedPrs(
  inputs: Inputs,
  client: GitHubClient,
  now: number,
): Promise<void> {
  const since = formatDate(now - inputs.quarantineDays * DAY_MS);
  const query = buildSearchQuery(
    inputs.owner,
    inputs.repo,
    inputs.botAuthors,
    since,
  );
  const prs = await client.searchQuarantinedPrs(query);

  for (const pr of prs) {
    core.info(`${pr.title} (#${pr.number})`);
    core.info(`  Created at: ${pr.createdAt}`);
    core.info(`  Current review decision: ${pr.reviewDecision}`);

    if (isExcludedByTitle(pr.title, inputs.excludeTitleRegex)) {
      core.info("  => Skip (title matches exclude-title-regex)");
      continue;
    }

    if (touchesWorkflows(await client.listPrFiles(pr.number))) {
      core.info("  => Skip (PR updates workflows)");
      continue;
    }

    switch (pr.reviewDecision) {
      case "CHANGES_REQUESTED":
        core.info("  => Skip (changes requested)");
        break;

      case "APPROVED":
        core.info("  => Enable auto-merge");
        if (!inputs.dryRun) {
          await client.enableAutoMerge(pr.id, inputs.strategy);
        }
        break;

      default:
        core.info("  => Enable auto-merge and approve");
        if (!inputs.dryRun) {
          await client.enableAutoMerge(pr.id, inputs.strategy);
          await client.approve(pr.number);
        }
        break;
    }
  }

  if (prs.length === 0) {
    core.info(`No bot PRs found older than ${since}.`);
  }
}

export async function run(
  inputs: Inputs,
  context: EventContext,
  client: GitHubClient,
  now: number = Date.now(),
): Promise<void> {
  if (isBotPrEvent(context.eventName, inputs.actor, inputs.botAuthors)) {
    const handled = await handleBotPrEvent(inputs, context, client, now);
    if (handled) {
      return;
    }
  }

  await scanForQuarantinedPrs(inputs, client, now);
}
