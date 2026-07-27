import { describe, expect, it } from "vitest";

import type { Config } from "./config.js";
import type {
  GithubClient,
  QuarantinedPr,
  RequestedReviewers,
} from "./client.js";
import { run, type EventContext } from "./run.js";

const NOW = new Date("2024-06-15T00:00:00Z").getTime();

function config(overrides: Partial<Config> = {}): Config {
  return {
    excludeTitleRegex: null,
    quarantineDays: 5,
    strategy: "rebase",
    removeReviewers: true,
    botAuthors: ["dependabot[bot]", "renovate[bot]"],
    actor: "dependabot[bot]",
    owner: "freckle",
    repo: "mergeabot-action",
    token: "token",
    dryRun: false,
    ...overrides,
  };
}

function fakeClient(overrides: Partial<GithubClient> = {}): GithubClient & {
  calls: Record<string, unknown[][]>;
} {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return fn(...args);
    };

  const defaults: GithubClient = {
    listPrFiles: record(
      "listPrFiles",
      async () => [],
    ) as GithubClient["listPrFiles"],
    listRequestedReviewers: record(
      "listRequestedReviewers",
      async () => ({ users: [], teams: [] }) satisfies RequestedReviewers,
    ) as GithubClient["listRequestedReviewers"],
    removeRequestedReviewers: record(
      "removeRequestedReviewers",
      async () => undefined,
    ) as GithubClient["removeRequestedReviewers"],
    createComment: record(
      "createComment",
      async () => undefined,
    ) as GithubClient["createComment"],
    searchQuarantinedPrs: record(
      "searchQuarantinedPrs",
      async () => [] as QuarantinedPr[],
    ) as GithubClient["searchQuarantinedPrs"],
    enableAutoMerge: record(
      "enableAutoMerge",
      async () => undefined,
    ) as GithubClient["enableAutoMerge"],
    approve: record(
      "approve",
      async () => undefined,
    ) as GithubClient["approve"],
  };

  return { ...defaults, ...overrides, calls };
}

function pr(overrides: Partial<QuarantinedPr> = {}): QuarantinedPr {
  return {
    id: "PR_id",
    number: 1,
    title: "Bump foo from 1.0.0 to 1.0.1",
    createdAt: "2024-01-01T00:00:00Z",
    reviewDecision: null,
    ...overrides,
  };
}

const scheduleContext: EventContext = {
  eventName: "schedule",
  prAction: undefined,
  prNumber: undefined,
  prTitle: undefined,
};

function openedContext(overrides: Partial<EventContext> = {}): EventContext {
  return {
    eventName: "pull_request",
    prAction: "opened",
    prNumber: 42,
    prTitle: "Bump foo from 1.0.0 to 1.0.1",
    ...overrides,
  };
}

describe("run / bot PR events", () => {
  it("removes pending reviewers and comments on an opened bot PR", async () => {
    const client = fakeClient({
      listRequestedReviewers: async () => ({
        users: ["alice"],
        teams: ["team-a"],
      }),
    });

    await run(config(), openedContext(), client, NOW);

    expect(client.calls.removeRequestedReviewers).toEqual([
      [42, ["alice"], ["team-a"]],
    ]);
    expect(client.calls.createComment).toHaveLength(1);
    expect(client.calls.searchQuarantinedPrs).toBeUndefined();
  });

  it("does not remove reviewers when there are none pending", async () => {
    const client = fakeClient();

    await run(config(), openedContext(), client, NOW);

    expect(client.calls.removeRequestedReviewers).toBeUndefined();
    expect(client.calls.createComment).toHaveLength(1);
  });

  it("does not look up reviewers at all when remove-reviewers is false", async () => {
    const client = fakeClient();

    await run(config({ removeReviewers: false }), openedContext(), client, NOW);

    expect(client.calls.listRequestedReviewers).toBeUndefined();
    expect(client.calls.createComment).toHaveLength(1);
  });

  it("says the PR will merge next run when quarantine-days is disabled", async () => {
    const client = fakeClient();

    await run(config({ quarantineDays: -1 }), openedContext(), client, NOW);

    const [, body] = client.calls.createComment[0];
    expect(body).toContain("the next time it runs");
  });

  it("says when the PR will merge when quarantine-days is enabled", async () => {
    const client = fakeClient();

    await run(config({ quarantineDays: 5 }), openedContext(), client, NOW);

    const [, body] = client.calls.createComment[0];
    expect(body).toContain("after 5 day(s), on 2024-06-20");
  });

  it("does not mutate anything in dry-run mode, but still exits early", async () => {
    const client = fakeClient({
      listRequestedReviewers: async () => ({ users: ["alice"], teams: [] }),
    });

    await run(config({ dryRun: true }), openedContext(), client, NOW);

    expect(client.calls.removeRequestedReviewers).toBeUndefined();
    expect(client.calls.createComment).toBeUndefined();
    expect(client.calls.searchQuarantinedPrs).toBeUndefined();
  });

  it("does nothing extra for non-opened actions on a bot PR, besides exiting early", async () => {
    const client = fakeClient();

    await run(
      config(),
      openedContext({ prAction: "synchronize" }),
      client,
      NOW,
    );

    expect(client.calls.createComment).toBeUndefined();
    expect(client.calls.removeRequestedReviewers).toBeUndefined();
    expect(client.calls.searchQuarantinedPrs).toBeUndefined();
  });

  it("falls through to the scan when the bot PR's title is excluded", async () => {
    const client = fakeClient();

    await run(
      config({ excludeTitleRegex: /in \/qa$/ }),
      openedContext({ prTitle: "Bump foo in /qa" }),
      client,
      NOW,
    );

    expect(client.calls.listPrFiles).toBeUndefined();
    expect(client.calls.createComment).toBeUndefined();
    expect(client.calls.searchQuarantinedPrs).toHaveLength(1);
  });

  it("falls through to the scan when the bot PR touches workflow files", async () => {
    const client = fakeClient({
      listPrFiles: async () => [".github/workflows/ci.yml"],
    });

    await run(config(), openedContext(), client, NOW);

    expect(client.calls.createComment).toBeUndefined();
    expect(client.calls.searchQuarantinedPrs).toHaveLength(1);
  });

  it("runs the scan for pull_request events from non-bot actors", async () => {
    const client = fakeClient();

    await run(config({ actor: "some-human" }), openedContext(), client, NOW);

    expect(client.calls.searchQuarantinedPrs).toHaveLength(1);
  });
});

describe("run / scheduled scan", () => {
  it("builds the search query from owner, repo, bot-authors, and quarantine-days", async () => {
    const client = fakeClient();

    await run(config({ quarantineDays: 5 }), scheduleContext, client, NOW);

    expect(client.calls.searchQuarantinedPrs).toEqual([
      [
        "repo:freckle/mergeabot-action is:pr is:open author:app/dependabot updated:<2024-06-10" +
          " OR " +
          "repo:freckle/mergeabot-action is:pr is:open author:app/renovate updated:<2024-06-10",
      ],
    ]);
  });

  it("skips PRs excluded by title", async () => {
    const client = fakeClient({
      searchQuarantinedPrs: async () => [pr({ title: "Bump foo in /qa" })],
    });

    await run(
      config({ excludeTitleRegex: /in \/qa$/ }),
      scheduleContext,
      client,
      NOW,
    );

    expect(client.calls.enableAutoMerge).toBeUndefined();
    expect(client.calls.approve).toBeUndefined();
  });

  it("skips PRs that touch workflow files", async () => {
    const client = fakeClient({
      searchQuarantinedPrs: async () => [pr()],
      listPrFiles: async () => [".github/workflows/ci.yml"],
    });

    await run(config(), scheduleContext, client, NOW);

    expect(client.calls.enableAutoMerge).toBeUndefined();
    expect(client.calls.approve).toBeUndefined();
  });

  it("skips PRs with changes requested", async () => {
    const client = fakeClient({
      searchQuarantinedPrs: async () => [
        pr({ reviewDecision: "CHANGES_REQUESTED" }),
      ],
    });

    await run(config(), scheduleContext, client, NOW);

    expect(client.calls.enableAutoMerge).toBeUndefined();
    expect(client.calls.approve).toBeUndefined();
  });

  it("only enables auto-merge for already-approved PRs", async () => {
    const client = fakeClient({
      searchQuarantinedPrs: async () => [
        pr({ id: "PR_1", reviewDecision: "APPROVED" }),
      ],
    });

    await run(config({ strategy: "squash" }), scheduleContext, client, NOW);

    expect(client.calls.enableAutoMerge).toEqual([["PR_1", "squash"]]);
    expect(client.calls.approve).toBeUndefined();
  });

  it("enables auto-merge and approves PRs with no review decision yet", async () => {
    const client = fakeClient({
      searchQuarantinedPrs: async () => [
        pr({ id: "PR_1", number: 7, reviewDecision: null }),
      ],
    });

    await run(config({ strategy: "merge" }), scheduleContext, client, NOW);

    expect(client.calls.enableAutoMerge).toEqual([["PR_1", "merge"]]);
    expect(client.calls.approve).toEqual([[7]]);
  });

  it("does not mutate anything in dry-run mode", async () => {
    const client = fakeClient({
      searchQuarantinedPrs: async () => [pr({ reviewDecision: "APPROVED" })],
    });

    await run(config({ dryRun: true }), scheduleContext, client, NOW);

    expect(client.calls.enableAutoMerge).toBeUndefined();
    expect(client.calls.approve).toBeUndefined();
  });
});

describe("run / no results", () => {
  it("does not throw when the scan finds nothing", async () => {
    const client = fakeClient();
    await expect(
      run(config(), scheduleContext, client, NOW),
    ).resolves.toBeUndefined();
  });
});
