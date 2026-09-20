# solidjs-v2-skills

SolidJS 2.0 skills for coding agents, checked against published packages and
upstream source.

Solid 2.0 changed enough of the framework that code based on Solid 1.x or
React habits can look plausible and still be wrong. This repository gives
agents a verified v2 reference for writing new code, migrating 1.x projects,
and reviewing diffs.

> Current target: `solid-js@2.0.0-rc.8` and `@solidjs/web@2.0.0-rc.8`.

Luna low passed **55/68 questions (80.9%)** with implicit skill discovery,
graded by Terra medium. This is one full rc.8 run with all judgments valid;
repeatability has not yet been established.

## What's included

| skill | use it for |
|---|---|
| `solidjs-v2` | Writing and editing Solid 2.0 code. Covers reactivity, async data and actions, stores, control flow, DOM, server functions, experimental server components, and TypeScript. |
| `solidjs-v2-migration` | Moving a Solid 1.x codebase or file to 2.0. Includes a four-pass workflow and a rename/removal map with recipes. |
| `solidjs-v2-reviewer` | Reviewing Solid 2.0 diffs for React habits, 1.x APIs, and reactivity bugs. Includes a concise behavior checklist and evidence-based findings. |

The three skills share the same reference files across Codex, Claude Code, and
`npx skills`; there are no host-specific copies to drift apart. Each skill
checks the installed Solid major first and refuses to apply v2 rules to a 1.x
project.

## Install

Choose one installation method. Installing the same skills through several
hosts will load duplicate copies.

### `npx skills` (recommended)

[`vercel-labs/skills`](https://github.com/vercel-labs/skills) works with Claude
Code and many other agents.

```sh
npx skills add khmm12/solidjs-v2-skills
```

Add `-g` for a global install, or install one skill only:

```sh
npx skills add khmm12/solidjs-v2-skills -g
npx skills add khmm12/solidjs-v2-skills@solidjs-v2
```

From a local clone, use `npx skills add ./solidjs-v2-skills`. Update later with
`npx skills update`.

<details>
<summary>Install as a Codex plugin</summary>

```sh
codex plugin marketplace add khmm12/solidjs-v2-skills
codex plugin add solidjs-v2-skills@solidjs-v2-skills
```

For a local clone:

```sh
codex plugin marketplace add /absolute/path/to/solidjs-v2-skills
codex plugin add solidjs-v2-skills@solidjs-v2-skills
```

Start a new Codex session after installation. Refresh the Git-backed
marketplace with:

```sh
codex plugin marketplace upgrade solidjs-v2-skills
```

</details>

<details>
<summary>Install as a Claude Code plugin</summary>

```text
/plugin marketplace add khmm12/solidjs-v2-skills
/plugin install solidjs-v2-skills@solidjs-v2-skills
```

For a local clone, replace the repository name in the first command with its
absolute path. Plugin skills are namespaced as
`solidjs-v2-skills:solidjs-v2`; auto-triggering is unchanged.

</details>

<details>
<summary>Install as personal symlinks</summary>

```sh
git clone https://github.com/khmm12/solidjs-v2-skills.git
cd solidjs-v2-skills
for skill in solidjs-v2 solidjs-v2-migration solidjs-v2-reviewer; do
  ln -sfn "$(pwd)/skills/$skill" ~/.claude/skills/$skill
done
```

This is unnamespaced and updates immediately with `git pull`.

</details>

## Version and sources

The references are distilled from Solid's `documentation/solid-2.0/`
(MIGRATION.md and RFC 01–12) and the official `packages/solid/CHEATSHEET.md` at
[`solidjs/solid@f8b40b7e`](https://github.com/solidjs/solid/tree/f8b40b7e2049d67ceebe1d2e90a1029eb64e097d).
The [upstream cheatsheet](https://github.com/solidjs/solid/blob/f8b40b7e2049d67ceebe1d2e90a1029eb64e097d/packages/solid/CHEATSHEET.md)
is source material rather than a bundled duplicate. API claims use published rc.8
typings first, then upstream sources and tests.

Solid 2.0 is still a prerelease. Before teaching a new API, the maintenance
workflow also checks pending upstream changesets. See [AGENTS.md](AGENTS.md)
for the full update procedure.

## Run the exam

```sh
node evals/run.mjs --n 3    # three runs: Luna low, base vs with-skill
node evals/run.mjs --quick  # four-question smoke test
```

Terra grades eight answers per call against a source-backed rubric. Answers and
scores are saved in `evals/results/`; interrupted runs can resume.
See [evals/README.md](evals/README.md) for requirements, options, and methodology.
