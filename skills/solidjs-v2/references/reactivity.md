# Reactivity

## Batching and derivation

Batching is automatic (`batch` is absent from v2 exports). Writes commit on the next microtask. Read synchronously after `flush()`:

```ts
const [count, setCount] = createSignal(0);
setCount(1);
// count() is still 0 here.
flush();
// count() is 1.
const doubled = createMemo(() => count() * 2);
```

`flush(fn)` runs the callback in a synchronous flush scope, drains writes before
returning, and preserves its return value. Use it at imperative boundaries/tests.
A memo's second argument is its options; seed `prev` with a default parameter.
`createSignal(() => props.initial)` derives writable state; a dependency change
replaces the local override.
Signal setters also accept an updater: `setCount(previous => previous + 1)`.

## Split effects

Import from `solid-js`. The signature is
`createEffect(compute, apply, options?)`: two required callback arguments, followed
by optional options. Compute tracks dependencies; apply runs untracked.

```ts
createEffect(
  () => ({ title: props.title, count: count() }),
  value => {
    document.title = `${value.title}: ${value.count}`;
    return () => { /* teardown before next apply or disposal */ };
  },
  { defer: true } // optional: skip initial apply
);
```

Compute tracks reads; apply runs untracked and returns a cleanup function or
`undefined`. Apply may receive `(value, previous)`; `previous` is the prior
computed value, initially `undefined`. Compute's `prev` also starts as
`undefined`; use `(prev = 0) => ...` for a seed.
The single-callback form has no TypeScript overload and throws synchronously
with `MISSING_EFFECT_FN` in dev. Keep assignments inside apply braces so its
return value is `undefined`, not the assigned string/number.

Extract store fields in compute, or use `deep(store)` for a plain tracked snapshot:

```ts
createEffect(() => deep(settings), value => {
  localStorage.setItem("settings", JSON.stringify(value));
});
createEffect(() => saveFlag(), () => { upload(snapshot(settings)); });
```

`snapshot` takes an untracked copy. Passing a store proxy to apply leaves any
fields read there untracked (`STRICT_READ_UNTRACKED`).

### Effect errors

Put both handlers in the second argument. The third argument configures the
effect (for example `name`/`defer`), not its error handler.

```ts
createEffect(() => fetchData(id()), {
  effect: data => { renderData(data); },
  error: (error, cleanup) => { setError(String(error)); cleanup(); },
});
```

The error arm handles compute errors and async rejections, on the same schedule
and writable imperative scope as apply. It receives the exact thrown value,
including `undefined`/`null`; class identity survives. An error recovered within
one flush delivers the settled success arm. Held transitions defer both arms.
Errors thrown by apply or by the error handler reach the enclosing boundary.

## Ownership: setup, reads, writes

Create primitives in a component or `createRoot`. Use handlers, effect apply/error
callbacks, actions, and `onSettled` for writes/action invocation. Component/root bodies,
memos, and effect compute callbacks build/derive the graph; writes there throw
`REACTIVE_WRITE_IN_OWNED_SCOPE`, action calls `ACTION_CALLED_IN_OWNED_SCOPE` in dev.
`untrack` only changes tracking; the ambient owner and its write guard remain.
`ownedWrite: true` is a narrow internal-state option; derive application state.

Read props, signals, and store fields in JSX/memos/effect compute. Component
parameters and component/flow-callback bodies run at setup: destructuring
`function Heading({ title })` or assigning `const title = props.title` captures
once, loses updates, and warns in dev. Keep the props object. To name a changing
expression, use an accessor (`const title = () => props.title`) and call it in
JSX/compute. Use `untrack(() => props.title)` for an intentional one-time capture.

Components execute once per mount. Updates rerun dependent JSX bindings and
computations directly, without a component rerender or virtual DOM. An effect's
compute callback declares dependencies by reading them; there is no dependency array.

Keep changing displayed values in signals/stores. A function such as
`() => localLabel` reads an ordinary variable, so assigning `localLabel` does
not notify JSX. A write to an unrelated signal does not rerender the component
or re-read that function. Use a signal read in the binding:

```tsx
import { createSignal } from "solid-js";
function Status() {
  const [label, setLabel] = createSignal("Ready");
  const display = () => label();
  return <button onClick={() => setLabel("Saving")}>{display()}</button>;
}
```

Plain variables/Maps are appropriate for non-rendered bookkeeping, such as a
request identity or unsubscribe handle. Keep any displayed overlay itself reactive.

```tsx
function Counter(props: { value: number }) { return <p>{props.value}</p>; }
<Counter value={count()} />
// JSX compiler supplies: { get value() { return count(); } }
createThing({ get value() { return count(); } }); // manual object: explicit getter
createThingWithAccessor({ value: count });        // accessor-typed API
```

Both Solid 1.x and v2 preserve value props through JSX getters. An explicitly
accessor-typed prop is a separate API contract; follow its declared type.

A derived store's seed is its backing draft. Before first resolution, an
untracked read throws `NotReadyError` (dev strict scope:
`PENDING_ASYNC_UNTRACKED_READ`); `seedLoadingValue` explicitly exposes the seed.

### Lifecycle

```ts
onSettled(() => {
  const resize = () => measureLayout();
  window.addEventListener("resize", resize);
  return () => window.removeEventListener("resize", resize);
});
```

Call setup-with-cleanup from the component body: that owner owns the returned
teardown. A subscription that does not need post-settlement timing can instead
be set up directly in the component/root body with `onCleanup(unsubscribe)`.
An out-of-band `onSettled` (handler, tracked effect, nested callback)
is for one-shot work; returning cleanup there throws `SETTLED_CLEANUP_UNOWNED`
in dev and drops it in production.

`onSettled` and `createTrackedEffect` are leaf scopes: create primitives before
entering them and return teardown. `onCleanup` there throws; pending async reads
and reentrant `flush()` are outside their contract. Use split effects for async.
`createTrackedEffect` is deprecated; write new reactive side effects as split
effects and one-time post-render work as `onSettled`.

### Lifetime

`createRoot` belongs to its parent. `runWithOwner(null, () => createRoot(...))`
creates a deliberately detached root; retain its disposer where appropriate.
`getOwner`/`runWithOwner` restore an active owner's scope; `getObserver` identifies
the observer. `isEqual` is the equality helper.

`createMemo(fn, { lazy: true })` starts on first read. A settled lazy memo tears
down when its final subscriber leaves and starts fresh on the next read;
`unobserved` reports teardown. Pending async work survives temporary unobserved
gaps, so a new subscriber rejoins it. If work settles while still unobserved,
normal teardown resumes. Register external cancellation with
`onCleanup` synchronously in compute, before its first await/yield.

`createReaction(onInvalidate)` returns a tracking function. Track an expression,
which fires once on invalidation and disarms. A second tracking call replaces
the previous arm: `track(a); track(b)` watches only `b`. Call track again
(often inside onInvalidate) to re-arm; use a memo for ordinary derived state.

## Render effects and paint timing

| Need | Primitive |
|---|---|
| Logging, persistence, subscriptions, network | `createEffect(compute, apply)` |
| Measure DOM geometry then position/size it; renderer bindings | `createRenderEffect(compute, apply)` |
| Read updated DOM immediately in a handler | write → `flush()` → read |

Both effect lanes run in the same microtask flush **before paint**; choosing a
user effect does not inherently cause a visible flash. The render lane precedes
the user lane and runs with DOM work, including during hydration/held loading
when user-lane work may be deferred.
Solid effects use tracked compute callbacks, rather than React dependency arrays.

A ref runs during render, potentially before insertion. Store the node through
`ref={setNode}`, then measure in a render effect tracking `node()`: the queued
signal update trails insertion on initial mount and subsequent updates.

## Errors and diagnostics

Use `Errored`/`createErrorBoundary` around fallible reactive work. An error escaping
all boundaries halts reactivity: the cause is logged/rethrown and later
writes/flushes are ignored (`REACTIVITY_HALTED`). `resetErrorHalt` is an internal
test/dev-reload hook re-exported by `solid-js`, not `@solidjs/web`; it clears the halt flag even in
the production client build, but does not repair a partially applied application
graph. The server export is a no-op. Dev `render()`/refresh runtime reset a prior
halt; production has no automatic recovery.

SSR setters emit a deprecation warning (`SERVER_WRITE`) once per process/category: ordinary signal/store setters alter inert data
without rerendering; optimistic setters are no-ops, including their callbacks.
Model changing SSR data as async sources; return subscription data as an AsyncIterable.

| Diagnostic | Repair |
|---|---|
| `STRICT_READ_UNTRACKED` | Read in JSX/compute, or explicitly capture with `untrack` |
| `REACTIVE_WRITE_IN_OWNED_SCOPE`, `ACTION_CALLED_IN_OWNED_SCOPE` | Derive state; invoke writes/actions from imperative callbacks |
| `PENDING_ASYNC_UNTRACKED_READ` | Move async reads into JSX/compute |
| `ASYNC_OUTSIDE_LOADING_BOUNDARY` | Add `Loading` for visible fallback; otherwise root mount waits |
| `CLEANUP_IN_FORBIDDEN_SCOPE` | Return teardown from the leaf callback |
| `SETTLED_CLEANUP_UNOWNED` | Register setup-with-teardown from a component body |
| `PENDING_ASYNC_FORBIDDEN_SCOPE` | Use a split effect for pending async reads |
| `MISSING_EFFECT_FN` | Supply compute and apply callbacks |
| `NO_OWNER_EFFECT`, `NO_OWNER_CLEANUP`, `NO_OWNER_BOUNDARY` | Create in a component/root |
| `RUN_WITH_DISPOSED_OWNER` | Use an active owner |

Import `OBSERVE` from `solid-js` for the development/observe diagnostics channel:
`OBSERVE?.diagnostics.subscribe(listener)` observes events;
`OBSERVE?.diagnostics.capture()` returns `{ events, clear(), stop() }`.
The channel is absent in ordinary production builds. `DEV` supplies development
graph hooks, not the diagnostics channel.
For serializable regression artifacts use `@solidjs/diagnostics`:
adapters live at `/vitest`, `/browser`, `/playwright`.

For a healthy scenario, require no diagnostics and a numeric rerun budget:

```ts
import { createRoot, createSignal, createMemo, createEffect, flush } from "solid-js";
import { captureArtifact, expectNoDiagnostics, expectRerunBudget } from "@solidjs/diagnostics";
const { artifact } = await captureArtifact(() => {
  const control = createRoot(stop => {
    const [count, setCount] = createSignal(0);
    const doubled = createMemo(() => count() * 2, { name: "doubled" });
    createEffect(doubled, () => {});
    return { setCount, stop };
  });
  // Drive the graph after root setup has returned: writes here are imperative.
  flush();
  control.setCount(1);
  flush();
  control.stop();
});
expectNoDiagnostics(artifact);
expectRerunBudget(artifact, 2, { scope: "doubled" });
```

For a separate test that deliberately triggers a warning, use
`expectDiagnostic(artifact, "STRICT_READ_UNTRACKED")` instead of
`expectNoDiagnostics(artifact)`. Assertions inspect the capture without consuming
events, so those two expectations conflict on the same artifact. `expectNoWaste`
checks unchanged recomputations; choose assertions for the scenario being tested.

Trigger the rule in the scope it checks. This reads a signal in effect apply,
outside tracked compute; creating a root and reading a signal alone does not
establish this diagnostic:

```ts
import { expectDiagnostic } from "@solidjs/diagnostics";
const { artifact: warningArtifact } = await captureArtifact(() => {
  const stop = createRoot(dispose => {
    const [value] = createSignal(1);
    createEffect(() => 0, () => { value(); });
    return dispose;
  });
  flush();
  stop();
});
expectDiagnostic(warningArtifact, "STRICT_READ_UNTRACKED");
```
