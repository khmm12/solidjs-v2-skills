# Composed patterns

Verified against solid-js@2.0.0-rc.8 / @solidjs/web@2.0.0-rc.8 published typings and solidjs/solid@f8b40b7e sources/tests.

## Streaming query (cache first, then network)

Carry refresh status in data because bare refresh is quiet. Store the key in each
committed result to distinguish a same-key refresh from a changed query. Compare
primitive keys with `Object.is`; accept a comparator for composite keys.

```ts
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

```ts
const [selectedId, setSelectedId] = createSignal<string>();
const selected = createProjection<Record<string, boolean | string | undefined>>(draft => {
  const id = selectedId();
  const previous = draft._prev;
  if (typeof previous === "string") delete draft[previous];
  if (id !== undefined) draft[id] = true;
  draft._prev = id;
}, {});
```

Rows read `selected[props.id]`; a selection change touches the previous and next
row. Reserve `_prev` for metadata (use a separate key space if ids can equal it).
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

A push-to-async-iterator bridge must buffer between pulls and expose cancellation
that both unsubscribes and wakes a waiting consumer:

```ts
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
        for (const value of buffer.splice(0)) yield value;
        if (done) return;
        if (buffer.length) continue;
        await new Promise<void>(resolve => { wake = resolve; });
        wake = undefined;
      }
    },
  };
  return { iterable, cancel };
}

function createSocketStream(url: () => string) {
  return createMemo(async function* () {
    const ws = new WebSocket(url());
    const { iterable, cancel } = subscribeToAsyncIterable<string>(emit => {
      const listener = (event: MessageEvent) => emit(String(event.data));
      ws.addEventListener("message", listener);
      return () => ws.removeEventListener("message", listener);
    });
    onCleanup(() => { cancel(); ws.close(); });
    yield* iterable;
  });
}
```

The bridge serves one consumer; add bounded
backpressure when the source can outpace it. Define close/error handling for the
actual socket protocol. Cleanup is registered before yield; it unblocks a parked
await so Solid's iterator `.return()` can complete. Each yield commits a value;
a generator return ends the stream without emitting. Render under `Loading`.

## State ownership and effects

Use module state for browser-wide shared data. Use per-request instances/context
for SSR user data to keep requests isolated. Context also scopes per-form/widget
services. A default-less context supplies required-provider checking itself.
For a deliberate detached computation graph, use `runWithOwner(null, ...)` and
manage its root lifetime.

Persistence over a whole store uses `createEffect(() => deep(settings), save)`;
compute captures plain tracked data, apply persists it. A handler requiring fresh
DOM uses write → `flush()` → read/focus. For optimistic mutation and saving flags,
follow [async and actions](async-and-actions.md).
