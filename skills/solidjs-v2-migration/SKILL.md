---
name: solidjs-v2-migration
description: Convert a Solid 1.x project, component, or file to SolidJS 2.0. Use for an explicit version migration; solidjs-v2 covers new v2 code and solidjs-v2-reviewer covers reviews.
---

# Migrate Solid 1.x to 2.0

Reference target: `solid-js@2.0.0-rc.8` and `@solidjs/web@2.0.0-rc.8`.

1. **Establish source and target.** Read the installed version/lockfile and the
   requested target. Apply this workflow when converting 1.x to major 2; keep
   ordinary maintenance on its existing major. Match runtime, web renderer,
   and compiler packages. Installed target typings outrank reference prose.
2. **Read [migration-map](references/migration-map.md).** Update imports, JSX
   config, and renamed APIs first. Then rewrite effects, async resources,
   store setters, and lifecycle by intent using the map's examples.
3. **Check semantics at each changed call site.** Track reads in JSX/compute;
   perform writes in imperative callbacks; check list callback shapes, cleanup,
   read-after-write ordering, and pending/saving state separately.
4. **Validate.** Typecheck against the target, run project tests, and exercise
   changed UI paths in dev. Repair diagnostics at their source. Check async
   loading/error/retry, disposal, and hydration when those paths changed.

Solid components set up once per mount; use tracked reads rather than React
rerenders/dependency arrays. Solid v2 commits writes on a microtask and splits
effect computation from side effects; adapting names alone is insufficient.

For a v1 API absent from the map, inspect installed exports/source and state
any gap explicitly. Finish with changed behavior, checks run, and remaining
runtime uncertainty.
