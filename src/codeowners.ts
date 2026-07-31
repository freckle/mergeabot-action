import ignore, { type Ignore } from "ignore";

export interface CodeownersRule {
  matcher: Ignore;
  // Empty when the rule has no owner matching the configured team prefix.
  team: string;
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

// CODEOWNERS gives later rules precedence, so `rules` is stored reversed
// (see parseCodeowners) and the first hit here is the last match in the
// file. A later rule with no team blanks out an earlier team match, which
// is the point: it un-owns those paths.
function teamForPath(rules: CodeownersRule[], path: string): string {
  return rules.find((rule) => rule.matcher.ignores(path))?.team ?? "";
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

    // GitHub allows a trailing "# comment" after the pattern/owners; without
    // stripping it, a comment that happens to mention "@org/team-*" would be
    // picked up as a real owner.
    const withoutComment = trimmed.split("#")[0].trim();
    const [pattern, ...owners] = withoutComment.split(/\s+/);
    const team = owners
      .map((owner) => teamFor(owner, teamPrefix))
      .find((slug) => slug !== null);

    rules.push({
      matcher: ignore().add(toGithubPattern(pattern)),
      team: team ?? "",
    });
  }

  // Reversed so lookups can stop at the first match (the last-in-file rule)
  // instead of scanning to the end -- same technique used by hmarr/codeowners
  // and codeowners-utils.
  return rules.reverse();
}

export function resolveTeamsForPaths(
  rules: CodeownersRule[],
  paths: string[],
  fallbackTeam: string,
): string[] {
  const teams = new Set<string>();

  for (const path of paths) {
    const team = teamForPath(rules, path);
    if (team !== "") {
      teams.add(team);
    }
  }

  // Unowned paths contribute nothing, so they don't force a fallback on
  // their own; only zero matched teams does. A PR spanning multiple teams'
  // paths is routed to all of them, not the fallback.
  if (teams.size === 0) {
    return fallbackTeam ? [fallbackTeam] : [];
  }
  return [...teams];
}
