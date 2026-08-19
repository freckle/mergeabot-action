import { describe, expect, it, vi } from "vitest";

import type { Inputs } from "./inputs.js";
import type { EventContext } from "./context.js";
import type { QuarantinedPr } from "./client.js";
import { fakeClient } from "./fake-github-client.js";
import { run } from "./run.js";

const NOW = new Date("2024-06-15T00:00:00Z").getTime();

// Silence logging
vi.mock(import("@actions/core"), () => {
  return {
    info: vi.fn(),
    warning: vi.fn(),
  };
});

function inputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    excludeTitleRegex: null,
    quarantineDays: 5,
    strategy: "rebase",
    removeReviewers: true,
    botAuthors: ["dependabot[bot]", "renovate[bot]"],
    escalate: false,
    escalationFallbackTeam: "",
    escalationTeamPrefix: "team-",
    codeownersPath: ".github/CODEOWNERS",
    escalationCommentSuffix: "",
    actor: "dependabot[bot]",
    owner: "freckle",
    repo: "mergeabot-action",
    token: "token",
    dryRun: false,
    ...overrides,
  };
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

    await run(inputs(), openedContext(), client, NOW);

    expect(client.removeRequestedReviewers).toHaveBeenCalledTimes(1);
    expect(client.removeRequestedReviewers).toHaveBeenCalledWith(
      42,
      ["alice"],
      ["team-a"],
    );
    expect(client.createComment).toHaveBeenCalledTimes(1);
    expect(client.searchQuarantinedPrs).not.toHaveBeenCalled();
  });

  it("does not remove reviewers when there are none pending", async () => {
    const client = fakeClient();

    await run(inputs(), openedContext(), client, NOW);

    expect(client.removeRequestedReviewers).not.toHaveBeenCalled();
    expect(client.createComment).toHaveBeenCalledTimes(1);
  });

  it("does not look up reviewers at all when remove-reviewers is false", async () => {
    const client = fakeClient();

    await run(inputs({ removeReviewers: false }), openedContext(), client, NOW);

    expect(client.listRequestedReviewers).not.toHaveBeenCalled();
    expect(client.createComment).toHaveBeenCalledTimes(1);
  });

  it("says the PR will merge next run when quarantine-days is disabled", async () => {
    const client = fakeClient();

    await run(inputs({ quarantineDays: -1 }), openedContext(), client, NOW);

    const [, body] = client.createComment.mock.calls[0];
    expect(body).toContain("the next time it runs");
  });

  it("says when the PR will merge when quarantine-days is enabled", async () => {
    const client = fakeClient();

    await run(inputs({ quarantineDays: 5 }), openedContext(), client, NOW);

    const [, body] = client.createComment.mock.calls[0];
    expect(body).toContain("after 5 day(s), on 2024-06-20");
  });

  it("does nothing extra for non-opened actions on a bot PR, besides exiting early", async () => {
    const client = fakeClient();

    await run(
      inputs(),
      openedContext({ prAction: "synchronize" }),
      client,
      NOW,
    );

    expect(client.createComment).not.toHaveBeenCalled();
    expect(client.removeRequestedReviewers).not.toHaveBeenCalled();
    expect(client.searchQuarantinedPrs).not.toHaveBeenCalled();
  });

  it("falls through to the scan when the bot PR's title is excluded", async () => {
    const client = fakeClient();

    await run(
      inputs({ excludeTitleRegex: /in \/qa$/ }),
      openedContext({ prTitle: "Bump foo in /qa" }),
      client,
      NOW,
    );

    expect(client.listPrFiles).not.toHaveBeenCalled();
    expect(client.createComment).not.toHaveBeenCalled();
    expect(client.searchQuarantinedPrs).toHaveBeenCalledTimes(1);
  });

  it("falls through to the scan when the bot PR touches workflow files", async () => {
    const client = fakeClient({
      listPrFiles: async () => [".github/workflows/ci.yml"],
    });

    await run(inputs(), openedContext(), client, NOW);

    expect(client.createComment).not.toHaveBeenCalled();
    expect(client.searchQuarantinedPrs).toHaveBeenCalledTimes(1);
  });

  it("runs the scan for pull_request events from non-bot actors", async () => {
    const client = fakeClient();

    await run(inputs({ actor: "some-human" }), openedContext(), client, NOW);

    expect(client.searchQuarantinedPrs).toHaveBeenCalledTimes(1);
  });
});

describe("run / scheduled scan", () => {
  it("builds the search query from owner, repo, bot-authors, and quarantine-days", async () => {
    const client = fakeClient();

    await run(inputs({ quarantineDays: 5 }), scheduleContext, client, NOW);

    expect(client.searchQuarantinedPrs).toHaveBeenCalledTimes(1);
    expect(client.searchQuarantinedPrs).toHaveBeenCalledWith(
      "repo:freckle/mergeabot-action is:pr is:open author:app/dependabot updated:<2024-06-10" +
        " OR " +
        "repo:freckle/mergeabot-action is:pr is:open author:app/renovate updated:<2024-06-10",
    );
  });

  it("skips PRs excluded by title", async () => {
    const client = fakeClient({
      searchQuarantinedPrs: async () => [pr({ title: "Bump foo in /qa" })],
    });

    await run(
      inputs({ excludeTitleRegex: /in \/qa$/ }),
      scheduleContext,
      client,
      NOW,
    );

    expect(client.enableAutoMerge).not.toHaveBeenCalled();
    expect(client.approve).not.toHaveBeenCalled();
  });

  it("skips PRs that touch workflow files", async () => {
    const client = fakeClient({
      searchQuarantinedPrs: async () => [pr()],
      listPrFiles: async () => [".github/workflows/ci.yml"],
    });

    await run(inputs(), scheduleContext, client, NOW);

    expect(client.enableAutoMerge).not.toHaveBeenCalled();
    expect(client.approve).not.toHaveBeenCalled();
  });

  it("skips PRs with changes requested", async () => {
    const client = fakeClient({
      searchQuarantinedPrs: async () => [
        pr({ reviewDecision: "CHANGES_REQUESTED" }),
      ],
    });

    await run(inputs(), scheduleContext, client, NOW);

    expect(client.enableAutoMerge).not.toHaveBeenCalled();
    expect(client.approve).not.toHaveBeenCalled();
  });

  it("only enables auto-merge for already-approved PRs", async () => {
    const client = fakeClient({
      searchQuarantinedPrs: async () => [
        pr({ id: "PR_1", reviewDecision: "APPROVED" }),
      ],
    });

    await run(inputs({ strategy: "squash" }), scheduleContext, client, NOW);

    expect(client.enableAutoMerge).toHaveBeenCalledTimes(1);
    expect(client.enableAutoMerge).toHaveBeenCalledWith("PR_1", "squash");
    expect(client.approve).not.toHaveBeenCalled();
  });

  it("enables auto-merge and approves PRs with no review decision yet", async () => {
    const client = fakeClient({
      searchQuarantinedPrs: async () => [
        pr({ id: "PR_1", number: 7, reviewDecision: null }),
      ],
    });

    await run(inputs({ strategy: "merge" }), scheduleContext, client, NOW);

    expect(client.enableAutoMerge).toHaveBeenCalledTimes(1);
    expect(client.enableAutoMerge).toHaveBeenCalledWith("PR_1", "merge");
    expect(client.approve).toHaveBeenCalledTimes(1);
    expect(client.approve).toHaveBeenCalledWith(7);
  });

  it("does not mutate anything in dry-run mode", async () => {
    const client = fakeClient({
      searchQuarantinedPrs: async () => [pr({ reviewDecision: "APPROVED" })],
    });

    await run(inputs({ dryRun: true }), scheduleContext, client, NOW);

    expect(client.enableAutoMerge).not.toHaveBeenCalled();
    expect(client.approve).not.toHaveBeenCalled();
  });
});

describe("run / escalation gating", () => {
  it("does not escalate when escalate is false", async () => {
    const client = fakeClient();

    await run(inputs({ escalate: false }), scheduleContext, client, NOW);

    expect(client.searchBotPrStatuses).not.toHaveBeenCalled();
  });

  it("does not escalate on pull_request events", async () => {
    const client = fakeClient();

    await run(
      inputs({ escalate: true, actor: "some-human" }),
      openedContext(),
      client,
      NOW,
    );

    expect(client.searchBotPrStatuses).not.toHaveBeenCalled();
  });

  it("escalates on scheduled events when escalate is true", async () => {
    const client = fakeClient();

    await run(inputs({ escalate: true }), scheduleContext, client, NOW);

    expect(client.searchBotPrStatuses).toHaveBeenCalledTimes(1);
  });
});

describe("run / no results", () => {
  it("does not throw when the scan finds nothing", async () => {
    const client = fakeClient();
    await expect(
      run(inputs(), scheduleContext, client, NOW),
    ).resolves.toBeUndefined();
  });
});
