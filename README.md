# solidjs-v2-skills

Agent skills for SolidJS 2.0 (`solid-js@2.x` / `next` betas).

Solid 2.0 is a near-total API rework: microtask batching, split effects, async
computations instead of `createResource`, draft-first stores, `@solidjs/web`
imports. LLM priors from React and Solid 1.x are the dominant bug source —
these skills encode the 2.0 model and the footgun lists so agents write,
migrate, and review v2 code correctly.

## Skills

| Skill | Use case |
|---|---|
| `solidjs-v2` | Writing/editing Solid 2.0 code. Ten core rules + topic references (reactivity, async/actions, stores, control flow/DOM, server functions, experimental server components, TypeScript setup, composed patterns) + a verbatim copy of the official CHEATSHEET. |
| `solidjs-v2-migration` | Migrating a 1.x codebase/file to 2.0. Four-pass workflow (mechanical → semantic → diagnostics-driven → behavioral audit) + full rename/removal map with recipes. |
| `solidjs-v2-reviewer` | Reviewing Solid 2.0 diffs for React-isms, 1.x-isms, and reactivity bugs. Greppable smell tables with severity + judgement checklist. |

All three auto-trigger from their descriptions when the task matches; they
detect the project's Solid major version first and refuse to apply v2 rules to
a 1.x codebase.

## Install

Pick **one** method — combining them loads every skill twice.

### Option A — `npx skills` (recommended)

[vercel-labs/skills](https://github.com/vercel-labs/skills) installs into
Claude Code and ~70 other agents:

```sh
npx skills add khmm12/solidjs-v2-skills            # into the current project
npx skills add khmm12/solidjs-v2-skills -g         # globally (~/.claude/skills)
npx skills add khmm12/solidjs-v2-skills@solidjs-v2 # a single skill
```

From a local clone: `npx skills add ./solidjs-v2-skills`.
Update later with `npx skills update`.

### Option B — Codex plugin (versioned, namespaced)

The repo is also a native Codex plugin and self-hosting marketplace:

```sh
codex plugin marketplace add khmm12/solidjs-v2-skills
codex plugin add solidjs-v2-skills@solidjs-v2-skills
```

From a local clone instead of GitHub:

```sh
codex plugin marketplace add /absolute/path/to/solidjs-v2-skills
codex plugin add solidjs-v2-skills@solidjs-v2-skills
```

Start a new Codex session after installation so the bundled skills are loaded.
Refresh the Git-backed marketplace later with:

```sh
codex plugin marketplace upgrade solidjs-v2-skills
```

Codex uses `.codex-plugin/plugin.json`; Claude Code compatibility is kept
alongside it without duplicating the shared `skills/` content.

### Option C — Claude Code plugin (versioned, namespaced)

The repo is a self-hosting plugin marketplace. In Claude Code:

```
/plugin marketplace add khmm12/solidjs-v2-skills
/plugin install solidjs-v2-skills@solidjs-v2-skills
```

From a local clone instead of GitHub:

```
/plugin marketplace add ~/path/to/solidjs-v2-skills
/plugin install solidjs-v2-skills@solidjs-v2-skills
```

Plugin skills are namespaced (`solidjs-v2-skills:solidjs-v2`); auto-triggering
is unaffected. Update later with `/plugin` → manage, or
`/plugin marketplace update solidjs-v2-skills`.

### Option D — personal skills (plain symlinks)

Symlink each skill into `~/.claude/skills/` (directory symlinks are picked up):

```sh
git clone https://github.com/khmm12/solidjs-v2-skills.git
cd solidjs-v2-skills
for s in solidjs-v2 solidjs-v2-migration solidjs-v2-reviewer; do
  ln -sfn "$(pwd)/skills/$s" ~/.claude/skills/$s
done
```

Unnamespaced, instant, updates via `git pull`. No plugin machinery.

## Sources & versioning

Distilled from `documentation/solid-2.0/` (MIGRATION.md + RFC 01–11) and
`packages/solid/CHEATSHEET.md` at solidjs/solid `next@90fcbd0a`
(solid-js@2.0.0-beta.28), with API surface verified against the **published**
package typings — the betas churn the public API freely: documented, public
APIs can vanish (e.g. `isRefreshing` was a public `solid-js` export from beta.0
through beta.14, removed wholesale in beta.15), and pending `.changeset/`
entries must be checked before documenting beta-only APIs. At the beta.28
anchor all changesets are consumed by prerelease history; none queue a later
API change.

When the beta advances, see the maintenance procedure in [AGENTS.md](AGENTS.md).

## Eval

The dependency-free exam runner supports Claude and Codex answer backends over
the same rubric bank. It separates a no-skill control, perfect content routing,
and agentic skill retrieval:

```sh
node evals/run.mjs --quick
node evals/run.mjs --provider codex --models gpt-5.6-luna --quick
```

Codex runs are ephemeral, use an auth-only temporary `CODEX_HOME` plus a
read-only sandbox, and reject tool-contaminated control cells. See
[evals/PLAN.md](evals/PLAN.md) for condition semantics, grading, and
release-grade runs.
