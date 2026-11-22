# sitegen-fast

[![make.fun](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/Ahmadmukafi/site-generator-speed-01-run-20261122-r1/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/Ahmadmukafi/site-generator-speed-01-run-20261122-r1/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

A faster drop-in for make.fun's own makefun-site 1.0.0: it builds the same static
sites — the same pages, tags, index and report, byte for byte — with less CPU
time. Written from the vendor README spec alone: the template dialect is
precompiled to JavaScript once per case, Markdown is rendered in a single
hand-rolled pass, and everything repeated per page (cards, tag indexes, slug
tables, collection order) is computed once per case.

## Layout

- `solve.js` — the generator: `run(input)` returns the output tree for one case.
- `main.ts` — the harness program: reads `/input/cases.json`, answers each case
  with `run`, writes `/output/answers.json`.

## Requirements

Node 22 and its standard library alone. No dependencies, no install step.

## License

MIT — see `LICENSE`.
