# Composed patterns

Verified against solid-js@2.0.0-rc.8 / @solidjs/web@2.0.0-rc.8 published typings and solidjs/solid@f8b40b7e sources/tests.

## Streaming query (cache first, then network)

Carry refresh status in data because bare refresh is quiet. Store the key in each
committed result to distinguish a same-key refresh from a changed query. Compare
primitive keys with `Object.is`; accept a comparator for composite keys.

```ts
import { createMemo, isPending, onCleanup, refresh } from "solid-js";

type QueryState<K, T> = { key: K; value: T; refreshing: boolean; error?: unknown };
function createCachedQuery<K, T>(options: {
  source: () => K;
  fetcher: (key: K, signal: AbortSignal) => Promise<T>;
  cache: Map<K, T>;
  equals?: (a: K, b: K) => boolean;
}) {
  const same = options.equals ?? Object.is;
  const state = createMemo<QueryState<K, T>>(async function* (prev) {
    const key = options.source();
    const abort = new AbortController();
    onCleanup(() => abort.abort());
    const previous = prev && same(prev.key, key) ? prev : undefined;
    const cached = options.cache.get(key);
    if (previous) yield { ...previous, refreshing: true, error: undefined };
    else if (cached !== undefined) yield { key, value: cached, refreshing: true };
    try {
      const value = await options.fetcher(key, abort.signal);
      if (abort.signal.aborted) return;
      options.cache.set(key, value);
      yield { key, value, refreshing: false };
    } catch (error) {
      if (abort.signal.aborted) return;
      if (previous) yield { ...previous, refreshing: false, error };
      else throw error;
    }
  });
  return {
    get data() { return state().value; },
    get pending() { return isPending(state) || state().refreshing; },
    get error() { return state().error; },
    refresh: () => refresh(state),
  };
}
```

Read the facade under `Loading`; keep its getters intact. The Map cache uses its
own key identity: stable/serialized keys also matter for cache lookup. Async
storage can replace the Map when needed, with its own error policy.

## Selection projection

The projection result is readonly. Change the selected-id signal; the projection's
compute callback updates its own mutable draft, and rows read the resulting store.

```tsx
import { For, createProjection, createSignal } from "solid-js";

function SelectableRows(props: { rows: readonly { id: string; label: string }[] }) {
  const [selectedId, setSelectedId] = createSignal<string>();
  const selected = createProjection<Record<string, boolean>>(draft => {
    for (const key of Object.keys(draft)) delete draft[key];
    const id = selectedId();
    if (id !== undefined) draft[`row:${id}`] = true;
  }, {});

  return <For each={props.rows} keyed={row => row.id}>{row => {
    const isSelected = () => selected[`row:${row().id}`] === true;
    return <button
      class={{ selected: isSelected() }}
      aria-pressed={isSelected() ? "true" : "false"}
      onClick={() => setSelectedId(row().id)}
    >{row().label}</button>;
  }}</For>;
}
```

Each widget owns its selection. Rows read their own marker; the draft has at most
one, so clearing it touches the previous row and adding one touches the next.
Prefix keys consistently to keep arbitrary ids out of JavaScript's special keys.
The keyed row is an accessor because its record may be replaced. Read `row()`
inside JSX: the compiler tracks the value expressions, including labels, boolean
class entries, and string ARIA states. See [lists and DOM](control-flow-and-dom.md).

For editable prop-derived state use `createSignal(() => props.initial)`.

## Demand-driven resources

```ts
const socket = createMemo(() => {
  const ws = new WebSocket(url());
  onCleanup(() => ws.close());
  return ws;
}, { lazy: true, unobserved: () => log("socket released") });
```

A settled synchronous resource tears down when its last subscriber leaves and
recreates on a later read. Pending lazy async work survives temporary subscriber
gaps; register explicit cancellation synchronously in compute.

## Streaming a socket

For one active subscription, cancel the previous run **before** opening its
replacement, and register the current run's disposal cleanup too. These are
separate triggers: after rendering, an old owner can survive until the replacement
commits. Keep this lifetime logic in the generic helper; adapt only `subscribe`
to the application's transport. The bridge buffers between pulls, and its cancel
operation both unsubscribes and wakes a waiting consumer:

```ts
import { createMemo, onCleanup } from "solid-js";

function subscribeToAsyncIterable<T>(subscribe: (emit: (v: T) => void) => () => void) {
  // ponytail: single consumer, unbounded buffer; add backpressure for sustained high rates.
  const buffer: T[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  const unsubscribe = subscribe(value => {
    if (!done) { buffer.push(value); wake?.(); }
  });
  const cancel = () => {
    if (!done) { done = true; unsubscribe(); wake?.(); }
  };
  const iterable: AsyncIterable<T> = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (buffer.length) yield buffer.shift()!;
        if (done) return;
        await new Promise<void>(resolve => { wake = resolve; });
        wake = undefined;
      }
    },
  };
  return { iterable, cancel };
}

function createPushSource<K, T>(
  key: () => K,
  subscribe: (key: K, emit: (value: T) => void) => () => void,
) {
  let cancelPrevious: (() => void) | undefined;
  return createMemo(async function* () {
    const currentKey = key();
    cancelPrevious?.();
    const { iterable, cancel } = subscribeToAsyncIterable<T>(emit => subscribe(currentKey, emit));
    cancelPrevious = cancel;
    onCleanup(cancel);
    yield* iterable;
  });
}

function createSocketStream(url: () => string) {
  return createPushSource<string, string>(url, (address, emit) => {
    const ws = new WebSocket(address);
    const listener = (event: MessageEvent) => emit(String(event.data));
    ws.addEventListener("message", listener);
    return () => { ws.removeEventListener("message", listener); ws.close(); };
  });
}
```

With an application's existing callback service, pass that service directly
through the helper; the WebSocket wrapper is only for owning the transport:

```tsx
import { Loading } from "solid-js";

function ChannelView(props: {
  channel: string;
  subscribe: (channel: string, emit: (value: string) => void) => () => void;
}) {
  const message = createPushSource<string, string>(
    () => props.channel,
    (channel, emit) => props.subscribe(channel, emit),
  );
  return <Loading fallback={<p>Connecting…</p>}><p>{message()}</p></Loading>;
}
```

The key accessor reads the current prop inside compute. For an explicitly
accessor-valued prop, use `() => props.channel()` to track both its replacement
and the value it reads; passing `props.channel` captures that function at setup.

The inner `while` rechecks the buffer after each yield, including messages that
arrive while the consumer is processing a value before a waiter exists. Drain
them before parking. This small bridge serves one consumer; for sustained high
rates use a bounded queue/backpressure instead of an unbounded array with shift.
Define close/error handling for the socket protocol. Register `onCleanup`
before the first await/yield, while the computation owns the callback.
Keep each cleanup bound to its own connection, not a mutable current-connection
variable. Disposal
calls `.return()`, but it queues behind a parked await; `finally` alone cannot
close a silent socket. Cancellation wakes that await so the iterator can unwind.
Each yield commits a value; return ends without emitting. Render under `Loading`.

## State ownership and effects

Use module state for browser-wide shared data. Use per-request instances/context
for SSR user data to keep requests isolated. Context also scopes per-form/widget
services. A default-less context supplies required-provider checking itself.
For a deliberate detached computation graph, use `runWithOwner(null, ...)` and
manage its root lifetime. `createRoot` returns its initializer's result, not an
automatic disposer. Retain the callback's disposal argument explicitly:

```ts
const dispose = runWithOwner(null, () => createRoot(stop => {
  // Build the detached graph here.
  return stop;
}));
// When its owner is done:
dispose();
```

Persistence over a whole store uses `createEffect(() => deep(settings), save)`;
compute captures plain tracked data, apply persists it. A handler requiring fresh
DOM uses write → `flush()` → read/focus. For optimistic mutation and saving flags,
follow [async and actions](async-and-actions.md).
