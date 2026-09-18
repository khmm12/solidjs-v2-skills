# Skill exam

The bank tests four axes: current APIs, practical patterns, Solid vs React,
and Solid v2 vs v1. Each `must_include` claim has a verified reference in `source`.
Answers pass when they satisfy every claim. Regex matches are not verdicts.

## Conditions

- `base`: prior knowledge, with the same version preamble and question.
- `with-skill`: the model retrieves the shipped skill and follows its routing.
  Codex receives the explicit SKILL.md path. Claude receives the plugin and
  uses its own skill trigger. Codex measures explicit retrieval, not discovery.

Each answer uses a fresh session in a neutral temporary directory. Codex gets
an auth-only temporary home, read-only sandbox, and disabled personal config.
Base answers use no tools; observed Codex tool activity invalidates that cell.
Skill retrieval is recorded separately from correctness; Claude's turn count
is a proxy, while Codex records skill paths in tool activity.

## Grading and cost

Default: **Luna low** answers, **Terra medium** judges **eight answers per call**.
A 68-question, two-condition run takes 136 answer calls and 17 judge calls,
instead of 136 judge calls. This reduces call overhead; answer/rubric tokens
still have to be read. Every answer stays isolated from other exam questions.

The judge receives anonymous entries without model/condition labels. It checks
each entry against its own rubric and quotes the answer for every met claim.
The runner validates entry IDs, full claim coverage, booleans, and verbatim
quotes. Invalid judgments and provider errors remain ungraded and make the run
exit nonzero; they are excluded from pass rates and listed in the summary.

Batching trades some judge isolation for fewer calls. Use `--grade-batch-size 1`
for an independent per-answer audit. Review disputed verdicts in the raw JSON
before changing reference content or answer keys.

## Commands

```sh
node evals/run.test.mjs                     # offline harness checks
node evals/run.mjs                          # full Luna low exam
node evals/run.mjs --quick                  # four questions, both conditions
node evals/run.mjs --questions A31,B19,C1,D2 # focused comparison
node evals/run.mjs --conditions with-skill  # skill-only follow-up
node evals/run.mjs --no-grade               # answers/retrieval only
node evals/run.mjs --resume evals/results/run-<timestamp>.json
node evals/run.mjs --provider claude --models haiku --grader sonnet
```

Other flags: `--models`, `--reasoning`, `--grader-provider`, `--grader`,
`--grader-reasoning`, `--grade-batch-size`, `--concurrency`, `--n`, and
`--questions axis:react` (also `api`, `pattern`, `v1`).

Each completed answer and judge batch is saved atomically in `results/run-*.json`.
Resume with the original flags plus `--resume`: valid answers/grades are reused,
failed calls are retried. The input fingerprint covers configuration, selected
questions/rubrics, and skill files; changed inputs require a fresh run.
A Markdown report records pass counts, retrieval, and individual failures.

## Why keep the runner

[Promptfoo](https://www.promptfoo.dev/docs/providers/custom-script/) supports
script providers and rubric grading. [OpenAI plugin-eval](https://github.com/openai/plugins/tree/main/plugins/plugin-eval)
provides skill analysis and benchmark workflows. Our existing runner already
handles the sourced bank and isolated Codex/Claude sessions; keeping it avoids
an adapter/configuration migration solely to batch judging.

## rc.8 verification checkpoint

Target: published `solid-js`, `@solidjs/web`, `@solidjs/signals`, and compiler
`2.0.0-rc.8`; upstream anchor `f8b40b7e2049d67ceebe1d2e90a1029eb64e097d`.
The bank contains 68 questions; updated keys cover the current contract.

Local verification completed in isolated temporary projects:

- `quick_validate.py` passed for all three skill folders; relative links,
  frontmatter, question IDs/routes, JSON, and `git diff --check` passed.
- TypeScript 7.0.2 strict checks passed for changed API/JSX examples and the
  extracted SWR/socket patterns. An independent agent typechecked three tasks:
  shallow keyed rows, optimistic live acknowledgment, and lazy/dynamic SSR.
- Published-runtime assertion probes passed: refresh result and quiet pending;
  until authoritative acknowledgment, timeout, abort; shallow optimistic rollback;
  invoke direct result/abort; encrypted flash round trips for `0`, `false`, `""`,
  and `null`; buffered stream delivery and cancellation.
- Native compiler directive probes passed for wrapped module-level server exports
  in client/server output. Compiled SSR probes confirmed dynamic fallback streaming
  and first-shell holds for lazy code and `deferStream`.

## rc.8 result — 2026-09-17

Command: `node evals/run.mjs --n 3` (Luna low, Terra medium, batches of eight).
All 408 answers were generated successfully and received valid judgments.

| Repetition | base | with-skill |
|---|---:|---:|
| 1 | 2/68 (2.9%) | 34/68 (50.0%) |
| 2 | 2/68 (2.9%) | 34/68 (50.0%) |
| 3 | 3/68 (4.4%) | 36/68 (52.9%) |
| Total | 7/204 (3.4%) | 104/204 (51.0%) |

Skill retrieval: **204/204**. Required-claim coverage: **134/618 (21.7%)** base,
**455/618 (73.6%)** with-skill. Twenty-seven questions failed whole-answer
criteria in all three with-skill repetitions; reading the skill is reliable,
but completeness still needs work.

| Axis | base | with-skill |
|---|---:|---:|
| API | 2/105 | 54/105 |
| Patterns | 3/69 | 36/69 |
| Solid vs React | 2/15 | 9/15 |
| v2 vs v1 | 0/15 | 5/15 |

Judging used **69 calls**, including 18 retries for malformed/inexact evidence,
versus 408 calls with one judge call per answer. This is a call-count reduction,
not a measured monetary saving. The quote instruction was clarified during
retries; answers, rubrics, and previously valid judgments stayed unchanged.

Local artifacts: `results/run-2026-09-17T17-39-21-926Z.json` and the matching
`.md` report. The JSON records each answer, claim verdict, quote, and repetition;
`results/quote-fix-provenance.json` records the verified fingerprint migration
for the quote-only instruction correction.
