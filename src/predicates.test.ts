import { describe, expect, it } from "vitest";

import {
  ESCALATION_MARKER,
  hasEscalationComment,
  isBotPrEvent,
  isExcludedByTitle,
  touchesWorkflows,
} from "./predicates.js";

describe("isBotPrEvent", () => {
  const botAuthors = ["dependabot[bot]", "renovate[bot]"];

  it.each([
    ["pull_request", "dependabot[bot]", true],
    ["pull_request", "renovate[bot]", true],
    ["pull_request", "some-human", false],
    ["schedule", "dependabot[bot]", false],
  ])("eventName=%s actor=%s -> %s", (eventName, actor, expected) => {
    expect(isBotPrEvent(eventName, actor, botAuthors)).toBe(expected);
  });
});

describe("isExcludedByTitle", () => {
  it.each([
    ["Bump foo in /qa", null, false],
    ["Bump foo in /qa", /in \/qa$/, true],
    ["Bump foo in /app", /in \/qa$/, false],
  ])("title=%s regex=%s -> %s", (title, excludeTitleRegex, expected) => {
    expect(isExcludedByTitle(title, excludeTitleRegex)).toBe(expected);
  });
});

describe("touchesWorkflows", () => {
  it.each([
    [["package.json", ".github/workflows/ci.yml"], true],
    [["package.json", ".github/CODEOWNERS"], false],
    [[], false],
  ])("paths=%s -> %s", (paths, expected) => {
    expect(touchesWorkflows(paths)).toBe(expected);
  });
});

describe("hasEscalationComment", () => {
  it.each([
    [[], false],
    [["Bump foo", "LGTM"], false],
    [[`${ESCALATION_MARKER}\nThis PR has failing statuses.`], true],
    [["LGTM", `${ESCALATION_MARKER} escalated`, "thanks"], true],
  ])("bodies=%s -> %s", (bodies, expected) => {
    expect(hasEscalationComment(bodies)).toBe(expected);
  });
});
