# Async data and actions

## Fetch and render

```tsx
import { createMemo, Loading } from "solid-js";

const user = createMemo(() => fetchUser(id()));
<Loading fallback={<Spinner />}>
  <Profile user={user()} />
</Loading>
```

The memo's compute callback returns a Promise; `createMemo` returns an accessor
of the resolved value, not a Promise or an accessor of a Promise.
Async stores/projections use the same model. Loading is structural; consumers
read a ready value rather than checking a `T | undefined` resource.
A `Promise<AsyncIterable<T>>` is flattened into a stream automatically.
An async-generator memo publishes each `yield`. Its `return` ends the stream and
discards the return value; the last published value remains. An empty completed
stream settles to `undefined` and releases `Loading`. Distinguish that completion
from a source still awaiting its first result.

`Loading` displays fallback for an initially unready branch. Once revealed, it
keeps stale content during revalidation. `<Loading on={[id(), page()]} ...>`
tracks the reads, not the returned value: a notification rearms the fallback
if content is still pending. The fallback lands with the triggering update,
not ahead of a held frame. Without a boundary,
pending async delays the client root mount and warns `ASYNC_OUTSIDE_LOADING_BOUNDARY`.
Streaming SSR instead holds the shell for an unbounded root hole.
Read pending data in JSX/compute; untracked pending reads throw.

### Provisional first paint

```ts
const user = createMemo<User | null>(() => fetchUser(id()), { loadingValue: null });
const [todos] = createStore(() => fetchTodos(), [], { seedLoadingValue: true });
```

The loading value is committed until the first real answer, and is the initial
`prev`. It neither suspends `Loading`, holds a transition, nor sets `isPending`.
Render first-load UI from that value. After the first answer, normal refetch rules
apply. With `ssrSource: "client"`, the server renders the declared loading/seed
value and hydration starts from that same first paint. Without a loading value,
the server renders the nearest `Loading` fallback for the structural client hole.
A bare client source outside a server boundary is a render error.

### Deferred reads and hydration

Use `createDeferred(() => fetchResults(query()))` from `solid-js` when the new
query must show immediately while results keep their previous answer. First
readiness still uses `Loading`. On a later query change, the refetch **does
not hold the query write**: JSX can show the new `query()` beside the old
result, and `isPending(results)` is true until the new answer. This is not a
debounce or an idle scheduler; a synchronous compute behaves like `createMemo`.

For async SSR sources, `"server"` (default) adopts the serialized answer on
hydration. The client still runs the compute synchronously to track dependencies
and discards the result; an `await` before the first fetch can escape that window
and issue a duplicate request. `"hybrid"` continues an async iterable on the
client after the server's first yield, skipping the client's duplicate first
yield; for a synchronous or Promise-shaped compute it acts like `"server"`.
Use `"client"` to defer browser-only work rather than using `"hybrid"` for it.

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
| `affects(source)` inside an action | Pending until the action settles/reverts, or the source's own still-running flight lands |
| Optimistic write | Changes displayed data; neither creates nor masks pending |

`isPending(id)` observes that signal, not loading of downstream data.
For a "Saving…" process indicator, co-write a row flag or a separate
`createOptimistic(false)` flag and read its **value**. This differs from Solid
1.x `resource.loading`, which becomes true on every refetch.

### `affects(target, key?)`

Call inside an action alongside the work it describes. Outside a transaction,
marks expire at the flush and never reach effects/UI.

Published overloads (a slot key belongs only to a store target):

```ts
import type { Accessor, Store } from "solid-js";
declare function affects(target: Accessor<unknown> | Store<object>): void;
declare function affects<T extends object>(target: Store<T>, key: keyof T): void;
```

- `affects(accessor)` marks that source.
- `affects(store)` marks its view of records reachable at declaration time,
  including captured row proxies. Later-added records are outside that snapshot.
  Marking a derived wrapper marks its view, not the original store it wraps.
  A plain store slot can instead expose the original proxy itself; that is a
  shared store, not an isolated derived view.
- `affects(record, "field")` marks exactly one slot. For multiple slots, make
  multiple calls or target the nested record; the optional key is a single key.

Marked data stays readable. Marks propagate to derivations without suspending
readers or holding the transaction; actual async data controls `Loading`.
For a reload indicator:

```tsx
const reload = action(function* () {
  affects(user);
  yield refresh(user);
});
// The action Promise, unlike bare refresh, needs a rejection handler.
<button onClick={() => { reload().catch(error => console.error(error)); }}>Reload</button>
```

## `latest`, `resolve`, `refresh`, `until`

| API | Completes/reads when | Inside an action |
|---|---|---|
| `latest(source)` | Reads the in-flight value; may fall back to stale | Escapes the holding transaction |
| `await resolve(fn)` | First settled value, **including false/undefined/0** | Includes the caller's optimistic view |
| `await refresh(source)` | A re-ask reaches quiescence | Delivers staged authoritative data, excluding own optimism |
| `await until(predicate, { timeout, signal })` | First settled **truthy** result; falsy/pending keeps waiting | Reads staged authoritative data, excluding optimism |

Use waiters in imperative code; `resolve`/`until` are outside tracking scopes.
`resolve<T>(fn: () => T): Promise<T>` accepts a read function. For a store, pass
`() => rows.some(...)`, not the store proxy itself. It rejects with the original
source error when the source rejects.
`latest` escapes a transaction, but rendered async derived from that latest read
still holds its lane. Put that derived UI under `Loading` to show a fallback,
or derive from the ordinary source when the latest display should stay independent.
`latest<T>(source: () => T): T` reads a value immediately. To preserve later reads,
use `const currentId = () => latest(id)`, then read `currentId()` in JSX/compute.

### Awaitable refresh

Unlike `affects`, `refresh` does not take an arbitrary `Accessor` or `Store`.
Its published signature is:

```ts
import type { Refreshable } from "solid-js";
declare function refresh<T>(
  target: Refreshable<T>,
): Promise<T extends (...args: any) => infer V ? V : T>;
```

`refresh(target)` invalidates the target and returns a Promise for its next
quiescent state. Superseding invalidations fold into that wait; it returns whatever
finally settles. An accessor target resolves with its value; a derived store
target resolves with that store. Pass the original source accessor or the
derived store root, which carries the `Refreshable` type. To update a row, use
`await refresh(store)` then read `store.row`; the derive runs for the whole
store, not one slot. Don't pass an accessor wrapper or cast a nested read.

```ts
import { createStore, refresh } from "solid-js";

type Row = { id: string; label: string };
function createRows(load: () => Promise<Row[]>) {
  const [rows] = createStore<Row[]>(load, []);
  return {
    rows,
    async reloadRow(id: string) {
      const freshRows = await refresh(rows);
      return freshRows.find(row => row.id === id);
    },
  };
}
```

A failed refresh rejects with the original source error; ignoring its Promise is safe from an
unhandled rejection. It stays quiet for `isPending`, including when awaited.
Inside actions, `yield refresh(source)` delivers authoritative data already staged
in the held transaction, excluding the caller's optimistic override.

### Live acknowledgments

`until(fn, options?)` resolves the first settled truthy result. Falsy/pending
results keep waiting. Inside actions it reads authoritative source state,
including transaction-staged truth, with optimistic overlays excluded. Express
the predicate directly over sources: derived memos retain their normal cached view.

```ts
import { action, createOptimisticStore, until } from "solid-js";

type Message = { id: string; clientId?: string; text: string; pending?: boolean };
type Inbox = { messages: Message[]; receipts: string[] };
function createMessages(
  source: () => AsyncIterable<Message[]>,
  sendMessage: (message: Message) => Promise<unknown>,
) {
  const pendingReceipts = new Map<string, boolean>();
  const [inbox, setInbox] = createOptimisticStore<Inbox>(async function* () {
    for await (const messages of source()) {
      for (const row of messages) {
        if (row.clientId !== undefined && pendingReceipts.has(row.clientId)) pendingReceipts.set(row.clientId, true);
      }
      yield { messages, receipts: [...pendingReceipts].filter(([, received]) => received).map(([id]) => id) };
    }
  }, { messages: [], receipts: [] }, { key: "id" });
  const send = action(function* (text: string) {
    const clientId = crypto.randomUUID();
    const message = { id: clientId, clientId, text };
    pendingReceipts.set(clientId, false);
    try {
      setInbox(draft => { draft.messages.push({ ...message, pending: true }); });
      yield sendMessage(message);
      yield until(() => inbox.receipts.includes(clientId), { timeout: 1_000 });
    } finally {
      pendingReceipts.delete(clientId);
    }
  });
  return { inbox, send };
}
```

This protocol keeps `id` stable across optimistic and confirmed rows; the echo's
`clientId` confirms the request even if later snapshots omit that field. Render
`inbox.messages` under `Loading`. Completion
requires **both** successful request work and its matching acknowledgment, in
either arrival order. The request yield above keeps an early echo from completing
the action. An already-arrived acknowledgment satisfies the predicate immediately
if it is still in source state. When later snapshots can erase acknowledgment
evidence, retain the receipt in reactive authoritative state: the source above
processes every snapshot and yields its retained receipts with the rows.
`until` reads the reactive store array. The internal Map is only bookkeeping:
the action adds its ID, incoming echoes mark it received, and `finally` deletes
it on success or failure. Each snapshot publishes the currently active receipts,
so completed requests do not accumulate. Test request-first, echo-first, and
an echo immediately followed by a snapshot without its receipt.

For a custom live-source adapter, preserve the active cancellation in
[Streaming a socket](patterns.md#streaming-a-socket); iterator `finally` alone
cannot wake a silent connection. Set a timeout for
fallible live transports: `TimeoutError`, abort's reason, predicate errors, and
source rejections reject the waiter and compose with action failure/rollback.
Normal iterator completion is not rejection: if its last value still fails the
acknowledgment predicate, `until` keeps waiting for timeout/abort. Make a lost
connection reject the source, or abort the waiter; merely ending the iterator
does not signal a failed acknowledgment.

## Client actions and optimistic state

Optimism is a temporary display overlay, not confirmed data. Refetch or a live
server echo supplies the lasting state.

| Generator outcome | Returned Promise | Optimistic overlay |
|---|---|---|
| Completes normally | Fulfills | Removed |
| Catches a failure, then completes normally | Fulfills | Removed |
| Lets a failure escape | Rejects | Removed |

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
Starting an action is a transaction-starting write. Define it during component
setup; invoke it from handlers, effect apply/error
callbacks, `onSettled`, or other imperative scopes. Calling from a component body
or computation throws `ACTION_CALLED_IN_OWNED_SCOPE` in dev. This prevents
livelock: a computation tracking what its action writes can repeatedly start
replacement transactions before any value commits.

`yield` is the transaction-safe suspension point. After an internal `await`, use
a bare `yield` before subsequent reactive writes/refresh. Let the action own
flushing. Its generator's `return` is the caller's result; yielded values are
sequencing points. Catch failures locally or handle the returned Promise.
An uncaught error completes the transition, rejects its Promise and reverts
optimism, including falsy throws such
as `undefined`; ordinary action failure keeps the reactive system running.

### Editable rows from replacing snapshots

Keep confirmed rows and the in-flight edit in separate reactive state. Render
the edit over the current confirmed row; unrelated/stale snapshots then update
confirmed data without erasing the preview. An optimistic write into a derived
store's old descendant can be lost when a new authoritative root replaces it
(see [store identity](stores.md#options-and-derived-forms)).

```ts
import { action, createOptimistic } from "solid-js";

type Row = { id: string; label: string };
function createRowLabels(
  rows: () => readonly Row[],
  renameAndConfirm: (id: string, label: string) => Promise<void>,
) {
  const [preview, setPreview] = createOptimistic<Row | undefined>(undefined);
  const rename = action(function* (id: string, label: string) {
    setPreview({ id, label });
    yield renameAndConfirm(id, label);
  });
  return {
    rows, rename,
    label(row: Row) { const edit = preview(); return edit?.id === row.id ? edit.label : row.label; },
    saving: () => preview() !== undefined,
  };
}
```

The injected `renameAndConfirm` must finish both the request and authoritative
confirmation; a request-success-only Promise is insufficient. For sockets, use
the request + receipt sequence above. Render `labels.label(row())` inside keyed
`For` JSX, and read `labels.saving()` for the process indicator. Handle
`labels.rename(...).catch(...)` at the event boundary. This helper handles one
edit at a time per instance: disable/guard overlapping saves while saving.
On either completion or rejection, the preview disappears and JSX reads the
latest confirmed label. Test initial preview, an intervening stale snapshot,
confirmation, and rejection separately.

Literal `undefined`, deletes, and removals are valid optimistic overrides.
Both plain and derived optimistic stores accept their corresponding
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

Solid discards superseded results. Cleanup for a run that never committed is
prompt on supersede; a visible run stays live until its replacement lands or
its owner is disposed. Do not make the replacement wait on visible-run cleanup.
After suspension, owner context is absent (`NO_OWNER_CLEANUP`). Pending lazy
work survives temporary zero-subscriber gaps; rejoining subscribers reuse it.

`from()` returns an async iterable, not an accessor. For a callback
subscription or Observable, return it directly from a memo:

```tsx
import { createMemo, from, Loading } from "solid-js";

function ChannelView(props: {
  channel: string;
  subscribe: (channel: string, next: (value: string) => void, error: (error: unknown) => void) => () => void;
}) {
  const message = createMemo(() => {
    const channel = props.channel;
    const subscribe = props.subscribe;
    return from<string>((next, error) => subscribe(channel, next, error));
  });
  return <Loading fallback={<p>Connecting…</p>}><p>{message()}</p></Loading>;
}
```

Read changing props in compute, before registering the subscription. This
makes the dependencies explicit rather than relying on when the adapter or
transport invokes a callback. Do not capture a replaceable prop in component setup.
`from` also accepts an async iterable. Push values coalesce to the latest
between pulls; synchronous emission during subscribe avoids a loading frame.
The adapter closes on supersede/disposal. Solid calls `.return()` on a returned
iterator, but an async generator parked in `await` cannot unwind until that
await settles. Give low-level sources real cancellation; see the
[socket pattern](patterns.md#streaming-a-socket).

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
