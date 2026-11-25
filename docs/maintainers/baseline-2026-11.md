# Pre-factory delivery baseline (November 2026)

The baseline the governed-factory case study (design item M5-2) compares against. It describes how
this repository was delivered before the factory existed: attended agent sessions, with the author
reviewing and merging every pull request.

## Method

The last 50 pull requests merged into `development` up to 2026-11-21 (the day before the factory
design work started), measured on 2026-11-25:

```bash
gh pr list --state merged --base development --limit 120 \
  --json number,title,additions,deletions,changedFiles,createdAt,mergedAt
```

- Changed lines are additions plus deletions.
- Time open runs from creation to merge.
- Percentiles use linear interpolation between the closest ranks.
- "Merged in the last 30 days" counts merges into `development` between 2026-10-23 and 2026-11-21.

The design's brainstorm quoted slightly different figures (median 792 lines, 15 PRs over 1,500
lines, p90 7,030, 29 merged in 30 days) from an earlier ad-hoc query that was not restricted to
`development`. The figures below replace them, and the case study repeats this method.

## Results

| Measure                                   | Value                    |
| ----------------------------------------- | ------------------------ |
| Window (merge time)                       | 2026-10-14 to 2026-11-21 |
| Pull requests                             | 50                       |
| Changed lines, median                     | 642                      |
| Changed lines, 90th percentile            | 3,064                    |
| Changed lines, largest                    | 21,514                   |
| Pull requests over 1,500 changed lines    | 13 of 50                 |
| Changed files, median                     | 8                        |
| Changed files, 90th percentile            | 26                       |
| Time open, median                         | 6 minutes                |
| Time open, 90th percentile                | 218 minutes              |
| Merged within an hour of opening          | 43 of 50                 |
| Merged into `development` in last 30 days | 28                       |
| Reverts                                   | 0                        |

By title prefix: 26 `feat`, 10 `fix`, 6 `docs`, 5 `chore`, 1 each of `build`, `refactor` and
`release`.

## Reading it

Pull requests were large and merged within minutes of opening, which means review happened in the
authoring session rather than on the pull request. The case study measures the factory against
these figures, together with what this baseline cannot show: rejected pull requests, rework, reverts
caught after merge, containment events and the author's time per merged change.
