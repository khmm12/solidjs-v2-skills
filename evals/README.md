# Skill evaluations

Compare Solid 2.0 answers with and without installed skills. The question bank
covers APIs, composed patterns, React comparisons, and v1 migration. Reports
track skill retrieval, factual errors, coverage, and whole-answer passes.

## Run

Run commands from the repository root with Node.js. Model evaluations require an
installed, authenticated Codex or Claude CLI; offline tests require neither.

```sh
node evals/run.test.mjs                     # offline harness and scoring checks
node evals/run.mjs --quick                  # four questions, both conditions
node evals/run.mjs                          # full base + with-skill comparison
node evals/run.mjs --questions A31,B19,C1,D2 # focused comparison
node evals/run.mjs --conditions with-skill  # skill-only follow-up
node evals/run.mjs --no-grade               # answers and retrieval only
node evals/run.mjs --grading legacy --quick # checklist-only grading
node evals/run.mjs --resume evals/results/run-<timestamp>.json
node evals/run.mjs --provider claude --models haiku --grader sonnet
```

Defaults: Codex **Luna low** answers; **Astra medium** grades batches of eight.
Other flags: `--models`, `--reasoning`, `--grader-provider`, `--grader`,
`--grader-reasoning`, `--grade-batch-size`, `--concurrency`, `--n`, and
`--questions axis:react` (also `api`, `pattern`, `v1`). Use focused runs during
development and the full bank for regression checks. Batching shares reference
context across answers to reduce judge calls and repeated input.

## Isolation and discovery

- `base`: prior knowledge, with the same version preamble and question, no tools.
  Observed Codex tool activity invalidates a control answer.
- `with-skill`: normal skill discovery and local read-only retrieval. Codex gets
  all three shipped folders under an isolated workspace's `.agents/skills`;
  Claude receives the plugin. Questions contain no skill names, paths, or
  retrieval hints.

Each answer has a fresh session. Codex uses an auth-only temporary home,
read-only sandbox, and disabled personal config. Controls and judges use a
separate workspace without the evaluated skills. Retrieval is recorded
separately: Codex observes skill paths in tool activity; Claude's turn count is
only a proxy.

## Grading

The default `--grading facts` distinguishes correct claims, omissions, and
errors. The judge receives anonymous answers, their sourced rubrics, and the
reference library once per batch. It assesses each required claim and reviews
the rest of the answer for additional factual or implementation errors.
Equivalent implementations count; requested behavior determines correctness.

[facts.mjs](facts.mjs) contains the judge prompt, evidence validation, score
calculation, and Markdown reporting. Keeping these pure functions separate from
[run.mjs](run.mjs) lets offline tests and saved-answer analysis use the same
grading contract without provider calls or session setup.
[facts.test.mjs](facts.test.mjs), included by the runner tests, covers omissions,
contradictions, code defects, uncertainty, and invalid evidence.

Each required claim receives one status:

- `supported`: established by the answer without contradiction; **+1**.
- `missing`: omitted without a contrary assertion or implementation; **0**.
- `incorrect`: a false assertion or code violating the requirement; **−1**.
- `unresolved`: evidence or the rubric needs clarification; left ungraded.

Supported and incorrect decisions need exact answer quotes. Additional errors
also need an exact quote from a supplied source. The runner checks claim coverage,
IDs, status fields, and evidence. Invalid judgments remain ungraded. An API's
absence from a reference is insufficient evidence that it does not exist.

```text
score = 100 × (supported − incorrect − additional_errors) / required_claims
coverage = 100 × supported / required_claims
```

Extra correct assertions earn no bonus. An empty answer has zero coverage and
zero score. Unresolved requirements remain in the coverage denominator, and
score is N/A until every assessment is complete. Reports show:

- Answers with confirmed errors and critical errors, over assessed answers.
- Coverage, including macro coverage that weights each assessed answer equally.
- Supported, missing, incorrect, unresolved, and rubric-defect counts.
- Complete assessments and excluded provider/format failures.
- Whole-answer passes over all answers: every requirement supported, a complete
  audit, and no additional errors.

The historical checklist result is reported separately. `grade.pass` describes
required claims only; the additional audit can still find errors. Error counts
represent grading decisions, not deduplicated implementation bugs. Reports
identify the bank and metric version for comparisons.

The judge performs semantic review. Typechecking and runtime tests verify the
generated code separately. For disputed grades, inspect the saved answer,
question, and reference evidence before changing the rubric. To compare judges,
use fixed, source-labeled answers containing correct claims, omissions,
contradictions, and equivalent implementations; measure false accepts and false
rejects separately.

## Results and resume

`results/` is git-ignored. Answers and grades are checkpointed atomically in
`run-*.json`; matching Markdown reports summarize retrieval and quality overall
and by axis. JSON includes `factual_summary` and frozen copies of questions,
references, configuration, and runner/grader source.

Resume with the original flags plus `--resume <run.json>`. Valid answers and
grades are reused; provider and format failures are retried. Unresolved semantic
decisions require adjudication, not an automatic retry. Incomplete assessments
make the run exit nonzero.

The fingerprint covers configuration, questions, rubrics, skills, and evaluator
source. Changed inputs require a fresh run. Use frozen inputs when reviewing an
older result; compare scores across bank revisions only after regrading saved
answers whose questions still match.

## Maintain the bank

Edit [questions.json](questions.json). IDs use `A` for APIs, `B` for patterns,
`C` for React comparisons, and `D` for v1 comparisons.

Each `must_include` claim must trace to a verified reference through `source`,
and the question must request the behavior it grades. Encode semantic negatives
as positive required claims. `must_not` regex matches are optional audit hints,
not verdicts; review their context. Add or update a question when teaching a new
rule or footgun, then run the offline checks and a focused model comparison.

Keep independent requirements in separate entries. Entries combine with AND;
explicit alternatives within an entry combine with OR. Version semantic rubric
changes with `meta.rubric_revision`. Preserve isolation and discovery when fixing
eval bugs. Follow the [repository verification rules](../AGENTS.md#ground-truth-in-priority-order)
for API claims and changed examples.
