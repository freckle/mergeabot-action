import { describe, expect, it } from "vitest";

import { parseCodeowners, resolveTeamsForPaths } from "./codeowners.js";

// All call sites here exercise the single-team/fallback path (multi-team
// resolution is tested directly, further below), so this always returns
// exactly one team.
function resolve(content: string, paths: string[], fallback = "fallback") {
  const teams = resolveTeamsForPaths(
    parseCodeowners(content, "team-"),
    paths,
    fallback,
  );
  return teams[0];
}

describe(parseCodeowners.name, () => {
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

    // Rules come back in reverse-of-file order (last match wins), so
    // "team-docs" -- the later rule in the file -- is first here.
    expect(rules).toHaveLength(2);
    expect(rules.map((rule) => rule.team)).toEqual([
      "team-docs",
      "team-platform",
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

  it("strips a trailing inline comment before extracting owners", () => {
    const rules = parseCodeowners(
      "docs/ #ask @freckle/team-docs about this",
      "team-",
    );

    expect(rules[0].team).toBe("");
  });

  it("keeps real owners on a line with a trailing inline comment", () => {
    const rules = parseCodeowners(
      "docs/ @freckle/team-platform #ask @freckle/team-docs about this",
      "team-",
    );

    expect(rules[0].team).toBe("team-platform");
  });
});

describe("resolveTeamsForPaths / globbing", () => {
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

describe("resolveTeamsForPaths / last match wins", () => {
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

describe("resolveTeamsForPaths / resolution", () => {
  const content = [
    "docs/ @freckle/team-docs",
    "src/ @freckle/team-platform",
  ].join("\n");

  it("resolves one team when unmatched paths accompany matched ones", () => {
    expect(resolve(content, ["src/main.ts", "README.md"])).toBe(
      "team-platform",
    );
  });

  it("resolves to all matching teams when paths resolve to more than one", () => {
    const teams = resolveTeamsForPaths(
      parseCodeowners(content, "team-"),
      ["src/main.ts", "docs/intro.md"],
      "fallback",
    );
    expect(teams).toHaveLength(2);
    expect(teams).toEqual(
      expect.arrayContaining(["team-platform", "team-docs"]),
    );
  });

  it("falls back when no rule matches any path", () => {
    expect(resolve(content, ["README.md"])).toBe("fallback");
  });

  it("falls back when there are no rules at all", () => {
    expect(resolveTeamsForPaths([], ["src/main.ts"], "fallback")).toEqual([
      "fallback",
    ]);
  });

  it("returns no teams when there is no fallback and nothing matches", () => {
    expect(resolveTeamsForPaths([], ["src/main.ts"], "")).toEqual([]);
  });

  it("does not duplicate a team matched by more than one path", () => {
    expect(
      resolveTeamsForPaths(
        parseCodeowners(content, "team-"),
        ["docs/intro.md", "docs/guide.md"],
        "fallback",
      ),
    ).toEqual(["team-docs"]);
  });

  it("resolves to all matching teams even with no fallback configured", () => {
    const teams = resolveTeamsForPaths(
      parseCodeowners(content, "team-"),
      ["src/main.ts", "docs/intro.md"],
      "",
    );
    expect(teams).toHaveLength(2);
    expect(teams).toEqual(
      expect.arrayContaining(["team-platform", "team-docs"]),
    );
  });

  it("resolves to three or more matching teams", () => {
    const threeTeamContent = [
      "docs/ @freckle/team-docs",
      "src/ @freckle/team-platform",
      "infra/ @freckle/team-infra",
    ].join("\n");

    const teams = resolveTeamsForPaths(
      parseCodeowners(threeTeamContent, "team-"),
      ["docs/intro.md", "src/main.ts", "infra/deploy.yml"],
      "fallback",
    );
    expect(teams).toHaveLength(3);
    expect(teams).toEqual(
      expect.arrayContaining(["team-docs", "team-platform", "team-infra"]),
    );
  });
});
