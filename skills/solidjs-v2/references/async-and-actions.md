# Async data, transitions, actions, optimistic UI

Verified against solid-js@2.0.0-rc.5 (published typings/runtime) and
`solidjs/solid@5eb3250a` sources/tests.

## Async lives in computations — there is no `createResource`

Any computation may return a `Promise` or `AsyncIterable`. Consumers read the
accessor normally; a not-ready read signals through the reactive graph
(`NotReadyError`) and is caught by the nearest `<Loading>` boundary.

```jsx
const user = createMemo(() => fetchUser(params.id));

<Loading fallback={<Spinner />}>
  <Profile user={user()} />
</Loading>
```

- Loading state is **structural** (boundaries), not a `T | undefined` hole in
  every type.
- Async iterables stream: in `createMemo(async function* () { yield a; yield b; })`
  each `yield` commits a new value. Both async shapes own in-flight work that needs
  explicit cleanup — see **Cancellation & cleanup** below; the streaming-query
  pattern is in `references/patterns.md`.
- A `Promise<AsyncIterable<T>>` is flattened automatically and streams like a
  directly returned async iterable; no `yield* await serverFn()` wrapper is needed.
- Reading a pending async value **outside** a tracked scope throws
  (`PENDING_ASYNC_UNTRACKED_READ`). Read in JSX, a memo, or an effect compute.
- Async with no `<Loading>` ancestor at `render()` time warns
  (`ASYNC_OUTSIDE_LOADING_BOUNDARY`) and defers the root mount until it
  settles. If your app renders nothing, check the console for this code.

### 1.x resource features → 2.0

| 1.x | 2.0 |
|---|---|
| `createResource(src, fetcher)` | `createMemo(() => fetcher(src()))` (or `createStore(fn)`/`createProjection` for collections) |
| `resource.loading` | `<Loading>` (initial) + `isPending(() => resource())` (revalidation) |
| `resource.error` | `<Errored>` boundary or effect `error` option — one error path, no inline `.error` branching |
| `refetch()` | `refresh(resource)` |
| `mutate()` | `createOptimisticStore` + `action` |

## Cancellation & cleanup in async computations

A computation that returns a `Promise` or async generator can own external work —
a fetch, a socket, a subscription. Solid manages the async computation's
observation lifetime and releases unobserved iterators, but it cannot reliably
cancel every external operation the computation awaits. Register cleanup with
`onCleanup`, **synchronously, before the first `await`/`yield`**: after a suspension
point the continuation runs with no owner, so an `onCleanup` placed there warns
`NO_OWNER_CLEANUP` and is silently never run.

### Lazy async memo: temporary unobserved gaps keep in-flight work alive

Once a lazy async memo has started, temporarily losing its final subscriber does
**not** dispose the pending computation. A subscriber that arrives before it
settles rejoins that same in-flight computation; Solid does not restart duplicate
work merely because observation briefly dropped to zero. If it settles while
still unobserved, normal teardown resumes.

For an `AsyncIterable`, Solid also handles releasing/closing the unobserved
iterator. That runtime release is not a substitute for deterministic resource
cancellation: still install a synchronous `onCleanup` that aborts the
`AbortController`, closes the socket, or explicitly closes/unblocks the iterator.

### Plain async — abort the in-flight request

```ts
const user = createMemo(async () => {
  const ac = new AbortController();
  onCleanup(() => ac.abort());      // sync, before fetchUser's internal await
  return fetchUser(id(), { signal: ac.signal });
});
```

On a re-run (`id()` changed) or on dispose, the previous request aborts. Solid
already discards the superseded *value*, so the reactive result is correct either
way; aborting is about stopping wasted work and the side effects of a late response.

### Async generator — `yield` streams, `return` discards

Each `yield` **commits** a value (the accessor updates per yield). `return` **ends
the stream and throws its value away** — the last yielded value stays committed.
`return` is for stopping, never for emitting a final value. This is the opposite of
`action()`, where the generator's `return` *is* the action's result:

| In a… | `yield x` | `return x` |
|---|---|---|
| `createMemo(async function*)` | commits `x` — streams | ends the stream, `x` **discarded** |
| `action(async function*)` (below) | transition sync point, not a value | the action's **result** |

Cleanup is the footgun. On dispose Solid **does** call `.return()` on the iterator —
but a generator parked on an *external* `await` (the next socket message, an emitter
tick) won't unwind from it: `.return()` queues behind that `await`, and if the source
has gone quiet the `await` never settles, so `finally` never runs and the resource
leaks. An up-front `onCleanup` is the reliable hook — and it must **actively cancel**
what the generator awaits (close the socket, abort, resolve the pending promise),
which both frees the resource and unblocks the parked `await` so the generator can
unwind. Full pattern in `references/patterns.md` → *Streaming a socket*.

```ts
const messages = createMemo(async function* () {
  const { iterable, cancel } = subscribeToAsyncIterable<Msg>(/* socket → emit */);
  onCleanup(cancel);   // ends the stream and unblocks the parked await (bridge: patterns.md)
  yield* iterable;     // each message commits; never returns on its own
});
```

Symptoms when this is wrong:

- `onCleanup` after the first `await`/`yield` → `NO_OWNER_CLEANUP`; cleanup silently
  skipped, resource leaks.
- An async iterator that completes without yielding settles to `undefined`, so
  `<Loading>` releases. A `return value` is still discarded — emit a final value
  with `yield`, not `return`.
- Subscribing to a socket/emitter with no up-front `onCleanup` → leaks on every re-run
  and on route change. `try/finally` alone does **not** save you.

## `Loading` boundary semantics

- Covers **branch readiness**: first render of a subtree that reads not-ready
  values. After content has rendered once, revalidation keeps stale content
  visible — it does not kick back to fallback.
- `on` prop: re-show fallback when the expression changes *while* async is
  pending — for route/key-level transitions:
  `<Loading on={id()} fallback={<Spinner />}>...`

### `loadingValue` / `seedLoadingValue` — committed first paint

Use a loading value when the provisional state is useful content rather than a
structural fallback:

```ts
const user = createMemo<User | null>(() => fetchUser(id()), {
  loadingValue: null,
});

const [todos] = createStore(() => fetchTodos(), [], {
  seedLoadingValue: true,
});
```

`loadingValue` applies to memo/signal-family derived sources;
`seedLoadingValue: true` makes a derived store's seed the committed first
paint. The source reads as settled until its first real answer lands: it does
not suspend `<Loading>`, hold a transition, or make `isPending(source)` true.
Drive the first-load UI from the provisional value itself. After the first
landing, ordinary refetch pending semantics apply and the loading value never
returns. The loading value is also the compute's first `prev`.

With `ssrSource: "client"`, both forms render the declared first paint on the
server and preserve it through hydration. The bare form is also valid: it is a
structural client hole, so the server suspends the nearest `<Loading>` fallback
and hands that position to the client. Outside a boundary, a bare client source
is a render error.

## `isPending(fn)` — question-scoped pending

One rule: a read is pending **iff** a value change is in flight for it that
hasn't *revealed* yet, or it carries a live `affects()` mark (below).

`isPending` **performs the read** and reports whether anything it touched is
currently pending.

```jsx
<Loading fallback={<Spinner />}>
  <Show when={isPending(() => users() || posts())}>updating…</Show>
  <List users={users()} posts={posts()} />
</Loading>
```

- Because it reads, placement matters: when the expression can be not-ready,
  put it **under the `Loading` boundary** that owns the initial fallback.
- It can live outside a boundary only when it reads upstream state that can
  never be not-ready — but then it only observes that state's own transition:
  `isPending(id)` stays `false` while a *downstream* subtree loads.
- Guarding interactive controls:
  `<button disabled={isPending(user)}>Save</button>` under the boundary,
  with a disabled fallback for the initial path.

**Same-question re-asks are quiet; new questions pend monotonically.** A
`refresh()`, a poll, or a confirming refetch after a mutation — none of which
change the *tracked input* (id, query key) — normally reveal their fresh value
without flipping `isPending` to `true`: the source you're showing still answers
what's being asked, so the swap is quiet. A change to the tracked input
itself (navigation changes `id()`) pends every read under that source
monotonically until the new answer reveals — nothing can silence it early.
To make an otherwise-quiet reload read as pending, declare it:
`affects(user); refresh(user)` (see **`affects()`** below).

Published rc.5 has one narrow runtime defect at this boundary: if a quiet
refresh landing is held by another transition, a directly observing render
effect can see a one-frame `isPending === true` pulse. The post-rc.5 upstream
fix is not part of this target. Treat refresh as a quiet re-ask for UI design,
but do not write correctness logic that depends on it *never* pulsing in rc.5.

Optimistic writes are **verdict-inert**: an active override displays the
provisional value but decrees nothing — it does not read pending on its own
slot and does not mask anything else. A spinner driven by
`isPending` next to an optimistic write now depends only on whether the
confirming work is a quiet re-ask (`refresh()` alone → normally quiet) or a declared
one (`affects()` + `refresh()` → pending) — not on the presence of the
optimistic write. Drive "Saving…" process affordances from co-written data
(a flag in the optimistic write, or a dedicated `createOptimistic` boolean),
never from `isPending` — see **`affects()` and division of labor** below.

## `affects(target, key?)` — declare what's changing

`affects` declares that in-flight work will change the targeted data: the
marked slot — and anything **derived** from it — reads pending
(`isPending` → `true`) from the declaration until the surrounding transaction
settles or reverts, exactly as if a real fetch for it were in flight. The
marked value itself stays readable throughout (mark-only pending is
**value-transparent** — reading it never suspends or throws not-ready; it
surfaces through `isPending`, and a live mark also holds an **unrevealed**
`<Loading>` boundary's fallback the way real in-flight async would — it never
flips an already-revealed boundary back to fallback). It is additive-only: a
mark can turn pending *on* for data the graph can't otherwise see changing;
nothing can turn pending *off* while a real change is in flight. `affects`
belongs inside an action (or another transaction): called outside any
transaction the mark is released at the end of the current flush, so it never
reaches your effects or UI; ambient marks are verdict-only.

```ts
declare function affects(target: Accessor<unknown> | Store<object>): void;
declare function affects<T extends object>(target: Store<T>, key: keyof T): void;
```

Exactly one optional key per call — a three-argument call
(`affects(state, "user", "name")`) is a **type error**: keys do not form a
path (that reads like a 1.x store path but would mark two sibling slots).
Mark several slots with several calls, or target the nested record directly.

Targets:

- `affects(store)` — every record **reachable from `store` at declaration
  time** reads pending, including rows already captured by a `<For>` (a live
  child proxy). Siblings are untouched. **Snapshot-at-declaration**: records
  *added* to the store after the call are not covered.
- `affects(record, "key")` — exactly the named slot of that record.
- `affects(accessor)` — a plain signal/memo source accessor.

The idiom for a "loud" reload — one that should read pending even though a
bare `refresh()` alone would normally be quiet:

```ts
const reload = action(function* () {
  affects(todos);   // the whole store reads pending…
  refresh(todos);   // …over this otherwise-quiet re-ask
  yield api.done();
});
```

Marking a single slot the server is about to update, alongside its own
optimistic write:

```ts
const rename = action(function* (todo, text) {
  setOptimisticTodos(() => { todo.text = text; });
  affects(todo, "updatedAt");  // server will change this slot too
  yield api.rename(todo.id, text);
  refresh(todos);
});
```

**Division of labor** for a mutation's UI: an optimistic write shows the
*expected* value; `affects` pends data you know is changing but can't show a
value for yet; a process affordance ("Saving…", a disabled reload button) is
co-written state — an optimistic flag that reverts on its own at settle —
never a verdict read off `isPending`. See *Optimistic primitives* below for
why optimistic writes themselves are verdict-inert.

## `latest(fn)`, `resolve(fn)`, `refresh(target)`, `until(fn)`

```ts
latest(userId); // peek at the in-flight value during a transition
                // (may fall back to stale)

await resolve(() => user()); // Promise that settles when the expression is
                // non-pending; rejects with the source's own error if the
                // source rejects. Imperative code / tests only — throws inside
                // a tracking scope.

const settled = await refresh(user); // invalidate/recompute and wait for the
                // next quiescent answer. Target must be refreshable: an async
                // memo, derived signal/store (function-form), or projection.
                // Calling inside a pure computation throws
                // REACTIVE_WRITE_IN_OWNED_SCOPE.
```

Published rc.5 makes refresh awaitable:

```ts
declare function refresh<T>(
  target: Refreshable<T>
): Promise<T extends (...args: any) => infer V ? V : T>;
```

The promise follows the re-ask through any superseding invalidation and settles
at the next quiescent answer. For an accessor it resolves the settled value; for
a store it resolves the node passed (refreshing a nested node still re-asks its
whole derived family). It rejects with the re-ask error. Ignoring the returned
promise remains valid fire-and-forget usage and does not create an unhandled
rejection. Inside an action, `yield refresh(source)` waits at a transaction-safe
point; failure throws at that yield and reverts optimistic writes. The delivered
value is authoritative staged data, never the caller's optimistic override.

`refresh()` recomputes only the explicit target (or the top-level reads of a
refresh callback); it does not cascade into unrelated upstream memos.

### `until()` — wait for a live source to acknowledge

```ts
interface UntilOptions {
  timeout?: number;
  signal?: AbortSignal;
}

const acknowledged = await until(
  () => todos.find(todo => todo.clientId === clientId),
  { timeout: 5_000, signal }
);
```

`until(fn, options?)` returns `Promise<Truthy<T>>`: it resolves with the first
truthy settled predicate result. Falsy and pending results keep waiting; a
predicate error, abort, or timeout rejects (`TimeoutError` for timeout). Call it
from imperative code, never inside a tracking scope.

Its important action use is live-source acknowledgement:

```ts
const addTodo = action(async function* (todo: Todo) {
  setOptimisticTodos(list => { list.push(todo); });
  yield api.addTodo(todo);
  yield until(
    () => todos.some(row => row.id === todo.id),
    { timeout: 5_000 }
  );
});
```

`yield until(...)` keeps the transaction and its optimistic writes alive until
the authoritative subscription/store observes the mutation. The predicate
does not see the action's own optimistic overlay, so an optimistic write cannot
acknowledge itself; transition-staged authoritative data is visible. Use a
timeout or abort signal for a live channel that can drop acknowledgements. If
another transition supplies the truthy confirmation, rc.5 entangles it with
the awaiting action so the confirming truth and optimistic reversion/reveal
paint atomically rather than tearing; unrelated non-flipping updates remain
free to reveal.

## Transitions are built-in

`startTransition` / `useTransition` are gone. Transitions are a runtime
scheduling concept; multiple can be in flight. The user-facing surface is
`isPending` / `<Loading>` and the optimistic APIs.

## `action(fn)` — mutations

`action()` wraps a **generator or async generator** and returns an async
function. Writes between yields are batched into the action's transition.

Defining an action in a component is fine; **calling it synchronously from an
owned scope is not**. A call in a component body, memo, or effect compute throws
in dev (`ACTION_CALLED_IN_OWNED_SCOPE`). Starting the transaction there
can livelock when the scope tracks state that the action later writes: each
write retriggers the scope and starts a replacement transition before the value
commits. Invoke actions from event handlers, effect apply/error callbacks,
`onSettled`/tracked effects, or other imperative scopes.

```ts
const [todos, setOptimisticTodos] = createOptimisticStore(() => api.getTodos(), []);

const addTodo = action(function* (todo) {
  setOptimisticTodos(s => { s.push(todo); });  // optimistic write
  yield api.addTodo(todo);                     // async work
  refresh(todos);                              // reconcile with source of truth
});

// async-generator form (better TS): yield re-enters the transition context after await
const save = action(async function* (todo) {
  setOptimisticTodos(s => { s.push(todo); });
  const res = await api.addTodo(todo);
  yield;
  refresh(todos);
  return res;
});
```

Shape of a mutation: optimistic write → `yield`/`await` server work →
`refresh(...)` derived reads or `until(...)` live acknowledgement. Don't use
`refresh()` as a "refreshing" UI flag: use a co-written process flag, or
`affects()` + `isPending` when the data re-ask itself should read pending.

**`yield` is the only transaction-safe suspension point** (changeset
`document-action-await-contract`, ruled behaves-as-designed). Writes made
between an internal `await` and the *next* `yield` escape the action's
transition — they land outside it, un-batched with the optimistic/reconcile
writes around them. The safe pattern for a typed result: `await` for the
value, then a **bare `yield`** to re-enter the transaction before writing:

```ts
const save = action(async function* (todo) {
  setOptimisticTodos(s => { s.push(todo); });
  const res = await api.addTodo(todo); // await: fine for the read, not for a write after it
  yield;                               // re-enters the transaction
  refresh(todos);                      // now transaction-safe
  return res;
});
```

Calling `flush()` inside an action body is out of contract — don't rely on
its ordering there.

An **uncaught error** in an async-generator action rejects the returned promise
and completes the transition — so optimistic writes revert and the caller can
`.catch`; it does not halt reactivity. A `try`/`catch` around a `yield`/`await`
still handles an awaited rejection locally. Falsy throws
(`undefined`, `null`, `0`, `""`, `false`) reject with that
exact value too; never infer action success from error truthiness.

## Optimistic primitives

Writes are transition-scoped: they apply immediately and **revert when the
transition completes** (by which time `refresh` has reconciled real data).

```ts
// Signal surface — same as createSignal (value or compute-fn forms)
const [name, setName] = createOptimistic("Alice");

// Store surface — plain or derived form
const [todos, setTodos] = createOptimisticStore({ list: [] });
const [todos2, setTodos2] = createOptimisticStore(() => api.getTodos(), [], { key: "id" });
```

`createOptimisticStore(fn, seed, options?)` mirrors `createStore(fn, seed)`:
the second argument is the backing host object/array, `options.key` controls
reconciliation of returned values.

An optimistic write of literal `undefined` — a delete, a `filter()`-shaped
removal, "set to no value" — is a fully supported override, not a special
case: it reverts like any other write when the transition settles.

### Optimistic writes are verdict-inert

An optimistic write decrees nothing about `isPending`: it doesn't read pending
on its own slot and it doesn't mask anything else.

A `<Show when={isPending(() => todos())}>` spinner next to an action that does
an optimistic write followed by `refresh(todos)` stays hidden: a bare refresh
is a quiet, same-question re-ask. If the reload should read as pending, declare
it: `affects(todos); refresh(todos)`.

The "Saving…" recipe is unchanged: put process affordances **in the data** —
a co-written flag that rides along with the optimistic write, or a separate
`createOptimistic` flag (which reverts on its own when the transition
settles) — never read off `isPending`, mask or no mask:

```ts
setOptimisticTodos(s => { s.push({ ...todo, pending: true }); }); // flag on the row
// …or a dedicated flag, read by value (not via isPending):
const [saving, setSaving] = createOptimistic(false);
```

## Errors: one path

Async errors propagate through the reactive graph and are caught structurally:

```jsx
<Errored fallback={(err, reset) => (
  <div>
    <pre>{String(err())}</pre>          {/* err is an accessor */}
    <button onClick={reset}>Retry</button>
  </div>
)}>
  <Page />
</Errored>
```

Programmatic: `createEffect(compute, { effect, error })`. There is no
`resource.error`, `onError`, or `catchError`; boundaries heal automatically
(no `resetErrorBoundaries`).

Error identity is exact, including falsy values: `Promise.reject(undefined)`
reaches `err()` / the effect `error` arm as `undefined`, `reject(null)` as
`null`, and a custom error as the same object (`instanceof` works). Do not test
whether an error exists with `if (err())`; branch by the value you expect.

| Origin | What user code observes |
|---|---|
| async source `Promise.reject(null)` | `err()` / effect `error` receives `null` |
| action generator `throw undefined` | the action's returned Promise **rejects with `undefined`** (it does not resolve) |

Nested boundaries compose by status dimension: an inner `<Errored>` catches its
content even when a `<Loading>` sits between it and an outer `<Errored>`.
