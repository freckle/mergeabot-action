# Mergeabot

Auto-merge Dependabot PRs, only after a certain number of days have passed.

## Motivation

Using out of date dependencies is a Software Supply Chain risk, as
security-related patches may not be applied in a timely fashion.

Dependabot and timely merges of its PRs is a solution to this. Requiring manual
approval and merge of such PRs is typically busy work. With robust CI and QA
processes, such PRs should be a "merge on Green" scenario for your team. Any
process of an Engineer taking an action without tough should be automated.

Immediately merging new versions of dependencies is _also_ a Software Supply
Chain risk, as so-far-un-discovered exploits could exist in very new patches.

Automatically merging Dependabot PRs _only after some number of days_ (i.e.
after a "quarantine" period) is one mitigation for this, which this Action
implements.

## Usage

```yaml
on:
 schedule:
   # ...

jobs:
  mergabot:
    runs-on: ubuntu-latest
    steps:
      - uses: freckle/mergeabot-action@v1
```

## Inputs

- `quarantine-days`: how many days since the last update on a PR before it
  qualifies for auto-merge. Default is 5.

  Note that **any update** (a review, a comment, etc) will reset the clock.

- `strategy`: how to perform the [auto-]merge. Must be `merge`, `rebase`, or
  `squash`. Default is `rebase`.

See [`action.yml`](./action.yml) for other, seldom useful, inputs.

## Outputs

None.

---

[LICENSE](./LICENSE)
