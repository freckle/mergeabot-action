import * as core from "@actions/core";

import type { Config } from "./config.js";
import type { GithubClient } from "./client.js";
import {
  isBotPrEvent,
  isExcludedByTitle,
  touchesWorkflows,
} from "./predicates.js";
import { buildSearchQuery } from "./search.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EventContext {
  eventName: string;
  prAction: string | undefined;
  prNumber: number | undefined;
  prTitle: string | undefined;
}

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
  config: Config,
  context: EventContext,
  client: GithubClient,
  now: number,
): Promise<boolean> {
  const title = context.prTitle ?? "";
  const number = context.prNumber;

  if (isExcludedByTitle(title, config.excludeTitleRegex)) {
    return false;
  }

  if (number === undefined) {
    return false;
  }

  if (touchesWorkflows(await client.listPrFiles(number))) {
    return false;
  }

  if (context.prAction === "opened") {
    if (config.removeReviewers) {
      const { users, teams } = await client.listRequestedReviewers(number);
      if (users.length > 0 || teams.length > 0) {
        core.info("Removing requested reviewers");
        if (!config.dryRun) {
          await client.removeRequestedReviewers(number, users, teams);
        }
      }
    }

    const whenMessage = describeWhen(config.quarantineDays, now);
    const body = `:heavy_check_mark: If all status checks pass, and no other reviews are submitted, [mergeabot][] will merge this PR ${whenMessage}.

As long as that's OK, no other action is necessary.

[mergeabot]: https://github.com/freckle/mergeabot-action`;

    if (!config.dryRun) {
      await client.createComment(number, body);
    }
  }

  return true;
}

async function scanForQuarantinedPrs(
  config: Config,
  client: GithubClient,
  now: number,
): Promise<void> {
  const since = formatDate(now - config.quarantineDays * DAY_MS);
  const query = buildSearchQuery(
    config.owner,
    config.repo,
    config.botAuthors,
    since,
  );
  const prs = await client.searchQuarantinedPrs(query);

  for (const pr of prs) {
    core.info(`${pr.title} (#${pr.number})`);
    core.info(`  Created at: ${pr.createdAt}`);
    core.info(`  Current review decision: ${pr.reviewDecision}`);

    if (isExcludedByTitle(pr.title, config.excludeTitleRegex)) {
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
        if (!config.dryRun) {
          await client.enableAutoMerge(pr.id, config.strategy);
        }
        break;

      default:
        core.info("  => Enable auto-merge and approve");
        if (!config.dryRun) {
          await client.enableAutoMerge(pr.id, config.strategy);
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
  config: Config,
  context: EventContext,
  client: GithubClient,
  now: number = Date.now(),
): Promise<void> {
  if (isBotPrEvent(context.eventName, config.actor, config.botAuthors)) {
    const handled = await handleBotPrEvent(config, context, client, now);
    if (handled) {
      return;
    }
  }

  await scanForQuarantinedPrs(config, client, now);
}
