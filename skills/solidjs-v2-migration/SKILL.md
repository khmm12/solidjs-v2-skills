---
name: solidjs-v2-migration
description: Migrate a Solid 1.x codebase, file, or component to SolidJS 2.0 (solid-js 2.x / next / beta). Use when converting code that imports solid-js/web, solid-js/store, createResource, Suspense, onMount, batch, or other 1.x APIs to the 2.0 equivalents. Not for writing new v2 code from scratch (see solidjs-v2).
---

# Migrate Solid 1.x → 2.0

Convert 1.x code to 2.0 in passes: mechanical first, then semantic, then
diagnostics-driven cleanup. The full rename/removal table with before/after
recipes is in `references/migration-map.md` — read it before starting; this
file is the workflow.

## Step 0 — establish the direction

- Source must be Solid 1.x (imports like `solid-js/web`, `solid-js/store`,
  `createResource`, `Suspense`). Target version: whatever `solid-js@2.x` /
  `@solidjs/web` beta the project declares (or the latest, if you're also
  bumping `package.json`).
- Betas drift. The installed typings (`node_modules/solid-js/types`,
  `@solidjs/web`) outrank docs and this skill's references when they disagree.
- Upgrade `solid-js`, `@solidjs/web`, and `babel-preset-solid` together.

## Pass 1 — mechanical (grep-and-replace, low judgement)

1. Dependencies: `solid-js@2.x`, add `@solidjs/web`, matching
   `babel-preset-solid`.
2. `tsconfig.json`: `"jsxImportSource": "@solidjs/web"`.
3. Import paths and pure renames — tables at the top of
   `references/migration-map.md`. Greppable: `solid-js/web`, `solid-js/store`,
   `Suspense`, `SuspenseList`, `ErrorBoundary`, `mergeProps`, `splitProps`,
   `unwrap`, `onMount`, `createSelector`, `Context.Provider`, `classList`,
   `equalFn`, `getListener`.

Mind the non-1:1 renames: `Errored`'s fallback gets an error **accessor**
(`err()`), `splitProps` → `omit` inverts the result (rest-only), `merge` treats
`undefined` as an override, `onSettled` is a leaf owner.

## Pass 2 — semantic rewrites (per call site, by intent)

Work through `references/migration-map.md` sections in this order — each names
the decision to make:

1. **Effects**: single-callback `createEffect` → split `(compute, apply)`;
   `on()` → compute phase; `initialValue` → default parameter; `onCleanup`
   inside effects → returned cleanup.
2. **`createComputed`** → `createMemo` / split effect / `createSignal(fn)` —
   pick by intent (derivation / side effect / writable derived).
3. **`batch`** → delete; add `flush()` only where code reads its own writes
   synchronously.
4. **`createResource`** → async `createMemo` (or `createProjection` for keyed
   collections) + `<Loading>`; `.loading`/`.error`/`refetch`/`mutate` each map
   differently — see the table.
5. **Mutations**: ad-hoc flag flipping / `startTransition` → `action()` +
   optimistic primitives + `refresh()`.
6. **Stores**: `produce` wrappers → plain drafts; path setters → drafts (or
   `storePath` compat); `reconcile` moves inside the draft; `createMutable` →
   `createStore`.
7. **Lists**: `<Index>` → `<For keyed={false}>`; audit default `<For>`
   callbacks — item is now raw, index is an accessor.
8. **DOM**: `use:` → ref factories; `on:`/`attr:`/`bool:`/`class:`/`style:`
   namespaces → standard forms; `/*@once*/` → reactive or `defaultValue`;
   camelCase attributes → lowercase.
9. **Context**: `.Provider` → context-as-component; delete `useX`-with-throw
   wrappers (`useContext` now returns `T` and throws without Provider).
10. **`from`/`observable`** → async iterables / push-out effects.

## Pass 3 — run dev and fix diagnostics

2.0 ships structured dev diagnostics; the first dev run after migration is the
real review. Typical wave, in order of volume:

- `STRICT_READ_UNTRACKED` — top-level/destructured prop reads the old code
  tolerated. Move reads into JSX/memos, or `untrack` deliberate one-shots.
- `REACTIVE_WRITE_IN_OWNED_SCOPE` (throws) — 1.x effects that write signals.
  Rewrite as derivations or move writes to handlers/actions.
- `ASYNC_OUTSIDE_LOADING_BOUNDARY` — async reads with no `<Loading>` ancestor;
  add boundaries where fallback UI is wanted.
- `CLEANUP_IN_FORBIDDEN_SCOPE` — `onCleanup` inside `onSettled`; return the
  cleanup instead.

Then run the test suite: assertions reading right after writes need `flush()`,
and reactive setups in tests need `createRoot`.

## Pass 4 — behavioral audit (no grep pattern)

The "Behavioral changes that need an audit" section of the map: synchronous
read-after-write assumptions, `undefined`-as-override in merges, forever-roots
needing `runWithOwner(null, ...)`.

## Failure modes

- **A 1.x API has no entry in the map** → check the installed typings before
  inventing a replacement; some conveniences (e.g. `observable`,
  `createDeferred`) intentionally have none — surface the gap rather than
  papering over it.
- **App mounts blank after migration** → pending async outside `Loading`
  defers the root mount (`ASYNC_OUTSIDE_LOADING_BOUNDARY` in console).
- **Migration of one file pulls in half the app** → migrate bottom-up (leaf
  components first), keep passes 1–2 per-file but expect pass 3 diagnostics to
  surface cross-file issues.
