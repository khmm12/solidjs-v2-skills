---
name: solidjs-v2
description: SolidJS 2.0 implementation and API explanations, including React comparisons, async patterns, stores, DOM, and server functions. Use for code or questions targeting solid-js major 2. For a requested 1.x conversion use solidjs-v2-migration; for a diff review use solidjs-v2-reviewer.
---

# SolidJS 2.0

## Confirm the version

For a standalone question naming Solid 2, use the verified reference target.
For project edits, read the installed `solid-js` version (lockfile/package
metadata); apply this skill to major 2. Keep a 1.x project's conventions unless
migration is requested.
Installed typings take priority over these references when versions differ.

## Use the Solid v2 model

- **Components run once per mount.** JSX, memos, and effect compute callbacks
  track reads. Keep props as `props.name`; read them inside those tracking scopes.
- **Changing UI values live in signals or stores.** An accessor must read reactive
  state to subscribe. Wrapping an ordinary `let`/Map in a function does not make
  its assignments reactive; keep plain variables for non-rendered bookkeeping.
- **The JSX compiler supplies tracking and getters.** Write
  `<Counter value={count()} />` and read `props.value` in the child. The expression
  is a value, not an extra callback. For a manually built options object,
  use a getter or an accessor matching the callee's type.
  Follow the value's type: call signal/memo accessors, read store fields directly,
  and pass an array value to list rendering. JSX tracks expressions such as
  `<span>{label()}</span>`; callback children belong to components whose types
  explicitly request them, such as `For`. With `keyed={row => row.id}`, `For`
  supplies a row accessor (`row()`); default `For` supplies a raw row (`row.name`).
- **Derive state.** Use `createMemo` for readonly derived state and
  `createSignal(() => props.initial)` for a writable derivation. Invoke setters
  and actions from handlers, effect apply callbacks, or `onSettled`.
- **Writes commit on a microtask.** Use `flush()` when an imperative caller
  needs the updated state or DOM on the next line.
- **Effects have two required phases.** `createEffect(compute, apply, options?)`
  tracks in compute; apply runs untracked and returns cleanup or `undefined`.
  For compute errors, replace the second argument with `{ effect, error }`.
- **Async belongs in computations.** Return a Promise/AsyncIterable from a memo
  or derived store. Render consumers inside `Loading`; handle errors with `Errored`.
- **Async client mutations use actions.** Optimistic write → yield server work →
  `yield refresh(source)` for refetch confirmation, or `yield until(predicate)`
  for a live acknowledgment. Optimistic overlays end on success as well as failure;
  confirmation supplies lasting state. Handle the action Promise at its call site.
  When snapshots replace rows, keep the displayed edit in separate optimistic
  state; render that edit over the latest confirmed row until completion.
  A saving indicator reads an optimistic flag. SSR consumes async sources.
- **Stores use drafts.** Import `createStore` from `solid-js`; obtain the setter
  with `const [state, setState] = createStore(initial)`. Mutate inside callback
  braces; return a value only for an intentional root replacement.
- **DOM belongs to `@solidjs/web`.** Use its JSX types and `jsxImportSource`;
  lowercase HTML attributes, `class` arrays/objects, callback refs.

## Choose the pattern for the task

Open the matching linked file below and read the relevant section with its
example and caveats. Resolve links relative to this `SKILL.md`, not the project's
working directory. For a symbol search, use `rg --hidden` inside this skill's
folder: workspace-wide searches skip hidden `.agents`/`.codex` folders and can
falsely suggest that an API is undocumented.

A short API question needs this lookup too. Follow local links for composed
patterns. Before implementing, identify the state to read, the event that changes
it, and the component/request that owns its lifetime. Finish lookup when the
chosen pattern covers those behaviors and its completion/failure paths;
empty search results are not evidence that an API is absent.

| Task | Reference |
|---|---|
| Editable props, derived values, subscriptions, persistence, DOM timing, diagnostics | [reactivity](references/reactivity.md) |
| Fetch/render data, save optimistically, show progress, confirm a write by refetch or live echo | [async and actions](references/async-and-actions.md) |
| Update records, merge server data, select rows, expose nested live views, snapshot/deep | [stores](references/stores.md) |
| Render lists/branches, load components, SSR streaming, attributes, events, refs | [control flow and DOM](references/control-flow-and-dom.md) |
| Imports, TypeScript, context, testing setup | [TypeScript setup](references/typescript-setup.md) |
| Cache-first queries, changing socket subscriptions, selected rows, shared/per-request state | [patterns](references/patterns.md) |
| Naming `createX` and `useX` | [conventions](references/conventions.md) |
| Server functions, request locals/augmentation, transport, validation, single-flight, no-JS forms | [server functions](references/server-functions.md) |
| Experimental server components and client slots | [server components](references/server-components.md) |

## Verify the result

Adapt the canonical example, preserving its imports, types, ownership, and
cancellation. Include the helpers needed for the requested implementation.
Use the supplied interfaces in usage examples too; accept application-specific
services as parameters when their implementation is outside the task.
Use published signatures for exact API claims, including APIs suggested by the
caller. State a missing or unverified contract explicitly instead of inventing it.
Check additional assertions too; preserve the source's conditions and exceptions.
Copy exact call/type shapes, then adapt names and data. Executable examples must
remain valid TypeScript, including JSX and imports.
In multi-file examples, each consumer imports the shared types it uses.

Typechecking proves signatures; runtime assertions establish ordering, cleanup,
pending, and hydration behavior. Use the project's test setup to exercise the
requested transitions, including failures and disposal. An existing smoke test
covers only what it asserts. Keep the final account to implemented behavior,
checks actually run, and remaining uncertainty; label untested claims unverified.
