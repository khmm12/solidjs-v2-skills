# Stores

## Draft setters

Import `createStore` from `solid-js`; its returned tuple provides the store and
its locally named setter. `setStore`/`setState` are not module exports. Mutate the
setter's draft:

```ts
import { createStore } from "solid-js";

type State = { user: { name: string }; tags: string[] };
const [state, setState] = createStore<State>({ user: { name: "A" }, tags: [] });
setState(draft => { draft.user.name = "B"; draft.tags.push("two"); });
const [rows, setRows] = createStore([{ id: 1 }, { id: 2 }]);
setRows(draft => draft.filter(row => row.id !== 1));
```

Use a block callback for mutation: `setRows(draft => { draft.push(row); })`.
Returning `push(...)` returns a number, not `void` or replacement rows. Return a
value only when it is the intended replacement root; mutation results are not ignored.
Type an initially empty collection with its intended element type; an inferred
`never[]` cannot accept later items.

The store is a proxy object/array, not an accessor: read `rows.length`, not
`rows()`. A tracked reader is `() => rows.length`.

A returned value shallow-replaces the root: object top-level diff, or array
indices and length. Keyed reconciliation belongs to `reconcile`/derived returns.
Use draft mutation for path updates; `storePath` is not a `solid-js` export.

## Options and derived forms

Both `createStore` and `createOptimisticStore` have these published call shapes
(shown with `createStore`):

| Form | Options | Seed |
|---|---|---|
| Plain value | `StoreOptions`: `shallow`, `name`, compiler `loc`; no hydration options | Initial value is the store data |
| Whole-value derived object | `ProjectionOptions` except `seedLoadingValue`: includes `shallow`, `key`, and hydration options | Omit or pass `null`; not for arrays |
| Seeded derive | `ProjectionOptions`, including `shallow`, `key`, `seedLoadingValue`, and hydration options | Complete `T`, not `Partial<T>` |

Both derived forms expose a refreshable store. The seeded derive can mutate
its draft and return nothing, return a replacement, return a Promise, or
return an AsyncIterable that **yields `void | T`**, not another iterable.
The backing seed stays hidden before the first async answer unless
`seedLoadingValue: true` explicitly exposes it (seeded overload only).

```ts
import type { Store, StoreSetter, StoreOptions, ProjectionOptions, Refreshable } from "solid-js";
type NoFn<T> = T extends Function ? never : T;
type NoArray<T> = Extract<T, readonly unknown[]> extends never ? unknown : never;
declare function createStore<T extends object = {}>(
  initial: NoFn<T> | Store<NoFn<T>>, options?: StoreOptions
): [Store<T>, StoreSetter<T>];
declare function createStore<T extends object = {}>(
  derive: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T>,
  seed?: null, options?: Omit<ProjectionOptions, "seedLoadingValue">
): [Refreshable<Store<T>>, StoreSetter<T>];
declare function createStore<T extends object = {}>(
  derive: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: NoFn<T> | Store<NoFn<T>>, options?: ProjectionOptions
): [Refreshable<Store<T>>, StoreSetter<T>];
```

The Solid wrappers add hydration fields to `ProjectionOptions`.
`StoreSetter<T>` is
`(fn: (draft: T) => T | void) => void`; the derive callback uses the same `T`
for its draft and replacement data, not two independent data types.

| Derived state | Readonly | Writable |
|---|---|---|
| Value | `createMemo(fn)` | `createSignal(fn)` |
| Store | `createProjection(fn, seed, options?)` | `createStore(fn, seed, options?)` |

The derive callback may mutate without returning data, or return/yield
replacement data. Returned data is reconciled with `key` (default `"id"`).
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

Mutating a nested raw field is invisible. At a shallow boundary, `reconcile`
compares nested records by reference, not by their fields, and swaps changed
references. Consumer keying preserves row DOM identity when
refreshes rebuild record objects; custom-key `For` supplies an item accessor.

Native/branded objects (`Map`, `Date`, DOM nodes, `Headers`) stay raw. Replace
the store slot to notify consumers:

```ts
setState(draft => { draft.cache = new Map(draft.cache).set("a", 1); });
```

Ordinary user-defined class instances wrap by default. Prototype getters read
through the proxy; call mutating methods on the draft to notify readers.
Frozen plain objects and arrays also wrap: draft writes change the store, not
the frozen input.

```ts
import { createStore, markRaw } from "solid-js";

class Counter {
  value = 0;
  get doubled() { return this.value * 2; }
  increment() { this.value++; }
}
const [state, setState] = createStore({ counter: new Counter() });
setState(draft => { draft.counter.increment(); });

const opaque = markRaw(new Counter()); // mark just this object
class NativeBackedCounter extends Counter {}
markRaw(NativeBackedCounter); // all instances of this class and its subclasses
```

Use `markRaw` before storing objects whose methods need the original receiver
(for example, a class using private fields). For raw data, replace the tracked
slot; internal mutations do not notify readers.

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

Read the inner collection through the wrapper: `For`/`mapArray` over `view.items`
and `Object.keys(view.items)` track its structure. `Object.keys(view)` tracks only
the outer keys, such as `items`; adding an inner item does not add an outer key.
Pass the collection as `<For each={view.items}>`; `mapArray` instead takes a
list accessor, `mapArray(() => view.items, mapItem)`.
`deep(view)` tracks the nested data too. Direct property reads track only their
corresponding fields. Inner adds/deletes/reconcile reach the consumers of that
inner structure. `snapshot(view)` reads current
inner data when called, but is untracked: a memo that only snapshots will not
rerun for inner writes. Preserve the inner proxy instead of cloning it.

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
`createSelector`, which is not exported in v2). For selection and prop-seeded
state, read [patterns](patterns.md).
