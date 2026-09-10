export function isBotPrEvent(eventName: string, actor: string, botAuthors: string[]): boolean {
  return eventName === 'pull_request' && botAuthors.includes(actor)
}

export function isExcludedByTitle(title: string, excludeTitleRegex: RegExp | null): boolean {
  return excludeTitleRegex !== null && excludeTitleRegex.test(title)
}

export function touchesWorkflows(paths: string[]): boolean {
  return paths.some(path => path.startsWith('.github/workflows/'))
}

// An HTML comment, so it's invisible in the rendered comment but still lets us
// recognize our own escalation comment on later runs.
export const ESCALATION_MARKER = '<!-- mergeabot-escalation -->'

export function hasEscalationComment(bodies: string[]): boolean {
  return bodies.some(body => body.includes(ESCALATION_MARKER))
}
