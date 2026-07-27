import { describe, expect, it } from "vitest";

import {
  isBotPrEvent,
  isExcludedByTitle,
  touchesWorkflows,
} from "./predicates.js";

describe("isBotPrEvent", () => {
  const botAuthors = ["dependabot[bot]", "renovate[bot]"];

  it("is true for a pull_request event from a configured bot author", () => {
    expect(isBotPrEvent("pull_request", "dependabot[bot]", botAuthors)).toBe(
      true,
    );
    expect(isBotPrEvent("pull_request", "renovate[bot]", botAuthors)).toBe(
      true,
    );
  });

  it("is false for a pull_request event from anyone else", () => {
    expect(isBotPrEvent("pull_request", "some-human", botAuthors)).toBe(false);
  });

  it("is false for non pull_request events, even from a bot author", () => {
    expect(isBotPrEvent("schedule", "dependabot[bot]", botAuthors)).toBe(false);
  });
});

describe("isExcludedByTitle", () => {
  it("is false when there is no regex", () => {
    expect(isExcludedByTitle("Bump foo in /qa", null)).toBe(false);
  });

  it("is true when the title matches the regex", () => {
    expect(isExcludedByTitle("Bump foo in /qa", /in \/qa$/)).toBe(true);
  });

  it("is false when the title does not match the regex", () => {
    expect(isExcludedByTitle("Bump foo in /app", /in \/qa$/)).toBe(false);
  });
});

describe("touchesWorkflows", () => {
  it("is true when any file is under .github/workflows/", () => {
    expect(touchesWorkflows(["package.json", ".github/workflows/ci.yml"])).toBe(
      true,
    );
  });

  it("is false otherwise", () => {
    expect(touchesWorkflows(["package.json", ".github/CODEOWNERS"])).toBe(
      false,
    );
  });

  it("is false for an empty file list", () => {
    expect(touchesWorkflows([])).toBe(false);
  });
});
