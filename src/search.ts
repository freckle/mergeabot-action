// GitHub's search grammar has no grouping parentheses and parses "A OR B C" as
// "A OR (B AND C)". So every qualifier -- repo, is:pr, is:open, and the
// quarantine window -- is repeated on each author's branch of the OR, not
// just attached once at the end.
function searchAuthorFor(login: string): string {
  return login.endsWith('[bot]') ? `app/${login.slice(0, -'[bot]'.length)}` : login
}

function buildBotAuthorSearchQuery(
  owner: string,
  repo: string,
  botAuthors: string[],
  suffix: string
): string {
  return botAuthors
    .map(login => `repo:${owner}/${repo} is:pr is:open author:${searchAuthorFor(login)}${suffix}`)
    .join(' OR ')
}

export function buildSearchQuery(
  owner: string,
  repo: string,
  botAuthors: string[],
  since: string
): string {
  return buildBotAuthorSearchQuery(owner, repo, botAuthors, ` updated:<${since}`)
}

// No quarantine window here: escalation considers failing bot PRs of any age.
export function buildEscalationSearchQuery(
  owner: string,
  repo: string,
  botAuthors: string[]
): string {
  return buildBotAuthorSearchQuery(owner, repo, botAuthors, '')
}
