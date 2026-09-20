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
- **JSX props expose values through getters.** Write `<Counter value={count()} />`
  and read `props.value` in the child. For a manually built options object,
  preserve laziness with a getter or an accessor matching the callee's type.
- **Derive state.** Use `createMemo` for readonly derived state and
  `createSignal(() => props.initial)` for a writable derivation. Invoke setters
  and actions from handlers, effect apply callbacks, or `onSettled`.
- **Writes commit on a microtask.** Use `flush()` when an imperative caller
  needs the updated state or DOM on the next line.
- **Effects have two required phases.** `createEffect(compute, apply, options?)`
  tracks in compute; apply runs untracked and returns cleanup or `undefined`.
- **Async belongs in computations.** Return a Promise/AsyncIterable from a memo
  or derived store. Render consumers inside `Loading`; handle errors with `Errored`.
- **Mutations use actions.** Optimistic write → yield server work →
  `yield refresh(source)` for refetch confirmation, or `yield until(predicate)`
  for a live acknowledgment. A saving indicator reads an optimistic flag.
- **Stores use drafts.** Import from `solid-js`; write
  `setStore(draft => { draft.user.name = name; })`.
- **DOM belongs to `@solidjs/web`.** Use its JSX types and `jsxImportSource`;
  lowercase HTML attributes, `class` arrays/objects, callback refs.

## Look up the contract before answering or coding

Open the matching linked file below and read the relevant section with its
example and caveats. Resolve links relative to this `SKILL.md`, not the project's
working directory. For a symbol search, use `rg --hidden` inside this skill's
folder: workspace-wide searches skip hidden `.agents`/`.codex` folders and can
falsely suggest that an API is undocumented.

A short API question needs this lookup too. Follow local links for composed
patterns. Finish lookup when every requested behavior has a matching section;
empty search results are not evidence that an API is absent.

| Task | Reference |
|---|---|
| Signals, effects, props, lifecycle, paint, diagnostics, resetErrorHalt | [reactivity](references/reactivity.md) |
| Fetching, loading/errors, saving/pending, action scope, refresh, live acknowledgments | [async and actions](references/async-and-actions.md) |
| Drafts, reconciliation, projection/selection, shallow/nested stores, snapshot/deep | [stores](references/stores.md) |
| Lists, Show/Reveal, dynamic/lazy, renderToStream, attributes, events, refs, claimElementTree | [control flow and DOM](references/control-flow-and-dom.md) |
| Imports, TypeScript, context, testing setup | [TypeScript setup](references/typescript-setup.md) |
| Cache-first/SWR queries, socket cancellation, keyed selection, shared/SSR state | [patterns](references/patterns.md) |
| Naming `createX` and `useX` | [conventions](references/conventions.md) |
| Server functions, request locals/augmentation, transport, validation, single-flight, no-JS forms | [server functions](references/server-functions.md) |
| Experimental server components and client slots | [server components](references/server-components.md) |

## Verify the result

For explanations, cover the requested branches explicitly: imports/signature,
tracked versus imperative scope, completion/cleanup, and relevant failure behavior.
For composed patterns, carry the reference's ownership and cancellation through
the whole example. An implementation request needs code with imports and helper
definitions, not just a description of the pattern. Preserve the example's
types when adapting it; every draft field must fit its declared type.
Check each API against the section just read.

For code changes, typecheck with installed packages and run relevant project checks.
Exercise changed async/DOM behavior; a successful typecheck proves signatures,
while runtime checks establish ordering, cleanup, pending, and hydration behavior.
