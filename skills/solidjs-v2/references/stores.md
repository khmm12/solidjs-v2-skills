# Stores

Verified against solid-js@2.0.0-rc.8 / @solidjs/web@2.0.0-rc.8 published typings and solidjs/solid@f8b40b7e sources/tests.

## Draft setters

Import store APIs from `solid-js`. Mutate the setter's draft:

```ts
const [state, setState] = createStore({ user: { name: "A" }, tags: ["one"] });
setState(draft => { draft.user.name = "B"; draft.tags.push("two"); });
const [rows, setRows] = createStore([{ id: 1 }, { id: 2 }]);
setRows(draft => draft.filter(row => row.id !== 1));
```

A returned value shallow-replaces the root: object top-level diff, or array
indices and length. Keyed reconciliation belongs to `reconcile`/derived returns.
For migrated path setters, `storePath("user", "name", "B")` produces a draft
callback; it supports ranges, filters, and `storePath.DELETE`. New code uses drafts.

## Options and derived forms

| Form (also applies to `createOptimisticStore`) | Options |
|---|---|
| `createStore(initial, options?)` | `StoreOptions`: `name`, `shallow` |
| `createStore(derive, seed, options?)` | `ProjectionOptions`: `name`, `key`, `shallow`, hydration fields |

Published `solid-js` client/server and `@solidjs/signals` typings agree on these
overloads, including plain optimistic options and refreshable derived stores.

| Derived state | Readonly | Writable |
|---|---|---|
| Value | `createMemo(fn)` | `createSignal(fn)` |
| Store | `createProjection(fn, seed, options?)` | `createStore(fn, seed, options?)` |

The derive function receives a draft. It may mutate that draft or return a value,
Promise, or AsyncIterable. Returned data is reconciled with `key` (default `"id"`).
A changed root identity/shape swaps the authoritative root and discards its
previous descendants. The seed is the backing object/array; use `seedLoadingValue`
when that seed should be visible before first resolution.

```ts
const users = createProjection<User[]>(() => api.listUsers(), [], { key: "id" });
const [cache, setCache] = createStore(draft => { draft.x = compute(); }, { x: 0 });
```

## Reconciliation

```ts
// key?: string | ((item: any) => any) | null
setState(draft => { reconcile(serverUser)(draft.user); });
setRows(reconcile(serverRows, null));
```

`reconcile<T extends U, U>(value: T, key?)` returns `(state: U) => void`.
Omitted key selects `"id"`; `null` selects fully positional matching. Missing
item keys fall back to position. Enumerable symbol keys participate in diffing.
An array/object mismatch at a nested slot replaces that slot.

Standalone reconcile preserves the root entity chosen by the caller: a different
keyed root throws. Derived return values have the authoritative-swap behavior
above. Keep these two root contracts distinct.

## Shallow stores and raw objects

`shallow: true` tracks root properties/array slots. Treat nested raw records as
immutable and replace their root slot by reference:

```tsx
const [rows, setRows] = createStore([{ id: 1, label: "old" }], { shallow: true });
setRows(draft => { draft[0] = { ...draft[0], label: "new" }; });
<For each={rows} keyed={row => row.id}>{row => <Row row={row()} />}</For>
```

Mutating a nested raw field is invisible. `reconcile` respects the shallow
boundary and swaps references. Consumer keying preserves row DOM identity when
refreshes rebuild record objects; custom-key `For` supplies an item accessor.

Native/branded objects (`Map`, `Date`, DOM nodes, `Headers`) stay raw. Replace
the store slot to notify consumers:

```ts
setState(draft => { draft.cache = new Map(draft.cache).set("a", 1); });
```

User-defined class instances remain wrappable unless frozen. Use shallow mode
or reference replacement for raw data; `markRaw` is an internal symbol with no
public `solid-js` root export.

## Nested store views

A derived store returning another store, or embedding one, keeps the inner
store live:

```tsx
const [items] = createOptimisticStore<Item[]>(() => api.list(), []);
const [view] = createOptimisticStore<{ items: readonly Item[] }>(
  () => ({ items }), { items: [] }
);
<For each={view.items}>{item => <Row item={item} />}</For>
```

`For`/`mapArray`, `Object.keys`, `snapshot`, and `deep` follow structural changes
through wrappers. Inner adds/deletes/reconcile invalidate the outer view.
Preserve the inner proxy to retain fine-grained identity.

## Snapshots, merge, omit

- `snapshot(store)` returns a plain deep copy without subscribing.
- `deep(store)` returns a plain deep copy and tracks every nested property;
  use it in effect compute to pass plain values to apply.
- Both observe active optimistic overrides, preserve enumerable symbol keys,
  and preserve sparse-array holes/length (holes serialize as `null`).
- `merge(defaults, props, overrides)` preserves reactive getters; rightmost wins.
  `undefined` is a real overriding value.
- `omit(props, "class", "style")` creates a reactive rest-only proxy view.

Use `createProjection` for keyed selection (the v2 replacement for v1
`createSelector`). For selection and prop-seeded state, read [patterns](patterns.md).
