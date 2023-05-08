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

## Usage

```yaml
on:
  # When run on a Dependabot PR itself, we will leave a comment to indicate that
  # we will be automatically handling this PR for you.
  pull_request:

  # Otherwise, we will search and handle any open Dependabot PRs
  schedule:
    # ...

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
