# Reactivity: batching, effects, ownership

Verified against solid-js@2.0.0-beta.15 (published typings) and `next@a4ca10b` sources/tests.

## Microtask batching — reads lag writes

All writes are batched on a microtask. After calling a setter, reads return the
**last committed** value until the batch flushes:

```ts
const [count, setCount] = createSignal(0);
setCount(1);
count();   // still 0
flush();
count();   // 1
```

- `batch()` is gone — there is nothing to wrap; batching is the default.
- `flush()` drains the queue synchronously. Use sparingly: tests, and imperative
  boundaries where you must read DOM right after a state change (e.g. focus).
- `flush(fn)` runs writes inside `fn` in a synchronous flush scope and drains
  them before returning (no leftover queued flush). Return value is preserved.

## Split effects: compute → apply

`createEffect` takes **two functions**. The single-callback form throws.

```ts
createEffect(
  (prev) => count(),          // compute: reactive reads only; deps recorded; gets prev value
  (value, prev) => {          // apply: side effects; runs after flush, untracked
    el.title = value;
    return () => { /* cleanup before next apply / on dispose */ };
  },
  { defer: true }             // optional: skip the initial run (replaces on(..., { defer: true }))
);
```

- No `initialValue` parameter (1.x). `prev` is `undefined` on first run; use a
  default parameter: `(prev = 0) => count()`.
- Same for `createMemo` — its second argument is `options`, never an initial value.
- The apply phase is **untracked**: reads there don't subscribe and warn
  (`STRICT_READ_UNTRACKED`). Extract everything you need in compute and pass
  plain values through. For store proxies see "Stores in the compute phase" below.
- Cleanup belongs in the apply return value, not `onCleanup` (which is for
  reactive cleanup inside computations — library/primitive territory).
- The apply callback must return a function or `undefined` — anything else throws.

Error handling — pass an `EffectBundle` instead of the apply function:

```ts
createEffect(() => fetchData(id()), {
  effect: (data) => render(data),
  error: (err, cleanup) => { console.error(err); cleanup(); },
});
```

This replaces `onError` / `catchError` for programmatic handling (UI-level
errors go to `<Errored>`).

The `on(...)` helper is gone — the compute phase *is* the explicit dependency
declaration. `on([a, b], ...)` becomes `createEffect(() => [a(), b()], ([a, b]) => ...)`.

## No writes in owned scope

Writing a signal/store inside a reactive scope (memo, effect compute, component
body) **throws in dev** (`REACTIVE_WRITE_IN_OWNED_SCOPE`). So does calling
`refresh()` there. Writes belong in event handlers, actions, `onSettled`, or
untracked blocks.

```ts
createMemo(() => setDoubled(count() * 2));   // ❌ throws
const doubled = createMemo(() => count() * 2); // ✅ derive, don't write back
```

Escape hatch for genuinely internal state (not app state):
`createSignal(null, { ownedWrite: true })`. Using `ownedWrite` to silence the
error for application state is a misuse — derive instead.

## Strict top-level reads

Reading a signal, signal-backed prop, or store property at the **top level of a
component body** warns (`STRICT_READ_UNTRACKED`) — the value is captured once
and never updates. Same for destructuring props in the argument list, and for
reads directly in the body of control-flow function children (the callback is
structure-building, not tracked).

```jsx
function Bad(props)  { const t = props.title; return <h1>{t}</h1>; }       // ❌ warns
function Bad2({ title }) { return <h1>{title}</h1>; }                       // ❌ warns
function Good(props) { return <h1>{props.title}</h1>; }                     // ✅ read in JSX
function AlsoGood(props) { const t = untrack(() => props.title); ... }      // ✅ explicit one-shot
```

## Lifecycle: `onSettled` (replaces `onMount`)

```ts
onSettled(() => {
  measureLayout();
  const onResize = () => measureLayout();
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);  // cleanup supported
});
```

- Works in component bodies (after first reactive settle) **and** in event
  handlers (defer until the triggered transition settles).
- Reactive reads are allowed inside.
- `onSettled` and `createTrackedEffect` are **leaf owners**: you cannot create
  reactive primitives (`createSignal`, `createMemo`, `createEffect`, …) or call
  `onCleanup` inside them (both throw). Create primitives in the component
  body, return a cleanup function instead of `onCleanup`, and don't call
  `flush()` inside (not reentrant there).
- Reading a *pending async* value inside them throws — use `createEffect`
  for async-aware reactions.

## Memo options: `lazy` and `unobserved`

```ts
const expensive = createMemo(() => heavy(source()), { lazy: true });
```

- `lazy: true` defers the first computation until first read, and opts the memo
  into **autodisposal**: when it loses its last subscriber it is torn down and
  recomputed from scratch on next read. Default (non-lazy) owned memos live for
  their owner's lifetime; unowned memos always autodispose.
- `unobserved: () => ...` (on `createSignal` and `createMemo`) fires when the
  node loses all subscribers — for tearing down external resources (sockets,
  subscriptions) that should only exist while observed. Combine with `lazy` for
  demand-driven computations.
- Other options: `equals: false | (prev, next) => boolean` (signals and memos),
  `name` (debugging).

## Ownership

- `createRoot(dispose => ...)` created inside an owned scope is **owned by that
  parent** and disposed with it (1.x roots were detached).
- Truly detached lifetime is explicit: `runWithOwner(null, () => ...)` — for
  module singletons and external integrations only.
- Effects/boundaries created with no owner warn (`NO_OWNER_EFFECT`,
  `NO_OWNER_BOUNDARY`) and never dispose. In tests, wrap reactive code in
  `createRoot`.
- Renames: `getListener` → `getObserver`, `equalFn` → `isEqual`.

## Stores in the compute phase

The apply phase is untracked, so don't pass store proxies through it:

```ts
// ❌ reads in apply: untracked, warns, never re-runs
createEffect(() => store.user, (user) => send(user.name, user.age));

// ✅ extract plain values in compute
createEffect(
  () => ({ name: store.user.name, age: store.user.age }),
  (v) => send(v.name, v.age)
);

// ✅ react to ANY nested change: deep() subscribes deeply, returns a plain snapshot
createEffect(() => deep(store), (snap) => save(JSON.stringify(snap)));

// ✅ current value WITHOUT subscribing: snapshot()
createEffect(() => saveFlag(), () => upload(snapshot(store)));
```

## `createRenderEffect` / `createTrackedEffect`

- `createRenderEffect(compute, apply)` — same split shape, but runs
  synchronously during the render phase (can observe intermediate state). For
  DOM-binding-level work; app code should use `createEffect`.
- `createTrackedEffect(fn)` — single-callback tracked effect; may re-run in
  async situations; leaf owner (see `onSettled` restrictions). Rare; prefer
  `createEffect`.

## Dev diagnostics

Every dev-mode diagnostic has a code. The ones you'll hit, with the fix:

| Code | Severity | Fix |
|---|---|---|
| `REACTIVE_WRITE_IN_OWNED_SCOPE` | error | Move write to handler/action/`onSettled`; derive with memo; `ownedWrite` only for internal state |
| `STRICT_READ_UNTRACKED` | warn | Read in JSX/memo/effect-compute, or wrap in `untrack` |
| `PENDING_ASYNC_UNTRACKED_READ` | error | Read async values in a tracked scope (JSX/memo/compute) |
| `ASYNC_OUTSIDE_LOADING_BOUNDARY` | warn | FYI: root mount deferred until async settles; add `<Loading>` for explicit fallback. If the app "doesn't mount", check for this |
| `CLEANUP_IN_FORBIDDEN_SCOPE` | error | Return a cleanup function from `onSettled`/`createTrackedEffect` instead of `onCleanup` |
| `PENDING_ASYNC_FORBIDDEN_SCOPE` | warn | Don't read pending async in `onSettled`/tracked effect; use `createEffect` |
| `NO_OWNER_EFFECT` / `NO_OWNER_CLEANUP` / `NO_OWNER_BOUNDARY` | warn | Create inside a component or `createRoot` |
| `RUN_WITH_DISPOSED_OWNER` | warn | Don't reuse disposed owners |

Programmatic access (tooling/tests): `DEV.diagnostics.subscribe(listener)` and
`DEV.diagnostics.capture()` (returns `{ events, clear(), stop() }`).
