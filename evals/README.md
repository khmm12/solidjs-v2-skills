# Skill exam

Measures whether agents can discover the installed skills and correctly use
Solid 2.0. The exam covers current APIs, composed patterns, Solid vs React,
and Solid v2 vs v1. It checks answers, not just skill retrieval.

## Requirements

Target: **more than 80% whole-answer passes on the full bank with skills**,
using Luna low. Agents should:

- Use Solid's reactive model instead of React mechanics.
- Use the verified v2 contract instead of v1-only mechanics.
- Implement composed patterns correctly, including ownership, async behavior,
  and cleanup.

Preserve the harness's difficulty and isolation. Question prompts must contain
no skill name, path, "see here" hint, or routing instruction: agents discover
the installed skills and relevant information themselves.

Eval bugs and incorrect answer keys may be fixed with verified evidence.
Do not weaken valid requirements to raise the score. API claims follow the
[repository verification rules](../AGENTS.md#ground-truth-in-priority-order);
changed examples must compile against the target version.

Conserve tokens: diagnose with focused runs, retry invalid judgments using saved
answers, and run the full bank at a stable checkpoint. Selected passing questions
or required-claim coverage do not substitute for the full score.

Acceptance requires valid judgments for the entire bank. Report overall and
per-axis pass counts, retrieval, invalid cells, and limitations separately.
A single full run does not establish repeatability.

## Run

Run commands from the repository root. The selected provider's CLI must be
installed and authenticated.

```sh
node evals/run.test.mjs                     # offline harness checks
node evals/run.mjs                          # full base + with-skill comparison
node evals/run.mjs --quick                  # four questions, both conditions
node evals/run.mjs --questions A31,B19,C1,D2 # focused comparison
node evals/run.mjs --conditions with-skill  # skill-only follow-up
node evals/run.mjs --no-grade               # answers and retrieval only
node evals/run.mjs --resume evals/results/run-<timestamp>.json
node evals/run.mjs --provider claude --models haiku --grader sonnet
```

Defaults: Codex **Luna low** answers; **Terra medium** grades batches of eight.
Other flags: `--models`, `--reasoning`, `--grader-provider`, `--grader`,
`--grader-reasoning`, `--grade-batch-size`, `--concurrency`, `--n`, and
`--questions axis:react` (also `api`, `pattern`, `v1`).

## Isolation and discovery

- `base`: prior knowledge, with the same version preamble and question, no tools.
  Observed Codex tool activity invalidates a control answer.
- `with-skill`: normal skill discovery and local read-only retrieval. Codex gets
  all three shipped folders under an isolated workspace's `.agents/skills`;
  Claude receives the plugin. No question-specific retrieval hints are injected.

Each answer has a fresh session. Codex uses an auth-only temporary home,
read-only sandbox, and disabled personal config. Controls and judges use a
separate workspace without the evaluated skills. Retrieval is recorded
separately: Codex observes skill paths in tool activity; Claude's turn count is
only a proxy.

## Grading

The judge receives anonymous answers with their own sourced rubrics, without
model or condition labels. An answer passes only if every `must_include` claim
is met. Equivalent behavior and code count; contradictory code fails even when
the surrounding prose is correct. Support can span paragraphs or code blocks;
alternative examples are not cumulative requirements.

Every met claim needs a verbatim answer quote. Every unmet claim needs a concrete
missing or contradictory behavior. The runner validates IDs, full claim
coverage, booleans, quotes, and failure explanations. Invalid judgments and
provider errors stay ungraded, are excluded from pass rates, and make the run
exit nonzero. An incomplete run cannot satisfy acceptance.

Batching reduces judge calls, not the answer/rubric tokens that must be read.
Use `--grade-batch-size 1` for a per-answer audit. Inspect disputed verdicts in
the raw JSON before changing content or keys. The model judge is not a compiler:
typecheck representative generated implementations and probe runtime behavior
separately, especially for composed patterns.

## Results and resume

`results/` is git-ignored. Each answer and judge batch is saved atomically in
`run-*.json`; the matching Markdown report lists pass counts, retrieval, and
failures. Keep experiment history in these artifacts, not in this README.

Resume with the original flags plus `--resume <run.json>`. Valid answers and
grades are reused; failed calls are retried. The fingerprint covers configuration,
selected questions/rubrics, and skill files. Changed inputs require a fresh run.

## Maintain the bank

Edit [questions.json](questions.json). IDs use `A` for APIs, `B` for patterns,
`C` for React comparisons, and `D` for v1 comparisons.

Each `must_include` claim must trace to a verified reference through `source`,
and the question must request the behavior it grades. Encode semantic negatives
as positive required claims. `must_not` regex matches are optional audit hints,
not verdicts; review their context. Add or update a question when teaching a new
rule or footgun, then run the offline checks and a focused model comparison.
