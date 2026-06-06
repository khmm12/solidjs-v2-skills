# solidjs-v2-skills

Claude Code skills for SolidJS 2.0 (`solid-js@2.x` / `next` betas).

Solid 2.0 is a near-total API rework: microtask batching, split effects, async
computations instead of `createResource`, draft-first stores, `@solidjs/web`
imports. LLM priors from React and Solid 1.x are the dominant bug source —
these skills encode the 2.0 model and the footgun lists so agents write,
migrate, and review v2 code correctly.

## Skills

| Skill | Use case |
|---|---|
| `solidjs-v2` | Writing/editing Solid 2.0 code. Ten core rules + topic references (reactivity, async/actions, stores, control flow/DOM, TypeScript setup, composed patterns) + a verbatim copy of the official CHEATSHEET. |
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

### Option B — Claude Code plugin (versioned, namespaced)

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

### Option C — personal skills (plain symlinks)

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

Distilled from `documentation/solid-2.0/` (MIGRATION.md + RFC 01–09) and
`packages/solid/CHEATSHEET.md` at solidjs/solid `next@bff4c21`
(solid-js@2.0.0-beta.14), with API surface verified against the **published**
package typings — betas drift in both directions: published `@solidjs/signals`
carries APIs absent from the docs (e.g. `isRefreshing`), and pending
`.changeset/` entries remove APIs that today's typings still ship.

When the beta advances, see the maintenance procedure in [CLAUDE.md](CLAUDE.md).
