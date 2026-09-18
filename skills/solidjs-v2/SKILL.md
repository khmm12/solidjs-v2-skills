---
name: solidjs-v2
description: Write or edit SolidJS 2.0 code and answer v2 API questions about reactivity, async data, stores, DOM, or server functions. Applies to solid-js major 2; use solidjs-v2-migration for 1.x conversion and solidjs-v2-reviewer for reviews.
---

# SolidJS 2.0

## Confirm the version

Read the installed `solid-js` version (lockfile/package metadata); apply this
skill to major 2. For a 1.x project, keep its 1.x conventions unless migration
is requested. For a standalone v2 question, use the verified reference target.
Installed typings take priority over these references when versions differ.

## Use the Solid v2 model

- **Components run once per mount.** JSX, memos, and effect compute callbacks
  track reads. Keep props as `props.name`; read them inside those tracking scopes.
- **JSX props expose values through getters.** Write `<Counter value={count()} />`
  and read `props.value` in the child. For a manually built options object,
  preserve laziness with a getter or an accessor matching the callee's type.
- **Derive state.** Use `createMemo` for readonly derived state and
  `createSignal(() => props.initial)` for a writable derivation. Invoke setters
  and actions from handlers, effect apply callbacks, or `onSettled`.
- **Writes commit on a microtask.** Use `flush()` when an imperative caller
  needs the updated state or DOM on the next line.
- **Effects have two phases.** `createEffect(compute, apply)` tracks in compute;
  apply receives the result, performs side effects, and returns optional cleanup.
- **Async belongs in computations.** Return a Promise/AsyncIterable from a memo
  or derived store. Render consumers inside `Loading`; handle errors with `Errored`.
- **Mutations use actions.** Optimistic write → yield server work →
  `yield refresh(source)` for refetch confirmation, or `yield until(predicate)`
  for a live acknowledgment. A saving indicator reads an optimistic flag.
- **Stores use drafts.** Import from `solid-js`; write
  `setStore(draft => { draft.user.name = name; })`.
- **DOM belongs to `@solidjs/web`.** Use its JSX types and `jsxImportSource`;
  lowercase HTML attributes, `class` arrays/objects, callback refs.

These rules replace React's render/hook/dependency-array model and Solid 1.x's
synchronous writes, single-callback effects, and resource-specific loading API.
Use the task reference for exact callback shapes and async semantics.

## Read the matching reference before implementing

| Task | Reference |
|---|---|
| Signals, effects, ownership, lifecycle, paint timing, diagnostics | [reactivity](references/reactivity.md) |
| Fetching, Loading/Errored, pending, actions, refresh, live acknowledgments | [async and actions](references/async-and-actions.md) |
| Drafts, reconciliation, projections, shallow/nested stores, snapshot | [stores](references/stores.md) |
| Lists, Show/Reveal, dynamic/lazy, SSR, attributes, events, refs | [control flow and DOM](references/control-flow-and-dom.md) |
| Imports, TypeScript, context, testing setup | [TypeScript setup](references/typescript-setup.md) |
| SWR, socket streams, selection, shared state | [patterns](references/patterns.md) |
| Naming `createX` and `useX` | [conventions](references/conventions.md) |
| Server functions, transport, validation, single-flight, no-JS forms | [server functions](references/server-functions.md) |
| Experimental server components and client slots | [server components](references/server-components.md) |

## Verify the result

Typecheck with the project's installed packages and run relevant project checks.
Exercise changed async/DOM behavior; a successful typecheck proves signatures,
while runtime checks establish ordering, cleanup, pending, and hydration behavior.
