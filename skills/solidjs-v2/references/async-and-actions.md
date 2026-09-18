# Async data and actions

Verified against solid-js@2.0.0-rc.8 / @solidjs/web@2.0.0-rc.8 published typings and solidjs/solid@f8b40b7e sources/tests.

## Fetch and render

```tsx
const user = createMemo(() => fetchUser(id()));
<Loading fallback={<Spinner />}>
  <Profile user={user()} />
</Loading>
```

A memo returning a Promise exposes its resolved value through the accessor.
Async stores/projections use the same model. Loading is structural; consumers
read a ready value rather than checking a `T | undefined` resource.
A `Promise<AsyncIterable<T>>` is flattened into a stream automatically.

`Loading` displays fallback for an initially unready branch. Once revealed, it
keeps stale content during revalidation. `<Loading on={id()} ...>` allows a
changed expression to re-show fallback while data is pending. Without a boundary,
pending async delays the root mount and warns `ASYNC_OUTSIDE_LOADING_BOUNDARY`.
Read pending data in JSX/compute; untracked pending reads throw.

### Provisional first paint

```ts
const user = createMemo<User | null>(() => fetchUser(id()), { loadingValue: null });
const [todos] = createStore(() => fetchTodos(), [], { seedLoadingValue: true });
```

The loading value is committed until the first real answer, and is the initial
`prev`. It neither suspends `Loading`, holds a transition, nor sets `isPending`.
Render first-load UI from that value. After the first answer, normal refetch rules
apply. `ssrSource: "client"` preserves declared first paint through hydration;
without a loading value it creates a structural client hole under `Loading`.
A bare client source outside a server boundary is a render error.

## Pending and process state

`isPending(fn)` performs the read. It reports an unrevealed value change or a live
`affects` mark. Place reads under the `Loading` that owns their initial fallback:

```tsx
<Loading fallback={<Spinner />}>
  <button disabled={isPending(user)}>Save</button>
  <Profile user={user()} />
</Loading>
```

| Work | Pending behavior |
|---|---|
| Tracked input changes (id/query key) | Pending until the new answer reveals |
| Bare `refresh(source)` or same-input poll | Quiet re-ask; fresh answer reveals silently |
| `affects(source)` inside an action | Pending until that transaction settles/reverts |
| Optimistic write | Changes displayed data; neither creates nor masks pending |

`isPending(id)` observes that signal, not loading of downstream data.
For a "Saving…" process indicator, co-write a row flag or a separate
`createOptimistic(false)` flag and read its **value**. This differs from Solid
1.x `resource.loading`, which becomes true on every refetch.

### `affects(target, key?)`

Call inside an action alongside the work it describes. Outside a transaction,
marks expire at the flush and never reach effects/UI.

- `affects(accessor)` marks that source.
- `affects(store)` marks records reachable at declaration time, including captured
  row proxies. Later-added records and sibling stores are outside that snapshot.
- `affects(record, "field")` marks exactly one slot. For multiple slots, make
  multiple calls or target the nested record; the optional key is a single key.

Marked data stays readable. Marks propagate to derivations and can hold an
unrevealed `Loading` fallback; an already revealed boundary stays visible.
For a reload indicator:

```ts
const reload = action(function* () {
  affects(user);
  yield refresh(user);
});
```

## `latest`, `resolve`, `refresh`, `until`

| Need | Call and result |
|---|---|
| Read the in-flight value ahead of a transaction | `latest(source)` (may fall back to stale) |
| Wait for a settled value, including falsy | `await resolve(() => source())` |
| Re-fetch and wait for its settled answer | `await refresh(source)` |
| Wait until an authoritative condition is truthy | `await until(predicate, { timeout, signal })` |

Use waiters in imperative code; `resolve`/`until` are outside tracking scopes.
`resolve` rejects with the original source error when the source rejects.
`latest` escapes a transaction, but rendered async derived from that latest read
still holds its lane. Put that derived UI under `Loading` to show a fallback,
or derive from the ordinary source when the latest display should stay independent.

### Awaitable refresh

`refresh(target)` invalidates the target and returns a Promise for its next
quiescent state. Superseding invalidations fold into that wait; it returns whatever
finally settles. An accessor target resolves with its value; a store target
resolves with the passed node. A nested node refresh re-runs its family's derive
function. Unrelated upstream computations are outside that refresh.

A failed refresh rejects when awaited; ignoring its Promise is safe from an
unhandled rejection. It stays quiet for `isPending`, including when awaited.
Inside actions, `yield refresh(source)` delivers authoritative data already staged
in the held transaction, excluding the caller's optimistic override.

### Live acknowledgments

`until(fn, options?)` resolves the first settled truthy result. Falsy/pending
results keep waiting. Inside actions it reads authoritative source state,
including transaction-staged truth, with optimistic overlays excluded. Express
the predicate directly over sources: derived memos retain their normal cached view.

```ts
const send = action(function* (text: string) {
  const clientId = crypto.randomUUID();
  setMessages(rows => { rows.push({ clientId, text, pending: true }); });
  yield sendMessage({ clientId, text });
  yield until(() => messages.some(row => row.clientId === clientId), { timeout: 10_000 });
});
```

Use the echoed correlation id as the optimistic and confirmed row key. An already
arrived acknowledgment satisfies the predicate immediately. Set a timeout for
fallible live transports: `TimeoutError`, abort's reason, predicate errors, and
source rejections reject the waiter and compose with action failure/rollback.
`resolve` includes the caller's optimistic view; `until` excludes that overlay;
`refresh` delivers landed truth. All can see staged data inside their transaction.

## Actions and optimistic state

```ts
const [todos, setTodos] = createOptimisticStore<Todo[]>(() => api.getTodos(), []);
const [saving, setSaving] = createOptimistic(false);
const save = action(async function* (todo: Todo) {
  setSaving(true);
  setTodos(rows => { rows.push(todo); });
  const result = await api.save(todo);
  yield; // restore transaction context after await
  yield refresh(todos);
  return result;
});
```

`action` wraps a generator/async generator and returns an async function.
Define it during component setup; invoke it from handlers, effect apply/error
callbacks, `onSettled`, or other imperative scopes. Calling from a component body
or computation throws `ACTION_CALLED_IN_OWNED_SCOPE` in dev and risks livelock.

`yield` is the transaction-safe suspension point. After an internal `await`, use
a bare `yield` before subsequent reactive writes/refresh. Let the action own
flushing. Its generator's `return` is the caller's result; yielded values are
sequencing points. Catch failures locally or handle the returned Promise.
An uncaught error rejects it and reverts optimism, including falsy throws such
as `undefined`; ordinary action failure keeps the reactive system running.

Optimistic signal/store overrides last until transaction completion, then revert
onto confirmed data. Literal `undefined`, deletes, and removals are valid
overrides. Both plain and derived optimistic stores accept their corresponding
options (see [stores](stores.md)). Optimistic writes neither cause nor hide pending.

## Cancellation and streaming

Register `onCleanup` synchronously in compute, before the first await/yield:

```ts
const user = createMemo(async () => {
  const abort = new AbortController();
  onCleanup(() => abort.abort());
  return fetchUser(id(), { signal: abort.signal });
});
```

Superseded results are discarded; cleanup stops the external operation. After
suspension, owner context is absent (`NO_OWNER_CLEANUP`). Pending lazy work survives
temporary zero-subscriber gaps; rejoining subscribers reuse it until settlement.

An async-generator memo commits every `yield`. `return` ends it and discards its
value; an empty stream settles to `undefined` and releases `Loading`. Disposal
calls the iterator's `.return()`, but that call queues behind a parked await.
Register cleanup that actively closes/unblocks the source so `finally` can run.
See [socket and SWR patterns](patterns.md) for a cancellable stream.

## Errors

```tsx
<Errored fallback={(error, reset) => (
  <button onClick={reset}>Retry: {String(error())}</button>
)}><Page /></Errored>
```

Fallback receives an error accessor and reset action. Boundaries also recover
automatically. Programmatic compute errors use `createEffect(compute, { effect,
error })`. Error values retain identity and falsy values: `reject(null)` delivers
`null`, and `throw undefined` in an action rejects with `undefined`.
Branch on the expected error value/type, rather than its truthiness.
An inner `Errored` catches its content even through an intervening `Loading`.
