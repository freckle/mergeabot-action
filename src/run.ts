import * as core from '@actions/core'
import chalk from 'chalk'

import type {Inputs} from './inputs.js'
import type {EventContext} from './context.js'
import type {GitHubClient, ReviewDecision} from './client.js'
import {escalateFailingPrs} from './escalate.js'
import {isBotPrEvent, isExcludedByTitle, touchesWorkflows} from './predicates.js'
import {buildSearchQuery} from './search.js'

const DAY_MS = 24 * 60 * 60 * 1000

// https://github.com/chalk/supports-color/issues/106
if (process.env.GITHUB_ACTIONS) {
  chalk.level = 2 // 256 colors
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function describeWhen(quarantineDays: number, now: number): string {
  if (quarantineDays <= 0) {
    return 'the next time it runs'
  }
  const until = formatDate(now + quarantineDays * DAY_MS)
  return `after ${quarantineDays} day(s), on ${until}`
}

async function unlessDryRun(inputs: Inputs, fn: () => Promise<void>): Promise<void> {
  if (inputs.dryRun) {
    core.info(chalk.gray('(skipping action due to dry-run)'))
    return
  }

  return await fn()
}

async function handleBotPrEvent(
  inputs: Inputs,
  context: EventContext,
  client: GitHubClient,
  now: number
): Promise<void> {
  if (!isBotPrEvent(context.eventName, inputs.actor, inputs.botAuthors)) {
    return
  }

  const number = context.prNumber

  if (number === undefined) {
    core.warning('Skipping PR because number is not known')
    return
  }

  const title = context.prTitle ?? ''

  if (isExcludedByTitle(title, inputs.excludeTitleRegex)) {
    core.warning(
      `Skipping PR based on title ${chalk.gray(`(${title} =~ ${inputs.excludeTitleRegex})`)}`
    )
    return
  }

  if (touchesWorkflows(await client.listPrFiles(number))) {
    core.warning(
      `Skipping PR because it touches Workflow files ${chalk.gray('(bots cannot merge)')}`
    )
    return
  }

  if (context.prAction === 'opened') {
    // dry-run only gates the scan loop's merge/approve calls below, not these
    // -- removing reviewers and commenting were never gated in the original
    // bash either.
    if (inputs.removeReviewers) {
      const {users, teams} = await client.listRequestedReviewers(number)
      if (users.length > 0 || teams.length > 0) {
        core.info(
          `Removing ${chalk.cyan(users.length)} user reviewer(s) and ${chalk.cyan(teams.length)} team reviewer(s) from ${chalk.bold(`${inputs.owner}/${inputs.repo}#${number}`)}`
        )
        await unlessDryRun(inputs, async () => {
          await client.removeRequestedReviewers(number, users, teams)
        })
      }
    }

    const whenMessage = describeWhen(inputs.quarantineDays, now)
    const body = `:heavy_check_mark: If all status checks pass, and no other reviews are submitted, [mergeabot][] will merge this PR ${whenMessage}.

As long as that's OK, no other action is necessary.

[mergeabot]: https://github.com/freckle/mergeabot-action`

    core.info(`Leaving comment on ${chalk.bold(`${inputs.owner}/${inputs.repo}#${number}`)}`)
    await unlessDryRun(inputs, async () => {
      await client.createComment(number, body)
    })
  }
}

async function scanForQuarantinedPrs(
  inputs: Inputs,
  context: EventContext,
  client: GitHubClient,
  now: number
): Promise<void> {
  if (context.eventName === 'pull_request') {
    return
  }

  const since = formatDate(now - inputs.quarantineDays * DAY_MS)
  const query = buildSearchQuery(inputs.owner, inputs.repo, inputs.botAuthors, since)
  const prs = await client.searchQuarantinedPrs(query)

  for (const pr of prs) {
    core.info(chalk.bold(`${pr.title} (#${pr.number})`))
    core.info(`Created at: ${chalk.blue(pr.createdAt)}`)
    core.info(`Current review decision: ${colorizeReviewDecision(pr.reviewDecision)}`)

    if (isExcludedByTitle(pr.title, inputs.excludeTitleRegex)) {
      core.warning(
        `Skipping PR based on title ${chalk.gray(`(${pr.title} =~ ${inputs.excludeTitleRegex})`)}`
      )
      continue
    }

    if (touchesWorkflows(await client.listPrFiles(pr.number))) {
      core.warning(
        `Skipping PR because it touches Workflow files ${chalk.gray('(bots cannot merge)')}`
      )
      continue
    }

    if (pr.mergeStateStatus === 'CLEAN') {
      core.info(`Merging PR ${chalk.gray('(requirements already met)')}`)
      await unlessDryRun(inputs, async () => {
        await client.merge(pr.id, inputs.strategy)
      })
      continue
    }

    switch (pr.reviewDecision) {
      case 'CHANGES_REQUESTED':
        core.warning('Skipping PR because changes have been requested')
        break

      case 'APPROVED':
        core.info(`Enable auto-merge ${chalk.gray('(PR already approved)')}`)
        await unlessDryRun(inputs, async () => {
          await client.enableAutoMerge(pr.id, inputs.strategy)
        })
        break

      default:
        core.info('Enable auto-merge and approve')
        await unlessDryRun(inputs, async () => {
          await client.enableAutoMerge(pr.id, inputs.strategy)
          await client.approve(pr.number)
        })
        break
    }
  }

  if (prs.length === 0) {
    core.info(`No bot PRs found older than ${chalk.blue(since)}.`)
  }
}

function colorizeReviewDecision(reviewDecision: ReviewDecision): string {
  switch (reviewDecision) {
    case 'CHANGES_REQUESTED':
      return chalk.yellow(reviewDecision)
    case 'APPROVED':
      return chalk.green(reviewDecision)
    default:
      return chalk.gray(reviewDecision)
  }
}

export async function run(
  inputs: Inputs,
  context: EventContext,
  client: GitHubClient,
  now: number = Date.now()
): Promise<void> {
  await handleBotPrEvent(inputs, context, client, now)
  await scanForQuarantinedPrs(inputs, context, client, now)
  await escalateFailingPrs(inputs, context, client)
}
