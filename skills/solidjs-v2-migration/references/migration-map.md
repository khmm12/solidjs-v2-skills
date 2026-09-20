# Solid 1.x to 2.0 migration map

Verified against solid-js@2.0.0-rc.8 / @solidjs/web@2.0.0-rc.8 published typings and solidjs/solid@f8b40b7e sources/tests.

## Imports and renames

| 1.x | v2 target |
|---|---|
| `solid-js/web` | `@solidjs/web` |
| `solid-js/store` | `solid-js` |
| `solid-js/h`, `/html`, `/universal` | `@solidjs/h`, `@solidjs/html`, `@solidjs/universal` |
| `solid-js/jsx-runtime`, JSX import source | `@solidjs/web/jsx-runtime`, `jsxImportSource: "@solidjs/web"` |
| `JSX` from `solid-js` | `JSX` from `@solidjs/web`; neutral renderables use `Element` from `solid-js` |
| `babel-preset-solid` | `@solidjs/babel-plugin`; Vite integration: `@solidjs/vite-plugin` |
| `Suspense`, `SuspenseList`, `ErrorBoundary` | `Loading`, `Reveal`, `Errored` |
| `mergeProps`, `splitProps`, `unwrap` | `merge`, `omit` (rest-only), `snapshot` |
| `onMount` | `onSettled` |
| `equalFn`, `getListener` | `isEqual`, `getObserver` |
| `Context.Provider` | `<Context value={...}>` |
| `classList` | `class` object/array |
| `createSelector` | `createProjection` |
| `createDynamic(source, props)` | `dynamic(source)` component factory |
| `Index`, `indexArray` | `For keyed={false}`, non-keyed `mapArray` |

Rename caveats: `Errored` fallback gets an accessor (`error()`); `merge` treats
undefined as an overriding value; `omit(props, "local")` returns only the rest.
`Reveal` uses `order="sequential"` (default), `"together"`, or `"natural"`, with
`collapsed` for hiding later sequential fallbacks.

## Effects and state

Use the intent of each v1 `createComputed`/write-back effect:

| Intent | v2 |
|---|---|
| Readonly derivation | `createMemo(() => compute())` |
| Writable prop-derived state | `createSignal(() => props.initial)` |
| Side effect | `createEffect(compute, apply)` |
| Read DOM geometry and update layout | `createRenderEffect(compute, apply)` |

```ts
createEffect(
  () => ({ node: el(), title: name() }),
  ({ node, title }) => { node.title = title; }
);
```

Move `on(deps, ...)` dependencies into compute; use `{ defer: true }` for deferred
initial apply. Replace initial-value arguments with default parameters for
`prev`; the second memo argument is options. Extract reactive fields in compute;
apply is untracked. Return teardown from apply.
The single-callback `createEffect` form has no v2 overload and throws in dev.
`createTrackedEffect` remains deprecated migration support; prefer the split
effect or `onSettled` according to the intent above.

Call setters/actions from handlers, effect apply/error callbacks, or `onSettled`.
Owned computation/setup scopes derive state; writes/action calls there throw
in dev. `untrack` preserves the owner, so the write guard still applies.

Batching is automatic. Remove `batch` wrappers and use `flush()` only when an
imperative next-line read needs committed state or updated DOM. Both effect lanes
run before paint, with the render lane before the user lane.

## Async resources and mutations

```tsx
const user = createMemo(() => fetchUser(id()));
<Loading fallback={<Spinner />}><Profile user={user()} /></Loading>
```

| v1 resource feature | v2 |
|---|---|
| `createResource` | Async memo, derived store, or projection |
| `.loading` | `Loading` for initial readiness; `isPending` for unrevealed changes |
| `.error`, `onError`, `catchError` | `Errored` or effect `{ effect, error }` |
| `refetch` | `refresh(source)`; await/yield its settled result when sequencing |
| `mutate`, mutation transitions | `action` with optimistic primitives |

Bare refresh is quiet. Put `affects(source); yield refresh(source)` inside an
action to make that reload pending. A saving process indicator reads a separate
optimistic flag, rather than the readiness of the data.

```ts
const [todos, setTodos] = createOptimisticStore<Todo[]>(() => api.list(), []);
const add = action(async function* (todo: Todo) {
  setTodos(rows => { rows.push(todo); });
  const result = await api.save(todo);
  yield; // regain transaction context before writes/refresh
  yield refresh(todos);
  return result;
});
```

`yield` preserves transaction sequencing; optimism reverts at completion/failure.
Live-channel confirmations can hold the action with `yield until(predicate,
{ timeout })`, reading authoritative data rather than its optimistic overlay.

## Stores

Use `createStore` with draft setters for `createMutable`/`modifyMutable` and
`produce` wrappers. New setter code mutates a draft; `storePath` is available
for retained path-style migrations.

```ts
setStore(draft => { draft.user.name = "Ada"; });
setStore(draft => { reconcile(serverTodos, "id")(draft.todos); });
```

`reconcile(value, key?)` accepts a string/extractor/null. Omission defaults to
`"id"`; null means positional, and missing keys fall back to position. Nested
array/object shape changes replace the slot. Standalone reconcile throws on a
different keyed root entity; derived returns can swap the authoritative root.
Setter return values shallow-replace; keyed merge belongs to reconcile/derivation.
Shallow stores notify on root slot replacement; treat nested records as immutable.

## Lists, props, lifecycle, DOM

| `For` keying | Item | Index |
|---|---|---|
| identity/default | value | accessor |
| `false` | accessor | number |
| key function | accessor | accessor |

Solid 1.x default `For` already supplied a raw item; preserve it and read `i()`.
Read item/index accessors inside JSX/compute, since callback bodies are setup.
Keep props on the props object and read `props.x` in tracked scopes. JSX value
props (`value={count()}`) remain reactive through getters in both versions.

Call `onSettled` setup from a component body and return cleanup. Leaf callbacks
use pre-created primitives; `onCleanup` inside them throws. Out-of-band
`onSettled` supports one-shot work; returned teardown throws in dev and is dropped
in production. Async compute cleanup uses synchronous `onCleanup` before await/yield.

Use callback refs/ref factories for `use:` directives. Compose callbacks in
arrays. Use ordinary HTML attributes and `class`/`style` objects for namespaced
attributes, camelCase handlers for events, and ref listeners for native options.
Use lowercase `tabindex`/`readonly`; initial form values use platform defaults.
Put reactive handler selection inside the callback. Dispose the render root to
remove delegated listeners (`clearDelegatedEvents` has no replacement call).

`useContext` on a default-less context returns `T` and throws if missing; call it
directly when a wrapper only repeats that check. Supply an explicit default for
optional contexts. Parent disposal disposes child roots; detach intentionally
through `runWithOwner(null, ...)` when needed.

## APIs without a direct replacement

`createDeferred` needs application-level debouncing. `enableScheduling` and the
internal `writeSignal` have no public equivalent. Replace `from` with an async
iterable memo and `observable` with an adapter driven by a split effect. Hot
streams need synchronous cleanup that cancels/unblocks the external source;
iterator `.return()` alone queues behind a parked await.

## Completion

Typecheck, flush before test assertions, and create reactive test graphs in a
root. Exercise loading, error/retry, optimistic rollback, list identity, and
cleanup for affected features. Dev diagnostics identify frozen reads, owned
writes, pending reads outside tracking, and leaf-scope cleanup mistakes.
