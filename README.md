# SolidJS v2 skills

Coding agents are good at React, shaky on Solid 1, and largely clueless about
Solid 2. Without extra context, they reach for React's render model, use old
Solid APIs, or invent APIs that do not exist.

These skills teach agents to think in Solid 2 terms and write working Solid 2
code. They cover new code, migration from Solid 1.x, and review, with examples
for reactivity, async data, stores, DOM, and server rendering.

Works with Codex, Claude Code, and other agents supported by
[`npx skills`](https://github.com/vercel-labs/skills#supported-agents).

Current Solid version: `solid-js@2.0.0-rc.8` and
`@solidjs/web@2.0.0-rc.8`.

## Install

Run this in your project and choose the skills and agents to install:

```sh
npx skills add khmm12/solidjs-v2-skills
```

Add `-g` to make the skills available across projects. Choose one installation
method per agent to avoid duplicate copies.

<details>
<summary>Install as a Codex plugin</summary>

```sh
codex plugin marketplace add khmm12/solidjs-v2-skills
codex plugin add solidjs-v2-skills@solidjs-v2-skills
```

Start a new Codex session after installation. To refresh the marketplace:

```sh
codex plugin marketplace upgrade solidjs-v2-skills
```

For a local clone, pass its absolute path to `codex plugin marketplace add`.

</details>

<details>
<summary>Install as a Claude Code plugin</summary>

Run these commands inside Claude Code:

```text
/plugin marketplace add khmm12/solidjs-v2-skills
/plugin install solidjs-v2-skills@solidjs-v2-skills
```

For a local clone, replace the repository name with its absolute path.

</details>

<details>
<summary>Install individual skills, use a local clone, or update</summary>

Install one skill:

```sh
npx skills add khmm12/solidjs-v2-skills --skill solidjs-v2
```

Install from a local clone:

```sh
npx skills add ./solidjs-v2-skills
```

Update skills installed through `npx skills`:

```sh
npx skills update
```

</details>

## Skills

| Skill | Use it for |
|---|---|
| [solidjs-v2](skills/solidjs-v2/SKILL.md) | Writing Solid 2 code: reactivity, stores, async data, actions, DOM, and server rendering. |
| [solidjs-v2-migration](skills/solidjs-v2-migration/SKILL.md) | Converting Solid 1.x code, with an API rename map and migration recipes. |
| [solidjs-v2-reviewer](skills/solidjs-v2-reviewer/SKILL.md) | Reviewing diffs for reactivity bugs, stale APIs, and ownership or cleanup issues. |

The same skill folders work across hosts. Before editing a project, each skill
checks the installed Solid major. A 1.x project keeps its existing conventions
unless you ask for a migration.

## Usage

Describe the task in your agent as usual. For example:

- "Add a live message feed with a loading state and cleanup on channel changes."
- "Migrate this Solid 1.x component to Solid 2."
- "Review this diff for Solid 2 reactivity bugs."

The agent selects the relevant skill from the task. You can also request a skill
by name.

## Results

Without the skills, Codex Luna at low reasoning failed to compile all three
practical coding tasks. With the skills, all three implementations passed strict
TypeScript and the behavior checks.

The broader skill-only evaluation covered 71 answers. Luna found the relevant
skill every time, scored **95.8%**, and produced **64/71** answers without a
confirmed error.

## Contributing

[Open an issue](https://github.com/khmm12/solidjs-v2-skills/issues) for an incorrect
example, missing pattern, or installation problem. Include the package version
and a small reproduction.

For reference changes, cite published typings or upstream source and typecheck
changed examples against the documented Solid version. Update the corresponding
evaluation question, then run the offline checks:

```sh
node evals/run.test.mjs
```

The [evaluation guide](evals/README.md) covers model comparisons, scoring,
and focused runs.
