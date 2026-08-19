import { describe, expect, it, vi } from "vitest";

import type { BotPrStatus } from "./client.js";
import type { Inputs } from "./inputs.js";
import { escalateFailingPrs } from "./escalate.js";
import { fakeClient } from "./fake-github-client.js";
import { ESCALATION_MARKER } from "./predicates.js";

// Silence logging
vi.mock(import("@actions/core"), () => {
  return {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
});

const CODEOWNERS = [
  "* @freckle/team-platform",
  "docs/ @freckle/team-docs",
].join("\n");

function inputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    excludeTitleRegex: null,
    quarantineDays: 5,
    strategy: "rebase",
    removeReviewers: true,
    botAuthors: ["dependabot[bot]", "renovate[bot]"],
    escalate: true,
    escalationFallbackTeam: "team-fallback",
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

function status(overrides: Partial<BotPrStatus> = {}): BotPrStatus {
  return {
    number: 1,
    hasReviewRequest: false,
    hasFailingStatus: true,
    ...overrides,
  };
}

describe("escalateFailingPrs / candidate selection", () => {
  it.each([
    [{ hasReviewRequest: true, hasFailingStatus: true }],
    [{ hasReviewRequest: true, hasFailingStatus: false }],
    [{ hasReviewRequest: false, hasFailingStatus: false }],
  ])("ignores PRs that are %s", async (overrides) => {
    const client = fakeClient({
      searchBotPrStatuses: async () => [status(overrides)],
    });

    await escalateFailingPrs(inputs(), client);

    expect(client.listPrFiles).not.toHaveBeenCalled();
    expect(client.requestReviewers).not.toHaveBeenCalled();
    expect(client.createComment).not.toHaveBeenCalled();
  });

  it("looks up the changed files of a failing PR with no reviewer", async () => {
    const client = fakeClient({
      searchBotPrStatuses: async () => [status({ number: 7 })],
    });

    await escalateFailingPrs(inputs(), client);

    expect(client.listPrFiles).toHaveBeenCalledTimes(1);
    expect(client.listPrFiles).toHaveBeenCalledWith(7);
  });

  it("does not throw when the search finds nothing", async () => {
    const client = fakeClient();

    await expect(escalateFailingPrs(inputs(), client)).resolves.toBeUndefined();
  });
});

describe("escalateFailingPrs / team routing", () => {
  it("requests the CODEOWNERS team and comments", async () => {
    const client = fakeClient({
      searchBotPrStatuses: async () => [status({ number: 7 })],
      getFileContent: async () => CODEOWNERS,
      listPrFiles: async () => ["docs/intro.md"],
    });

    await escalateFailingPrs(inputs(), client);

    expect(client.getFileContent).toHaveBeenCalledWith(".github/CODEOWNERS");
    expect(client.requestReviewers).toHaveBeenCalledTimes(1);
    expect(client.requestReviewers).toHaveBeenCalledWith(7, [], ["team-docs"]);
    expect(client.createComment).toHaveBeenCalledTimes(1);
    const [number, body] = client.createComment.mock.calls[0];
    expect(number).toBe(7);
    expect(body).toContain(ESCALATION_MARKER);
  });

  it("appends the escalation-comment-suffix input to the comment", async () => {
    const client = fakeClient({
      searchBotPrStatuses: async () => [status({ number: 7 })],
      getFileContent: async () => CODEOWNERS,
      listPrFiles: async () => ["docs/intro.md"],
    });

    await escalateFailingPrs(
      inputs({ escalationCommentSuffix: "cc @some-team" }),
      client,
    );

    const [, body] = client.createComment.mock.calls[0];
    expect(body).toContain("cc @some-team");
  });

  it("appends nothing when escalation-comment-suffix is empty", async () => {
    const client = fakeClient({
      searchBotPrStatuses: async () => [status({ number: 7 })],
      getFileContent: async () => CODEOWNERS,
      listPrFiles: async () => ["docs/intro.md"],
    });

    await escalateFailingPrs(inputs({ escalationCommentSuffix: "" }), client);

    const [, body] = client.createComment.mock.calls[0];
    expect(body).toBe(
      [
        ESCALATION_MARKER,
        "This bot PR has failing statuses and cannot auto-merge. It has been re-assigned for human intervention.",
        "",
        "If you are the new reviewer, you should:",
        "",
        "- [ ] Check for failing statuses and address any (click the status link on this PR for details)",
        "- [ ] Approve the PR",
      ].join("\n"),
    );
  });

  it("falls back when the files resolve to more than one team", async () => {
    const client = fakeClient({
      searchBotPrStatuses: async () => [status()],
      getFileContent: async () => CODEOWNERS,
      listPrFiles: async () => ["docs/intro.md", "src/main.ts"],
    });

    await escalateFailingPrs(inputs(), client);

    expect(client.requestReviewers).toHaveBeenCalledWith(
      1,
      [],
      ["team-fallback"],
    );
  });

  it("falls back when no rule matches the files", async () => {
    const client = fakeClient({
      searchBotPrStatuses: async () => [status()],
      getFileContent: async () => "docs/ @freckle/team-docs",
      listPrFiles: async () => ["src/main.ts"],
    });

    await escalateFailingPrs(inputs(), client);

    expect(client.requestReviewers).toHaveBeenCalledWith(
      1,
      [],
      ["team-fallback"],
    );
  });

  it("falls back when CODEOWNERS cannot be read", async () => {
    const client = fakeClient({
      searchBotPrStatuses: async () => [status()],
      getFileContent: async () => null,
      listPrFiles: async () => ["docs/intro.md"],
    });

    await escalateFailingPrs(inputs(), client);

    expect(client.requestReviewers).toHaveBeenCalledWith(
      1,
      [],
      ["team-fallback"],
    );
  });

  it("skips PRs with no team when there is no fallback", async () => {
    const client = fakeClient({
      searchBotPrStatuses: async () => [status()],
      getFileContent: async () => "docs/ @freckle/team-docs",
      listPrFiles: async () => ["src/main.ts"],
    });

    await escalateFailingPrs(inputs({ escalationFallbackTeam: "" }), client);

    expect(client.listCommentBodies).not.toHaveBeenCalled();
    expect(client.requestReviewers).not.toHaveBeenCalled();
    expect(client.createComment).not.toHaveBeenCalled();
  });
});

describe("escalateFailingPrs / idempotency and dry-run", () => {
  it("skips PRs that were already escalated", async () => {
    const client = fakeClient({
      searchBotPrStatuses: async () => [status()],
      listCommentBodies: async () => [`${ESCALATION_MARKER}\nescalated`],
    });

    await escalateFailingPrs(inputs(), client);

    expect(client.requestReviewers).not.toHaveBeenCalled();
    expect(client.createComment).not.toHaveBeenCalled();
  });

  it("reads but does not mutate in dry-run mode", async () => {
    const client = fakeClient({
      searchBotPrStatuses: async () => [status()],
    });

    await escalateFailingPrs(inputs({ dryRun: true }), client);

    expect(client.listPrFiles).toHaveBeenCalledTimes(1);
    expect(client.listCommentBodies).toHaveBeenCalledTimes(1);
    expect(client.requestReviewers).not.toHaveBeenCalled();
    expect(client.createComment).not.toHaveBeenCalled();
  });

  it("handles each candidate independently", async () => {
    const client = fakeClient({
      searchBotPrStatuses: async () => [
        status({ number: 7 }),
        status({ number: 8 }),
      ],
      getFileContent: async () => "docs/ @freckle/team-docs",
      listPrFiles: async (prNumber) =>
        prNumber === 7 ? ["docs/intro.md"] : ["src/main.ts"],
    });

    await escalateFailingPrs(inputs({ escalationFallbackTeam: "" }), client);

    expect(client.requestReviewers).toHaveBeenCalledTimes(1);
    expect(client.requestReviewers).toHaveBeenCalledWith(7, [], ["team-docs"]);
  });
});

describe("escalateFailingPrs / per-PR failure isolation", () => {
  it("keeps processing other PRs after one fails, then fails the run", async () => {
    const client = fakeClient({
      searchBotPrStatuses: async () => [
        status({ number: 7 }),
        status({ number: 8 }),
      ],
      getFileContent: async () => "docs/ @freckle/team-docs",
      listPrFiles: async () => ["docs/intro.md"],
      requestReviewers: async (prNumber) => {
        if (prNumber === 7) {
          throw new Error("token lacks permission");
        }
      },
    });

    await expect(escalateFailingPrs(inputs(), client)).rejects.toThrow(
      "Failed to escalate some PRs",
    );

    expect(client.requestReviewers).toHaveBeenCalledTimes(2);
    expect(client.createComment).toHaveBeenCalledTimes(1);
    expect(client.createComment).toHaveBeenCalledWith(
      8,
      expect.stringContaining(ESCALATION_MARKER),
    );
  });
});
