import { describe, expect, it } from "vitest";

import { parseConfig, type RawConfig } from "./config.js";

function raw(overrides: Partial<RawConfig> = {}): RawConfig {
  return {
    excludeTitleRegex: "",
    quarantineDays: "5",
    strategy: "rebase",
    removeReviewers: true,
    botAuthors: ["dependabot[bot]", "renovate[bot]"],
    actor: "dependabot[bot]",
    repository: "freckle/mergeabot-action",
    token: "some-token",
    dryRun: "0",
    ...overrides,
  };
}

describe("parseConfig", () => {
  it("accepts merge, rebase, and squash strategies", () => {
    for (const strategy of ["merge", "rebase", "squash"] as const) {
      expect(parseConfig(raw({ strategy })).strategy).toBe(strategy);
    }
  });

  it("rejects any other strategy", () => {
    expect(() => parseConfig(raw({ strategy: "fast-forward" }))).toThrow(
      /Invalid strategy/,
    );
  });

  it("splits github-repository into owner and repo", () => {
    const config = parseConfig(raw({ repository: "freckle/mergeabot-action" }));
    expect(config.owner).toBe("freckle");
    expect(config.repo).toBe("mergeabot-action");
  });

  it("rejects a github-repository without a slash", () => {
    expect(() => parseConfig(raw({ repository: "not-a-repo" }))).toThrow(
      /Invalid github-repository/,
    );
  });

  it("treats an empty exclude-title-regex as no filter", () => {
    expect(
      parseConfig(raw({ excludeTitleRegex: "" })).excludeTitleRegex,
    ).toBeNull();
  });

  it("compiles a non-empty exclude-title-regex", () => {
    const config = parseConfig(raw({ excludeTitleRegex: "in /qa$" }));
    expect(config.excludeTitleRegex).toBeInstanceOf(RegExp);
    expect(config.excludeTitleRegex?.test("Bump foo in /qa")).toBe(true);
  });

  it("passes bot-authors through unchanged", () => {
    const config = parseConfig(raw({ botAuthors: ["dependabot[bot]"] }));
    expect(config.botAuthors).toEqual(["dependabot[bot]"]);
  });

  it("only treats dry-run as true when it is a non-zero number", () => {
    expect(parseConfig(raw({ dryRun: "0" })).dryRun).toBe(false);
    expect(parseConfig(raw({ dryRun: "1" })).dryRun).toBe(true);
  });

  it("parses quarantine-days as a number", () => {
    expect(parseConfig(raw({ quarantineDays: "-1" })).quarantineDays).toBe(-1);
  });
});
