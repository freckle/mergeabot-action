import { describe, expect, it } from "vitest";

import { buildSearchQuery } from "./search.js";

describe("buildSearchQuery", () => {
  it("maps a [bot]-suffixed login to its app/ author form", () => {
    const query = buildSearchQuery(
      "freckle",
      "mergeabot-action",
      ["dependabot[bot]"],
      "2024-01-01",
    );
    expect(query).toBe(
      "repo:freckle/mergeabot-action is:pr is:open author:app/dependabot updated:<2024-01-01",
    );
  });

  it("passes through a login with no [bot] suffix unchanged", () => {
    const query = buildSearchQuery(
      "freckle",
      "mergeabot-action",
      ["some-human"],
      "2024-01-01",
    );
    expect(query).toBe(
      "repo:freckle/mergeabot-action is:pr is:open author:some-human updated:<2024-01-01",
    );
  });

  it("OR-joins multiple authors, repeating repo/is:pr/is:open/updated on every branch", () => {
    const query = buildSearchQuery(
      "freckle",
      "mergeabot-action",
      ["dependabot[bot]", "renovate[bot]"],
      "2024-01-01",
    );
    expect(query).toBe(
      "repo:freckle/mergeabot-action is:pr is:open author:app/dependabot updated:<2024-01-01" +
        " OR " +
        "repo:freckle/mergeabot-action is:pr is:open author:app/renovate updated:<2024-01-01",
    );
  });
});
