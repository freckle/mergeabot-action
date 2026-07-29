import * as core from "@actions/core";

import { getInputs } from "./inputs.js";
import { getContext } from "./context.js";
import { createGitHubClient } from "./github-client.js";
import { run } from "./run.js";

async function main(): Promise<void> {
  const inputs = getInputs();
  const context = getContext();
  const client = createGitHubClient(inputs.token, inputs.owner, inputs.repo);

  await run(inputs, context, client);
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
