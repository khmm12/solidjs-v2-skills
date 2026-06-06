# AGENTS

This repo is a Claude Code plugin containing skills for SolidJS 2.0. The
deliverable is **reference content** — correctness of API claims is the whole
product. There is no build step and no tests; verification is editorial.

## Structure

- `.claude-plugin/plugin.json` + `marketplace.json` — plugin manifest and
  self-hosting marketplace. Skill folders under `skills/` are auto-discovered;
  nothing is declared in the manifest.
- `skills/<name>/SKILL.md` — frontmatter `name` MUST equal the folder name;
  `description` is the auto-trigger surface (state when to use AND when not).
  This layout is also what `npx skills` (vercel-labs/skills) discovers: keep
  skills exactly one level under `skills/`, keep `name`/`description` plain
  YAML strings, and remember the whole skill folder is copied on install —
  references must stay inside their skill's folder.
- `skills/solidjs-v2/references/*.md` — topic distillations. Each starts with a
  version marker line ("Verified against …"). Keep them rule + canonical
  example + footgun; no RFC prose dumps.
- `skills/solidjs-v2/references/cheatsheet.md` — **verbatim copy** of upstream
  `packages/solid/CHEATSHEET.md` with an attribution header. Never edit its
  body; refresh from upstream instead.

## Ground truth, in priority order

Solid 2.0 docs are beta-RFCs ("proposal-shaped") and drift from reality in
both directions. When sources disagree:

1. **Published npm typings** (`solid-js`, `@solidjs/web`, `@solidjs/signals`
   in a real project's `node_modules`) — what users actually compile against.
2. Upstream repo sources and tests (`packages/solid*/src`, `test/*.spec.ts`).
3. RFC docs / MIGRATION.md / CHEATSHEET.

Before documenting any beta-only API, grep the upstream `.changeset/` directory
for its scheduled fate (precedent: `isRefreshing` shipped in beta.14 typings,
undocumented, with its removal already queued).

## Editing rules

- **No API claim without verification.** New or changed signatures must be
  checked against ground truth before they land in a reference file — not in a
  cleanup pass later. Don't invent replacements for removed APIs; if upstream
  has no equivalent, say so explicitly.
- Idioms taught here should be **compile-verified**: typecheck a sample using
  them against the installed beta (`tsc` in any project pinned to the target
  version) — grep for old names is not verification.
- Keep the three skills non-overlapping: `solidjs-v2` = write new code,
  `solidjs-v2-migration` = convert 1.x, `solidjs-v2-reviewer` = audit diffs.
  Cross-reference instead of duplicating content; the migration map and the
  reviewer tables intentionally repeat the rename list — keep those two in
  sync when either changes.
- Every skill keeps its version-detection step (Solid major check) — these
  skills must refuse to apply v2 rules to 1.x projects.

## When the solid beta advances

1. Refresh `references/cheatsheet.md` from upstream
   `packages/solid/CHEATSHEET.md`; update the attribution header (commit SHA +
   package version).
2. Diff upstream `documentation/solid-2.0/` and `.changeset/` since the last
   anchored commit; fold API changes into the affected reference files.
3. Re-verify drift-prone claims against the new published typings
   (deprecation caveats like `isRefreshing`, `refresh()` cascade semantics).
4. Bump version markers in reference files, `version` in
   `.claude-plugin/plugin.json`, and the anchor commit/version in README.
