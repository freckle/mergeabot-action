import ignore, { type Ignore } from "ignore";

export interface Codeowners {
  matcher: Ignore;
  teamPrefix: string;
  ruleCount: number;
}

// GitHub's CODEOWNERS docs: "!" negation and "[ ]" character ranges "don't
// work" -- unlike plain gitignore syntax, they must be treated as literal
// characters, not handed to `ignore` as-is (it implements the full spec).
function toGithubPattern(pattern: string): string {
  return pattern.replace(/^!|[[\]]/g, "\\$&");
}

function teamFor(owner: string, teamPrefix: string): string | null {
  const match = /^@[^/]+\/(.+)$/.exec(owner);
  return match !== null && match[1].startsWith(teamPrefix) ? match[1] : null;
}

// EXPERIMENTAL: single shared `Ignore` instead of one per pattern.
//
// Since every pattern here is non-negated (see toGithubPattern), `ignore`'s
// own `test()` only evaluates a rule while no earlier-added rule has matched
// yet -- once one matches it short-circuits and skips the rest. `matcher` is
// built with its rules added in reverse file order (see parseCodeowners), so
// that short-circuit lands on the *last* matching rule in the actual file,
// carrying that line's owners as `mark`. A later rule with no owners blanks
// out an earlier team match, which is the point: it un-owns those paths.
//
// KNOWN ISSUE: `Ignore.test()`/`.ignores()` also do hierarchical
// ancestor-directory checking (a parent-directory match is inherited by
// everything under it, independent of rule order -- see node_modules/ignore
// index.js `_t()`). That conflicts with CODEOWNERS' flat "last line in the
// file wins" rule whenever patterns of different specificity target the
// same path, e.g.:
//   * @team-a
//   docs/ @team-b
//   docs/api/ @team-c
// `docs/api/intro.md` should resolve to team-c but currently resolves to
// team-b, regardless of add order. Unresolved -- see PR #51 discussion.
function teamForPath(codeowners: Codeowners, path: string): string {
  const result = codeowners.matcher.test(path);
  const owners = result.rule?.mark?.split(/\s+/).filter(Boolean) ?? [];

  return (
    owners
      .map((owner) => teamFor(owner, codeowners.teamPrefix))
      .find((slug) => slug !== null) ?? ""
  );
}

export function parseCodeowners(
  content: string,
  teamPrefix: string,
): Codeowners {
  const lines: { pattern: string; mark: string }[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    // GitHub allows a trailing "# comment" after the pattern/owners; without
    // stripping it, a comment that happens to mention "@org/team-*" would be
    // picked up as a real owner.
    const withoutComment = trimmed.split("#")[0].trim();
    const [pattern, ...owners] = withoutComment.split(/\s+/);

    lines.push({ pattern: toGithubPattern(pattern), mark: owners.join(" ") });
  }

  const matcher = ignore();
  // Reversed so the short-circuit in `teamForPath` lands on the last-in-file
  // match instead of the first.
  for (const rule of lines.reverse()) {
    matcher.add(rule);
  }

  return { matcher, teamPrefix, ruleCount: lines.length };
}

export function resolveTeamForPaths(
  codeowners: Codeowners,
  paths: string[],
  fallbackTeam: string,
): string {
  const teams = new Set<string>();

  for (const path of paths) {
    const team = teamForPath(codeowners, path);
    if (team !== "") {
      teams.add(team);
    }
  }

  // Unowned paths contribute nothing, so they don't force a fallback on their
  // own; only zero or conflicting teams do.
  return teams.size === 1 ? [...teams][0] : fallbackTeam;
}
