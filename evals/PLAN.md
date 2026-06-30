# Skill exam — test plan

Measures whether the SolidJS 2.0 skills actually move a model off its wrong
priors. The deliverable of this repo is reference content; this eval is how we
tell whether that content is doing its job and whether an edit improved or
regressed it (precedent: a single "before paint" phrase once made an answer
*worse* than baseline — exactly what this catches).

## What it tests

Four axes, sourced from the verified references (`skills/solidjs-v2/references/`):

| Axis | Question | What a wrong answer looks like |
|---|---|---|
| `api` | API understanding — signatures, what exists / was removed | invented args, `createResource`, importing removed `isRefreshing` |
| `pattern` | Idiomatic basic patterns | `getBoundingClientRect` in a `ref`, "createEffect flashes" |
| `react` | Solid vs React | destructured props, deps array, passing accessors as values |
| `v1` | Solid 2.0 vs 1.x | `batch()`, `onMount`, `solid-js/store`, `<Index>`, `createSelector` |

The v1 and react axes matter most: models were trained on a corpus with **no
Solid 2.0**, so their default is React or Solid 1.x. The eval asks whether the
skill overrides that.

## The three conditions (this is the design decision)

Each question is asked verbatim (same prompt, Solid version stated inline) under:

- **`base`** — bare model, no skill. The control.
- **`deployed`** — `claude -p --plugin-dir <repo> --allowedTools Read,Glob,Grep`.
  The model auto-triggers and routes the real skill, reading references with its
  own tools. **This is the actual product** and the headline "со skill" number:
  it measures trigger + routing + content together.
- **`content`** — `SKILL.md` + the *one* topically-routed reference injected as a
  system prompt. Simulates perfect routing and isolates **content quality** from
  trigger/routing reliability. This is the iteration diagnostic — when an edit
  changes a score here, it's the words that changed it, not luck in routing.

We deliberately do **not** inject all seven references at once: that reports a
number for a config nobody ships and multiplies cross-contamination between
references (the failure mode behind the original Q5 regression).

`deployed` is the truth about the shipped skill; `content` is the microscope for
editing it. Read them together: if `content` passes but `deployed` fails, the
content is right but the skill isn't triggering/routing — a description problem,
not a content problem.

## Two axes, measured separately: delivery vs quality

These are different failures and must not be averaged into one number:

- **Delivery (auto-attachment)** — does the model actually open the skill? In
  `deployed` mode the skill is read via tools, so **>1 turn = the skill was
  consulted**; a 1-turn answer means the model replied from its priors without
  ever opening it. This is reported as a **trigger rate** and needs **no grading**
  — the signal is already in the response metadata. Run it with `--no-grade` and
  it's nearly free. (Observed: weak models like haiku skip the skill on questions
  that don't name an API verbatim — trigger rate well under 100%.)
- **Quality (content)** — when the skill IS in context (`content` mode, perfect
  routing), are the answers right? This is the graded number.

A low delivery rate with high content quality points the fix at the **SKILL.md
description / trigger surface**, not the reference text. A high delivery rate with
low content quality points at the reference text. Conflating them sends you
editing the wrong file.

## Grading

An LLM grader (default `sonnet`) checks each answer against the rubric in
`questions.json`. Two guards keep the grader honest, because the grader has the
same Solid-2.0 blind spot as the subjects:

1. **The rubric is the sole source of truth.** The grader is instructed to judge
   only "does the answer assert these exact claims," never to decide what's
   correct about Solid from its own (stale) knowledge. It must quote the answer
   verbatim as evidence for each met claim. It's blind to which condition produced
   the answer.
2. **Forbidden APIs are judged by intent, not by substring.** These questions are
   contrast-heavy — a correct answer *must* mention `batch()`, `createResource`,
   `<Index>` to say "don't use this". A regex can't tell recommend from mention, so
   it would false-fail good answers. Instead `must_not` is handed to the grader as a
   forbidden list with the explicit rule: fail only if the answer **adopts** one in
   its own solution; contrasting against it is correct. The regexes still run, but
   only as a **non-fatal audit flag** in the raw JSON (a human-reviewable "this token
   appeared") — they never decide pass/fail.

Every rubric claim carries a `source` pointing at the reference lines it came
from. **Do not add a claim you can't trace to a verified reference or the
installed typings** — a confidently-wrong answer key silently inverts the eval.

Raw answers + per-claim verdicts are saved (`results/run-*.json`) so any score is
auditable by hand. Trust the **aggregate pass-rate per (model, condition)**, not
single-question swings — N is small and the models are nondeterministic.

## Running

```bash
node evals/run.mjs --quick      # smoke test the harness: 4 Q, haiku, base+deployed, N=1
node evals/run.mjs              # full: all Q, sonnet+haiku, base+deployed, N=1
node evals/run.mjs --conditions base,content,deployed --n 3   # add content mode, smooth noise
node evals/run.mjs --questions axis:react                     # one axis
node evals/run.mjs --questions B1,B2 --conditions content     # iterate on one edit (cheapest)
node evals/run.mjs --conditions deployed --no-grade           # delivery/trigger rate only (near-free)
```

Flags: `--models`, `--conditions`, `--n`, `--grader`, `--concurrency`,
`--questions` (csv ids or `axis:<name>`), `--quick`, `--no-grade`.

Output: a markdown summary (delivery trigger rate + quality pass-rate matrix +
per-axis + failure list) and a raw JSON. `results/` is git-ignored — it's run
output, not a committed artifact. Every claude call runs in a neutral empty cwd so
`base`/`content` can't read the repo's own reference files off disk (that would
contaminate the control).

## Token economy (what costs what, and how to not overpay)

The dominant cost is `deployed`: it's multi-turn (the model reads references). Order
of cost per answer: `base` ≈ `content` (single turn) ≪ `deployed` (several turns).
Grading is a single extra short call per answer. So:

- **Iterate content in `content` mode only.** Single-turn, deterministic routing,
  graded — this is where edits get validated. You almost never need `deployed`
  while tuning the words.
- **Measure delivery separately and ungraded.** `--conditions deployed --no-grade`
  gives the trigger rate with zero grading spend. Run it occasionally, not every
  iteration.
- **Drop `base` from routine runs.** It's the control — run it once to anchor, not
  every time. (And in clean cwd it's now a true prior-only baseline.)
- **Grader can be cheaper.** It's rubric-bound and explicitly forbidden from using
  its own Solid knowledge, so a smaller grader (`--grader haiku`) is defensible;
  spot-check agreement against `sonnet` on one run before trusting it wholesale.
- **Subset with `--questions`** while iterating; run the full bank only to confirm a
  finished edit.
- Reach for the full `sonnet+haiku × base+content+deployed × N3` matrix only for a
  release-grade snapshot, not day-to-day.

## What to read in the result

- `base` vs `deployed` on the **react** and **v1** axes = the skill's headline
  value (overriding wrong priors).
- A question where `base` already passes isn't a skill failure — it's a
  non-discriminating question; the signal lives in the trap questions.
- `content` worse than `base` on any question = a content regression. Fix the
  wording, re-run that question in `content` mode, confirm before shipping.
