import {describe, expect, it} from 'vitest'

import {parseInputs, type RawInputs} from './inputs.js'

function raw(overrides: Partial<RawInputs> = {}): RawInputs {
  return {
    excludeTitleRegex: '',
    quarantineDays: '5',
    strategy: 'rebase',
    removeReviewers: true,
    botAuthors: ['dependabot[bot]', 'renovate[bot]'],
    escalate: false,
    escalationFallbackTeam: '',
    escalationTeamPrefix: 'team-',
    codeownersPath: '.github/CODEOWNERS',
    escalationCommentSuffix: '',
    actor: 'dependabot[bot]',
    repository: 'freckle/mergeabot-action',
    token: 'some-token',
    dryRun: false,
    ...overrides
  }
}

describe('parseInputs', () => {
  it('accepts merge, rebase, and squash strategies', () => {
    for (const strategy of ['merge', 'rebase', 'squash'] as const) {
      expect(parseInputs(raw({strategy})).strategy).toBe(strategy)
    }
  })

  it('rejects any other strategy', () => {
    expect(() => parseInputs(raw({strategy: 'fast-forward'}))).toThrow(/Invalid strategy/)
  })

  it('splits github-repository into owner and repo', () => {
    const inputs = parseInputs(raw({repository: 'freckle/mergeabot-action'}))
    expect(inputs.owner).toBe('freckle')
    expect(inputs.repo).toBe('mergeabot-action')
  })

  it('rejects a github-repository without a slash', () => {
    expect(() => parseInputs(raw({repository: 'not-a-repo'}))).toThrow(/Invalid github-repository/)
  })

  it('treats an empty exclude-title-regex as no filter', () => {
    expect(parseInputs(raw({excludeTitleRegex: ''})).excludeTitleRegex).toBeNull()
  })

  it('compiles a non-empty exclude-title-regex', () => {
    const inputs = parseInputs(raw({excludeTitleRegex: 'in /qa$'}))
    expect(inputs.excludeTitleRegex).toBeInstanceOf(RegExp)
    expect(inputs.excludeTitleRegex?.test('Bump foo in /qa')).toBe(true)
  })

  it('passes bot-authors through unchanged', () => {
    const inputs = parseInputs(raw({botAuthors: ['dependabot[bot]']}))
    expect(inputs.botAuthors).toEqual(['dependabot[bot]'])
  })

  it('passes dry-run through unchanged', () => {
    expect(parseInputs(raw({dryRun: false})).dryRun).toBe(false)
    expect(parseInputs(raw({dryRun: true})).dryRun).toBe(true)
  })

  it('passes escalate through unchanged', () => {
    expect(parseInputs(raw({escalate: false})).escalate).toBe(false)
    expect(parseInputs(raw({escalate: true})).escalate).toBe(true)
  })

  it('passes the escalation routing inputs through unchanged', () => {
    const inputs = parseInputs(
      raw({
        escalationFallbackTeam: 'team-platform',
        escalationTeamPrefix: 'squad-',
        codeownersPath: 'CODEOWNERS'
      })
    )
    expect(inputs.escalationFallbackTeam).toBe('team-platform')
    expect(inputs.escalationTeamPrefix).toBe('squad-')
    expect(inputs.codeownersPath).toBe('CODEOWNERS')
  })

  it('parses quarantine-days as a number', () => {
    expect(parseInputs(raw({quarantineDays: '-1'})).quarantineDays).toBe(-1)
  })

  it('passes escalation-comment-suffix through unchanged', () => {
    expect(
      parseInputs(raw({escalationCommentSuffix: 'cc @some-team'})).escalationCommentSuffix
    ).toBe('cc @some-team')
    expect(parseInputs(raw({escalationCommentSuffix: ''})).escalationCommentSuffix).toBe('')
  })
})
