export function isBotPrEvent(
  eventName: string,
  actor: string,
  botAuthors: string[],
): boolean {
  return eventName === "pull_request" && botAuthors.includes(actor);
}

export function isExcludedByTitle(
  title: string,
  excludeTitleRegex: RegExp | null,
): boolean {
  return excludeTitleRegex !== null && excludeTitleRegex.test(title);
}

export function touchesWorkflows(paths: string[]): boolean {
  return paths.some((path) => path.startsWith(".github/workflows/"));
}
