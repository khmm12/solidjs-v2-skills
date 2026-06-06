# Solid 1.x → 2.0 migration map

Full rename/removal table with before/after recipes. Source: official
MIGRATION.md + RFCs at solidjs/solid@next (bff4c21), verified against
solid-js@2.0.0-beta.14 typings.

## Import paths (mechanical)

| 1.x | 2.0 |
|---|---|
| `solid-js/web` | `@solidjs/web` |
| `solid-js/store` | `solid-js` |
| `solid-js/h` | `@solidjs/h` |
| `solid-js/html` | `@solidjs/html` |
| `solid-js/universal` | `@solidjs/universal` |
| `solid-js/jsx-runtime` | `@solidjs/web/jsx-runtime` |
| tsconfig `"jsxImportSource": "solid-js"` | `"@solidjs/web"` |
| `import type { JSX } from "solid-js"` | `from "@solidjs/web"`; renderer-neutral `JSX.Element` → `Element` from `solid-js` |

## Pure renames (mechanical)

| 1.x | 2.0 |
|---|---|
| `Suspense` | `Loading` |
| `SuspenseList` | `Reveal` (`revealOrder="forwards"` → default `order="sequential"`; `"together"` → `order="together"`; `tail="collapsed"` → `collapsed`) |
| `ErrorBoundary` | `Errored` (fallback `err` becomes an **accessor**: `err().message`) |
| `mergeProps` | `merge` (⚠ `undefined` now overrides, not "skip") |
| `splitProps(p, ["a"])` → `[local, rest]` | `omit(p, "a")` → rest only; read locals via `p.a` |
| `unwrap` | `snapshot` |
| `onMount` | `onSettled` (may return cleanup; leaf owner — no primitives/`onCleanup` inside) |
| `equalFn` | `isEqual` |
| `getListener` | `getObserver` |
| `Context.Provider` | the context itself: `<Ctx value={...}>` |
| `classList={{...}}` | `class={{...}}` / `class={[...]}` |
| `createSelector` | `createProjection` |
| `createDynamic(src, props)` | `dynamic(src)` factory (`<Dynamic>` JSX wrapper unchanged) |
| `indexArray` | `mapArray` with non-keyed mode |

## Semantic rewrites (judgement per call site)

### `batch(fn)` → nothing (or `flush()`)

Batching is the default. Delete the wrapper. Only if code *reads its own
writes* synchronously right after, add `flush()` at that point.

```ts
batch(() => { setA(1); setB(2); });   // 1.x
setA(1); setB(2);                     // 2.0; add flush() only if needed now
```

### `createEffect(fn)` → split form

```ts
// 1.x
createEffect(() => { el().title = name(); });
// 2.0 — compute reads, apply does side effects
createEffect(() => name(), value => { el().title = value; });

// 1.x initialValue:    createEffect(prev => count(), 0)
// 2.0:                 createEffect((prev = 0) => count(), (v, prev) => ...)

// 1.x cleanup via onCleanup inside → 2.0 return cleanup from apply
createEffect(
  () => name(),
  value => {
    const id = setInterval(() => log(value), 1000);
    return () => clearInterval(id);
  }
);
```

`createMemo(fn, initial)` → `createMemo(fn)` (second arg is options now).

### `on(deps, fn, { defer })` → split effect

```ts
createEffect(on(count, (v, prev) => log(v, prev)));            // 1.x
createEffect(() => count(), (v, prev) => log(v, prev));        // 2.0

createEffect(on([a, b], ([a, b]) => log(a, b)));               // 1.x
createEffect(() => [a(), b()], ([a, b]) => log(a, b));         // 2.0

createEffect(on(count, fn, { defer: true }));                  // 1.x
createEffect(count, fn, { defer: true });                      // 2.0 — defer is built in
```

### `createComputed` → by intent

| Intent | 2.0 |
|---|---|
| Readonly derivation (write-back into a signal) | `createMemo` |
| Side effect on change | split `createEffect` |
| Derived value that also has a setter | `createSignal(() => ...)` (writable memo) |

```ts
// 1.x derived-with-writeback
const [v, setV] = createSignal(props.initial);
createComputed(() => setV(props.initial));
// 2.0
const [v, setV] = createSignal(() => props.initial);
```

### `createResource` → async computation + `Loading`

```ts
const [user] = createResource(id, fetchUser);                  // 1.x
const user = createMemo(() => fetchUser(id()));                // 2.0
```

| Resource feature | 2.0 |
|---|---|
| `user.loading` | `<Loading>` boundary (initial) + `isPending(() => user())` (revalidation) |
| `user.error` + inline `<Show when={user.error}>` | `<Errored>` boundary (single error path) or effect `error` option |
| `refetch()` | `refresh(user)` (from handlers/actions, not computations) |
| `mutate(fn)` | `createOptimisticStore` + `action` (see below) |

Collections: prefer `createProjection(async () => api.list(), [], { key: "id" })`
or `createStore(fn, seed)` for keyed reconciliation.

### Mutation flows → `action` + optimistic

```ts
// 1.x: mutate + manual refetch, race-prone
mutate(prev => [...prev, todo]);
await saveTodo(todo);
refetch();

// 2.0
const [todos, setOptimistic] = createOptimisticStore(() => api.getTodos(), []);
const addTodo = action(function* (todo) {
  setOptimistic(s => { s.push(todo); });
  yield api.addTodo(todo);
  refresh(todos);
});
```

`startTransition`/`useTransition` → delete; transitions are built-in. Pending
UI: `isPending` / `<Loading on={...}>`.

### `onError` / `catchError` → structural

UI-level: `<Errored fallback={(err, reset) => ...}>` (note `err()` accessor).
Programmatic: `createEffect(compute, { effect, error: (err, cleanup) => ... })`.
`resetErrorBoundaries` → delete (boundaries heal; `reset` arg for manual retry).

### Stores: `produce` / paths / `createMutable`

```ts
setStore(produce(s => { s.x = 1; }));         // 1.x → drop produce, draft is default
setStore(s => { s.x = 1; });

setStore("user", "name", "Alice");            // 1.x path setter
setStore(s => { s.user.name = "Alice"; });    // 2.0 preferred
setStore(storePath("user", "name", "Alice")); // or compat helper (also ranges, storePath.DELETE)

setStore("todos", reconcile(server));         // 1.x
setStore(s => { reconcile(server, "id")(s.todos); }); // 2.0 — call inside the draft

const m = createMutable({ n: 0 }); m.n++;     // 1.x
const [m, setM] = createStore({ n: 0 }); setM(s => { s.n++; }); // 2.0
```

### `<Index>` → `<For keyed={false}>`

```jsx
<Index each={items()}>{(item, i) => <Row item={item()} index={i} />}</Index>
<For each={items()} keyed={false}>{(item, i) => <Row item={item()} index={i} />}</For>
```

Same callback shape (item accessor, plain index). ⚠ Default keyed `<For>`
changed too: `(rawItem, indexAccessor)` — when migrating a 1.x `<For>`, the
item is no longer wrapped, but verify index usage (`i()`).

### `use:` directives → ref factories

```jsx
<input use:autofocus />                          →  <input ref={autofocus} />
<button use:tooltip={{ content: "Save" }} />     →  <button ref={tooltip({ content: "Save" })} />
// compose: ref={[autofocus, tooltip(opts)]}
```

Delete the `declare module ... Directives` TS boilerplate. Rewrite directive
implementations to the two-phase factory (owned setup returning an unowned
apply callback) — see the main solidjs-v2 skill references.

### DOM namespaces and markers

| 1.x | 2.0 |
|---|---|
| `on:click={h}` / `oncapture:` | `onClick={h}`; native options via ref: `ref={el => el.addEventListener("click", h, { capture: true })}` |
| `attr:x` / `bool:x` / `class:x` / `style:x` | plain attributes; `class`/`style` object forms |
| `/*@once*/ expr` | keep it reactive; DOM initial state → `defaultValue`/platform default; deliberate one-shot → `untrack` in JS |
| camelCase attributes (`tabIndex`) | lowercase (`tabindex`); handlers stay camelCase |
| `clearDelegatedEvents()` | delete; dispose the render root |

### `from` / `observable`

```ts
const sig = from(obs$);                       // 1.x external → Solid
const sig = createMemo(async function* () {   // 2.0: async iterables are first-class
  for await (const v of obs$) yield v;
});

const obs$ = observable(sig);                 // 1.x Solid → external
createEffect(sig, v => externalLib.update(v)); // 2.0: push outward via effect
```

### Context

```tsx
<Theme.Provider value="dark">…                →  <Theme value="dark">…
```

`useContext` on a default-less context returns `T` (throws
`ContextNotFoundError` without Provider) — **delete `useX`-with-throw wrapper
hooks**; call `useContext` directly. If code relied on `undefined`, add an
explicit default or try/catch.

### Removed with no direct replacement

| Removed | Note |
|---|---|
| `createDeferred` | handle debouncing outside Solid |
| `enableScheduling` | gone |
| `writeSignal` | internal; was never meant to be public |
| `observable()` convenience | build a thin adapter over `createEffect`; expected to land in solid-primitives |

## Behavioral changes that need an audit (no grep pattern)

- **Reads after writes**: any code that sets a signal then immediately reads
  it (or the DOM) in the same tick now sees the old value — insert `flush()`
  or restructure. Tests are the most common casualty.
- **`merge`/setters treat `undefined` as a value** — it overrides. Audit
  `mergeProps` call sites passing optional objects.
- **`createRoot` is owned by its parent** — roots that relied on living
  forever need `runWithOwner(null, ...)`.
- **Strict reads**: top-level `props.x` captures and destructuring warn
  everywhere — expect a wave of `STRICT_READ_UNTRACKED` on first dev run.
- **Writes in scope throw**: 1.x "effect that sets a signal" patterns crash —
  rewrite as derivations or move writes to handlers.
