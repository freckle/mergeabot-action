# Mergeabot

Auto-merge Dependabot PRs, only after a certain number of days have passed.

## Motivation

Using out of date dependencies is a Software Supply Chain risk, as
security-related patches may not be applied in a timely fashion.

Dependabot and timely merges of its PRs is a solution to this. Requiring manual
approval and merge of such PRs is typically busy work. With robust CI and QA
processes, such PRs should be a "merge on Green" scenario for your team. Any
process of an Engineer taking an action without thought should be automated.

Immediately merging new versions of dependencies is _also_ a Software Supply
Chain risk, as so-far-un-discovered exploits could exist in very new patches.

Automatically merging Dependabot PRs _only after some number of days_ (i.e.
after a "quarantine" period) is one mitigation for this, which this Action
implements.

## Events

Mergeabot's primary feature is to find Dependabot PRs that have been open for
your configured `quarantine-days` and merge them (technically, approve and
enable auto-merge so that status and review requirements are met):

![Mergeabot example](./screenshots/example.png)

### `schedule`

We recommend running this once a day, e.g. at midnight UTC, through the
`schedule` event:

```yaml
on:
  schedule:
    - cron: "0 0 * * *"
```

### `pull_request`

Our team uses `CODEOWNERS` and round-robins review-requests. This results in
folks being requested to review Dependabot PRs. This is unnecessary and
undesired; we want to leave these PRs to Mergeabot.

To ameliorate this, we run Mergeabot on `pull_request` events too:

```yaml
on:
  schedule:
    - cron: "0 0 * * *"

  pull_request:
    types: [opened]
```

Mergeabot knows if it's running on a `pull_request` event in a Dependabot PR
and, if so, leaves a comment on the PR indicating, roughly, "I got this."

![Mergeabot comment on opened event](./screenshots/opened-comment.png)

## Permissions

Dependabot PRs use a token with read-only permissions by default, so you'll need
an explicit `permissions` key to use the above approach.

```yaml
permissions:
  contents: write
  pull-requests: write
```

**NOTE**: `contents:write` is required because Mergeabot will always do its
normal thing of finding other Dependabot PRs and handling them. This may be
surprising on PR events, but we find it useful. Patches welcome to make this
behavior optional.

## Complete Example

```yaml
name: Mergeabot

on:
  schedule:
    - cron: "0 0 * * *"

  pull_request:
    types: [opened]

permissions:
  contents: write
  pull-requests: write

jobs:
  mergeabot:
    runs-on: ubuntu-latest
    steps:
      - uses: freckle/mergeabot-action@v1
```

## Inputs

- `exclude-title-regex`: exclude PRs whose titles match this regular expression

  Dependabot PRs follow the format `Bump {dep} to {version} in /{path}`, so this
  can be used to exclude PRs of certain dependencies or in certain directories.

  Note that GitHub could change this format at any time. If this happens, you
  would have `{quarantine-days}` days to notice and update your setting if
  necessary.

- `quarantine-days`: how many days since the last update on a PR before it
  qualifies for auto-merge. Default is 5.

  Note that **any update** (a review, a comment, etc) will reset the clock.

- `strategy`: how to perform the [auto-]merge. Must be `merge`, `rebase`, or
  `squash`. Default is `rebase`.
- `remove-reviewers`: remove any requested reviewers (if run on PRs). Default
  is `true`.

See [`action.yml`](./action.yml) for other, seldom useful, inputs.

## Outputs

None.

## Caveats

This Action really only makes sense if Branch Protection is enabled. This is
because it doesn't actually merge the PR, it enables auto-merge. That way,
requiring that status checks are passing is handled correctly.

If you use this Action in a project without Branch Protection, you will see

```
Message: ["Pull request Protected branch rules not configured for this branch"], Locations: [{Line:1 Column:72}]
```

PRs are welcome to make this use-case work, though it will require more
complexity than simply an option not to use `--auto` with `gh merge`, since some
manual handling of status checks would now be required.

---

[LICENSE](./LICENSE)
