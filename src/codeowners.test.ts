import { describe, expect, it } from "vitest";

import { parseCodeowners, resolveTeamForPaths } from "./codeowners.js";

function resolve(content: string, paths: string[], fallback = "fallback") {
  return resolveTeamForPaths(
    parseCodeowners(content, "team-"),
    paths,
    fallback,
  );
}

describe("parseCodeowners", () => {
  it("skips comments and blank lines", () => {
    const rules = parseCodeowners(
      [
        "# owners of everything",
        "",
        "* @freckle/team-platform",
        "   ",
        "  # indented comment",
        "docs/ @freckle/team-docs",
      ].join("\n"),
      "team-",
    );

    expect(rules).toHaveLength(2);
    expect(rules.map((rule) => rule.team)).toEqual([
      "team-platform",
      "team-docs",
    ]);
  });

  it("ignores owners that do not match the team prefix", () => {
    const rules = parseCodeowners(
      "* @alice @freckle/reviewers @freckle/team-platform",
      "team-",
    );

    expect(rules[0].team).toBe("team-platform");
  });

  it("leaves the team empty when no owner matches the team prefix", () => {
    const rules = parseCodeowners("* @alice @freckle/reviewers", "team-");

    expect(rules[0].team).toBe("");
  });
});

describe("resolveTeamForPaths / globbing", () => {
  it.each([
    ["/foo.txt", ["foo.txt"], "team-a"],
    ["/foo.txt", ["sub/foo.txt"], "fallback"],
    ["foo.txt", ["foo.txt"], "team-a"],
    ["foo.txt", ["sub/deep/foo.txt"], "team-a"],
    ["docs/", ["docs/guide/intro.md"], "team-a"],
    ["docs/", ["src/docs.md"], "fallback"],
    ["src/**/main.ts", ["src/a/b/main.ts"], "team-a"],
    ["src/**/main.ts", ["src/main.ts"], "team-a"],
    ["**/vendor", ["vendor"], "team-a"],
    ["**/vendor", ["a/b/vendor"], "team-a"],
    ["docs/**", ["docs"], "team-a"],
    ["docs/**", ["docs/guide/intro.md"], "team-a"],
    ["src/*.ts", ["src/main.ts"], "team-a"],
    ["src/*.ts", ["src/a/main.ts"], "fallback"],
  ])("pattern=%s paths=%s -> %s", (pattern, paths, expected) => {
    expect(resolve(`${pattern} @freckle/team-a`, paths)).toBe(expected);
  });

  it("treats ? as a literal character, not a quantifier or wildcard", () => {
    expect(resolve("file?.txt @freckle/team-a", ["file?.txt"])).toBe("team-a");
    expect(resolve("file?.txt @freckle/team-a", ["file.txt"])).toBe("fallback");
    expect(resolve("file?.txt @freckle/team-a", ["fileA.txt"])).toBe(
      "fallback",
    );
  });
});

describe("resolveTeamForPaths / last match wins", () => {
  const content = ["* @freckle/team-a", "docs/ @freckle/team-b"].join("\n");

  it("prefers a later rule's team over an earlier one", () => {
    expect(resolve(content, ["docs/intro.md"])).toBe("team-b");
  });

  it("keeps the earlier team for paths the later rule misses", () => {
    expect(resolve(content, ["src/main.ts"])).toBe("team-a");
  });

  it("lets a later rule with no team blank out an earlier team", () => {
    const unowned = ["* @freckle/team-a", "vendor/ @alice"].join("\n");

    expect(resolve(unowned, ["vendor/lib.js"])).toBe("fallback");
    expect(resolve(unowned, ["src/main.ts"])).toBe("team-a");
  });
});

describe("resolveTeamForPaths / resolution", () => {
  const content = [
    "docs/ @freckle/team-docs",
    "src/ @freckle/team-platform",
  ].join("\n");

  it("resolves one team when unmatched paths accompany matched ones", () => {
    expect(resolve(content, ["src/main.ts", "README.md"])).toBe(
      "team-platform",
    );
  });

  it("falls back when paths resolve to more than one team", () => {
    expect(resolve(content, ["src/main.ts", "docs/intro.md"])).toBe("fallback");
  });

  it("falls back when no rule matches any path", () => {
    expect(resolve(content, ["README.md"])).toBe("fallback");
  });

  it("falls back when there are no rules at all", () => {
    expect(resolveTeamForPaths([], ["src/main.ts"], "fallback")).toBe(
      "fallback",
    );
  });
});
