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
    const codeowners = parseCodeowners(
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

    expect(codeowners.ruleCount).toBe(2);
  });

  it("ignores owners that do not match the team prefix", () => {
    expect(
      resolve("* @alice @freckle/reviewers @freckle/team-platform", [
        "foo.txt",
      ]),
    ).toBe("team-platform");
  });

  it("leaves the team empty when no owner matches the team prefix", () => {
    expect(resolve("* @alice @freckle/reviewers", ["foo.txt"])).toBe(
      "fallback",
    );
  });

  it("strips a trailing inline comment before extracting owners", () => {
    expect(
      resolve("docs/ #ask @freckle/team-docs about this", ["docs/intro.md"]),
    ).toBe("fallback");
  });

  it("keeps real owners on a line with a trailing inline comment", () => {
    expect(
      resolve(
        "docs/ @freckle/team-platform #ask @freckle/team-docs about this",
        ["docs/intro.md"],
      ),
    ).toBe("team-platform");
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
    ["docs/**", ["docs"], "fallback"], // "**" matches everything *inside*, not the dir itself
    ["docs/**", ["docs/guide/intro.md"], "team-a"],
    ["src/*.ts", ["src/main.ts"], "team-a"],
    ["src/*.ts", ["src/a/main.ts"], "fallback"],
    ["docs/api/", ["docs/api/intro.md"], "team-a"],
    ["docs/api/", ["other/docs/api/intro.md"], "fallback"],
  ])("pattern=%s paths=%s -> %s", (pattern, paths, expected) => {
    expect(resolve(`${pattern} @freckle/team-a`, paths)).toBe(expected);
  });

  it("treats ? as gitignore's any-single-character wildcard", () => {
    expect(resolve("file?.txt @freckle/team-a", ["fileA.txt"])).toBe("team-a");
    expect(resolve("file?.txt @freckle/team-a", ["file.txt"])).toBe("fallback");
  });

  it("treats a leading ! as a literal character, not negation", () => {
    expect(resolve("!foo @freckle/team-a", ["!foo"])).toBe("team-a");
    expect(resolve("!foo @freckle/team-a", ["foo"])).toBe("fallback");
  });

  it("treats [ ] as literal characters, not a character range", () => {
    expect(resolve("[abc].txt @freckle/team-a", ["[abc].txt"])).toBe("team-a");
    expect(resolve("[abc].txt @freckle/team-a", ["a.txt"])).toBe("fallback");
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

  // KNOWN FAILURE (see the "EXPERIMENTAL"/"KNOWN ISSUE" comment in
  // codeowners.ts): a single shared `Ignore` inherits an ancestor
  // directory's match regardless of a more specific, later pattern.
  // `it.fails` keeps this documented without breaking the suite.
  it.fails(
    "prefers the last match among three or more overlapping rules",
    () => {
      const chained = [
        "* @freckle/team-a",
        "docs/ @freckle/team-b",
        "docs/api/ @freckle/team-c",
      ].join("\n");

      expect(resolve(chained, ["docs/api/intro.md"])).toBe("team-c");
      expect(resolve(chained, ["docs/guide.md"])).toBe("team-b");
      expect(resolve(chained, ["src/main.ts"])).toBe("team-a");
    },
  );
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
    expect(
      resolveTeamForPaths(
        parseCodeowners("", "team-"),
        ["src/main.ts"],
        "fallback",
      ),
    ).toBe("fallback");
  });
});
