import ignore, { type Ignore } from "ignore";

export interface CodeownersRule {
  matcher: Ignore;
  // Empty when the rule has no owner matching the configured team prefix.
  team: string;
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
    if (rule.matcher.ignores(path)) {
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

    // GitHub allows a trailing "# comment" after the pattern/owners; without
    // stripping it, a comment that happens to mention "@org/team-*" would be
    // picked up as a real owner.
    const withoutComment = trimmed.split("#")[0].trim();
    const [pattern, ...owners] = withoutComment.split(/\s+/);
    const team = owners
      .map((owner) => teamFor(owner, teamPrefix))
      .find((slug) => slug !== null);

    rules.push({ matcher: ignore().add(pattern), team: team ?? "" });
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
