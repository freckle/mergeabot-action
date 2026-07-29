export interface CodeownersRule {
  regex: RegExp;
  // Empty when the rule has no owner matching the configured team prefix.
  team: string;
}

const REGEX_METACHARS = new Set([
  ".",
  "+",
  "^",
  "$",
  "(",
  ")",
  "{",
  "}",
  "|",
  "[",
  "]",
  "\\",
  "?", // literal "?", not gitignore's any-single-char wildcard -- out of scope
]);

// Everything except "*", which globToRegExp translates rather than escapes.
function escapeMetachars(pattern: string): string {
  return Array.from(pattern)
    .map((char) => (REGEX_METACHARS.has(char) ? `\\${char}` : char))
    .join("");
}

// gitignore semantics: a leading "/" anchors the pattern to the repository
// root, otherwise it matches anywhere; a trailing "/" is redundant because
// every pattern already matches a whole path segment; "**" crosses "/" and
// may match zero directories (so "a/**/b" also matches "a/b"); a single "*"
// does not cross "/".
//
// Scope: only leading-slash anchoring is implemented -- an interior "/"
// doesn't anchor the pattern to root the way real gitignore/CODEOWNERS
// semantics would, and a wildcard segment's trailing "/|$" boundary allows
// matching arbitrarily nested paths beneath it rather than exactly one
// segment. Both are real refinements this deliberately doesn't implement:
// this repo's own CODEOWNERS rules are all leading-slash-anchored with no
// bare wildcard segments, and getting them right in general requires
// repo-tree awareness (is a matched segment a file or a directory?) this
// action doesn't have.
// One combined pass, not sequential replaces: each case's replacement text
// itself contains a literal "*" (e.g. ".*"), which a later, separate "*"
// pass would otherwise re-match and corrupt.
function globToRegExp(pattern: string): RegExp {
  const anchored = pattern.startsWith("/");
  const body = escapeMetachars(
    pattern.replace(/^\//, "").replace(/\/$/, ""),
  ).replace(/\/\*\*\/|^\*\*\/|\/\*\*$|\*\*|\*/g, (match) => {
    switch (match) {
      case "/**/":
        return "(?:/.*)?/"; // "**" adjacent to "/" may match zero dirs too
      case "**/":
        return "(?:.*/)?";
      case "/**":
        return "(?:/.*)?";
      case "**":
        return ".*";
      default:
        return "[^/]*";
    }
  });

  return new RegExp(`${anchored ? "^" : "(^|/)"}${body}(/|$)`);
}

function teamFor(owner: string, teamPrefix: string): string | null {
  const match = /^@[^/]+\/(.+)$/.exec(owner);
  return match !== null && match[1].startsWith(teamPrefix) ? match[1] : null;
}

// Last match wins, as CODEOWNERS itself does. A later rule with no team blanks
// out an earlier team match, which is the point: it un-owns those paths.
function teamForPath(rules: CodeownersRule[], path: string): string {
  let team = "";
  for (const rule of rules) {
    if (rule.regex.test(path)) {
      team = rule.team;
    }
  }
  return team;
}

export function parseCodeowners(
  content: string,
  teamPrefix: string,
): CodeownersRule[] {
  const rules: CodeownersRule[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const [pattern, ...owners] = trimmed.split(/\s+/);
    const team = owners
      .map((owner) => teamFor(owner, teamPrefix))
      .find((slug) => slug !== null);

    rules.push({ regex: globToRegExp(pattern), team: team ?? "" });
  }

  return rules;
}

export function resolveTeamForPaths(
  rules: CodeownersRule[],
  paths: string[],
  fallbackTeam: string,
): string {
  const teams = new Set<string>();

  for (const path of paths) {
    const team = teamForPath(rules, path);
    if (team !== "") {
      teams.add(team);
    }
  }

  // Unowned paths contribute nothing, so they don't force a fallback on their
  // own; only zero or conflicting teams do.
  return teams.size === 1 ? [...teams][0] : fallbackTeam;
}
