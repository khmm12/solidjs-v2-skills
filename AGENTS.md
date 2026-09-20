# AGENTS

This repo is a Claude Code and Codex plugin containing skills for SolidJS 2.0.
The deliverable is **reference content** — correctness of API claims is the
whole product. There is no product build. Verify content with published typings, small runtime
probes, and the skill exam.

Coding agents bring strong React assumptions, weak Solid 1 knowledge, and
almost no reliable Solid 2 knowledge. These skills teach the Solid 2 mental
model and APIs so agents can write working code instead of filling gaps with
React patterns, old Solid APIs, or invented APIs.

## Structure

- `.claude-plugin/plugin.json` + `marketplace.json` — Claude Code plugin
  manifest and self-hosting marketplace.
- `.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json` — Codex
  plugin manifest and self-hosting marketplace. Both hosts load the same
  skill folders under `skills/`; never duplicate the skill content.
- `skills/<name>/SKILL.md` — frontmatter `name` MUST equal the folder name;
  `description` is the auto-trigger surface (state when to use AND when not).
  This layout is also what `npx skills` (vercel-labs/skills) discovers: keep
  skills exactly one level under `skills/`, keep `name`/`description` plain
  YAML strings, and remember the whole skill folder is copied on install —
  references must stay inside their skill's folder.
- `skills/solidjs-v2/references/*.md` — topic distillations. They inherit the
  exact reference version from their skill's root `SKILL.md`. Keep them rule +
  canonical example + footgun; no RFC prose dumps.

## Ground truth, in priority order

Solid 2.0 docs are prerelease RFCs ("proposal-shaped") and drift from reality in
both directions. When sources disagree:

1. **Published npm typings** (`solid-js`, `@solidjs/web`, `@solidjs/signals`
   in a real project's `node_modules`) — what users actually compile against.
2. Upstream repo sources and tests (`packages/solid*/src`, `test/*.spec.ts`).
3. RFC docs / MIGRATION.md / CHEATSHEET.

Before documenting any prerelease-only API, grep the upstream `.changeset/`
directory for its scheduled fate.

## Editing rules

- **No API claim without verification.** New or changed signatures must be
  checked against ground truth before they land in a reference file — not in a
  cleanup pass later. Don't invent replacements for removed APIs; if upstream
  has no equivalent, say so explicitly.
- Idioms taught here should be **compile-verified**: typecheck a sample using
  them against the installed prerelease (`tsc` in any project pinned to the target
  version) — grep for old names is not verification.
- **New teaching content gets an eval question.** When a reference file gains a
  new rule or footgun, add (or update) a question in `evals/questions.json` — see
  *Skill exam* below. Every `must_include` claim must trace to the reference you
  just wrote.
- Keep the three skills non-overlapping: `solidjs-v2` = write new code,
  `solidjs-v2-migration` = convert 1.x, `solidjs-v2-reviewer` = audit diffs.
  Keep the v1 rename map in the migration skill. The reviewer checks target
  behavior; verify agreement across all three skills after editing shared rules.
- Every skill keeps its version-detection step (Solid major check) — these
  skills must refuse to apply v2 rules to 1.x projects.

## Skill exam (evals/)

Evaluate ordinary development tasks as well as API explanations. Verify generated
implementations with typechecks and runtime assertions. Factual scoring is +1
supported, 0 missing, -1 incorrect; report errors before coverage and score.
Practical rubrics constrain behavior, not a preferred implementation, and
distinguish dev advisories from failures.

`evals/` is a rubric-graded exam that measures whether a model answers Solid 2.0
questions correctly **with** the skill vs. without it — the regression net for
reference content.

- `questions.json` — the bank. Each question carries `must_include` (claims the
  answer must assert, **each traceable to a reference** via `source`) and `must_not`
  (optional wrong-answer audit patterns). `meta.note` is binding: never add a
  `must_include` you cannot source — a wrong answer key silently inverts the eval.
  Encode semantic negatives as positive `must_include` claims; keep `must_not` for
  optional audit hints whose matches need contextual review; grade semantic
  correctness through `must_include`. IDs are axis-prefixed: `A`=api, `B`=pattern, `C`=react (vs
  React), `D`=v1 (vs 1.x).
- `run.mjs` compares `base` (prior knowledge) with `with-skill` (tool retrieval).
  Default: Codex Luna/low answers, Astra/medium grades batches of eight answers
  against the sourced rubric and shared references, auditing extra claims/code.
  Each answer runs in an isolated session. Coverage, errors, uncertainty, and
  whole-answer passes are separate; omissions are not hallucinations.
- `facts.mjs` owns the factual judge prompt, evidence validation, scoring, and
  reports. Its offline tests are included by `run.test.mjs`.
- Run `node evals/run.test.mjs` for offline runner checks; `node evals/run.mjs`
  for the full exam. Use `--quick` or `--questions A5,B5,B6` for focused runs.
- `results/` is git-ignored. Answers and grades are checkpointed after each call;
  resume an interrupted run with the same flags plus `--resume <run.json>`.
  See [evals/README.md](evals/README.md) for requirements, isolation, and scoring.

## When the Solid prerelease advances

1. Resolve the newest published v2 version from npm (including prereleases)
   and anchor its exact `gitHead`. Compare the upstream cheatsheet as evidence;
   keep teaching content in maintained topic references.
2. Diff upstream `documentation/solid-2.0/` and `.changeset/` since the last
   anchored commit; fold API changes into the affected reference files.
3. Re-verify drift-prone claims against the new published typings (removed
   exports, option overloads, and `refresh()`/pending semantics).
4. Bump the reference target in each root `SKILL.md`, `version` in both plugin
   manifests, and the Solid version in README.
5. Re-run `evals/` and fix any question whose answer key moved — a removed or
   renamed API shifts the rubric, so update `must_include`/`source` rather than
   leaving a stale (silently inverted) answer key.

## Writing rules

- Teach the current verified v2 contract. Keep v1-to-v2 conversion in the migration
  map; omit beta-to-RC history and prerelease changelogs from skills.
- State the action to take, followed by its reason or concrete limitation.
  Prefer correct examples; keep old names only where migration/review needs them.
- Write for a capable agent with low reasoning: explicit imports, callback shapes,
  ownership, and completion criteria; explain a necessary term at first use.
- Keep SKILL.md to purpose, version gate, essential model, task routing, and checks.
  Keep each reference to one topic, with rules and small canonical examples.
  Prune repeated explanations and copied manuals instead of adding summaries.
- Teach Solid's setup-once/tracked-read model separately from React, and v2's
  batching/split effects/async model separately from v1. Preserve facts shared by
  both Solid majors (for example JSX getter props and v1 For's raw item).
- Keep each detailed rule in one reference. Links inside an installed skill stay
  in that folder; companion-skill pointers include a standalone fallback.
- Every new rule/footgun gets a source-backed eval. Update existing answer keys
  when behavior changes; remove regex negatives that match correct explanations.
- Compile changed examples against the target packages. Probe disputed runtime
  semantics in an isolated temporary project; report checks separately from
  model-eval results. Use focused Luna/low base+with-skill runs to check clarity.
