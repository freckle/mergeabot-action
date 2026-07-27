import * as core from "@actions/core";
import * as github from "@actions/github";

import { parseConfig } from "./config.js";
import { createGithubClient } from "./githubClient.js";
import { run, type EventContext } from "./run.js";

async function main(): Promise<void> {
  const config = parseConfig({
    excludeTitleRegex: core.getInput("exclude-title-regex"),
    quarantineDays: core.getInput("quarantine-days", { required: true }),
    strategy: core.getInput("strategy", { required: true }),
    removeReviewers: core.getBooleanInput("remove-reviewers", {
      required: true,
    }),
    botAuthors: core.getMultilineInput("bot-authors", { required: true }),
    actor: core.getInput("github-actor", { required: true }),
    repository: core.getInput("github-repository", { required: true }),
    token: core.getInput("github-token", { required: true }),
    dryRun: core.getInput("dry-run", { required: true }),
  });

  const context: EventContext = {
    eventName: github.context.eventName,
    prAction: github.context.payload.action,
    prNumber: github.context.payload.number,
    prTitle: github.context.payload.pull_request?.title,
  };

  const client = createGithubClient(config.token, config.owner, config.repo);

  await run(config, context, client);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    core.setFailed(error.message);
  } else if (typeof error === "string") {
    core.setFailed(error);
  } else {
    core.setFailed("Non-Error exception");
  }
});
