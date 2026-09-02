# Stores: drafts, projections, helpers

Verified against solid-js@2.0.0-rc.5 / @solidjs/signals@2.0.0-rc.5 published
typings/runtime and `solidjs/solid@5eb3250a` sources/tests.
All store APIs are exported from `solid-js` (the `solid-js/store` subpath is gone).

## Draft-first setters (produce is the default)

```ts
const [store, setStore] = createStore({ user: { name: "A" }, list: [] });

setStore(s => {
  s.user.name = "B";
  s.list.push("x");
});
```

- Mutating the draft in place is the canonical form (1.x `produce` semantics,
  no import needed).
- **Returning a value** from the setter performs a shallow replacement: arrays
  replace by index + length, objects shallow-diff at the top level. Reach for
  it when mutation is awkward (filter/remove):
  `setStore(s => s.list.filter(x => x !== "x"))` — note: no keyed
  reconciliation here; that's a projection-fn/`reconcile` feature.
- 1.x path-style setters are gone; the opt-in compat helper is `storePath`:
  `setStore(storePath("user", "address", "city", "Paris"))`, supports ranges
  (`{ from, to, by }`), filter functions, and `storePath.DELETE`.
- `createMutable` / `modifyMutable` are gone — direct proxy mutation can't
  participate in batching, transitions, or optimistic rollback. Use
  `createStore` with draft setters.

## Store option surfaces

```ts
interface ProjectionOptions {
  name?: string;
  key?: string | ((item: any) => any) | null;
  shallow?: boolean;
}

createStore(initial, { name?: string, shallow?: boolean });
createStore(derive, seed, options?: ProjectionOptions);
createOptimisticStore(initial); // no options in solid-js client typings
createOptimisticStore(derive, seed, options?: ProjectionOptions);
```

`key` and `shallow` apply to projection reconciliation. The plain
`createStore(initial, options)` form accepts only `name` and `shallow`; it has
no keyed derive to configure. With the public `solid-js` client typings, plain
`createOptimisticStore(initial)` accepts no options, so shallow/options require
the derived form. This is an export-layer typing footgun: the underlying
`@solidjs/signals` root declaration has a plain options overload, but do not
teach that overload to code importing these APIs from `solid-js`.

## `reconcile(value, key)` — keyed or positional diffing

Published signature:

```ts
reconcile<T extends U, U>(
  value: T,
  key?: string | ((item: any) => any) | null
): (state: U) => void;
```

Returns a draft-setter function. Call it *inside* the setter, targeting the
part of the draft to reconcile (identity preserved for unchanged entries):

```ts
setStore(s => { reconcile(serverTodos)(s.todos); }); // omitted key = "id"
// or for the whole store:
setStore(reconcile(serverState, null)); // fully positional
```

`key` is a property name or extractor function; omission defaults to `"id"`.
Pass `null` for a fully positional merge. In keyed arrays an item missing the
chosen key still falls back to its position rather than becoming a keyed
entity. Symbol-keyed nodes are diffed too, not just string keys.

Two boundaries matter:

- If an array slot changes shape (array ↔ object), the slot is replaced; Solid
  never leaves an array proxy fronting an object or vice versa.
- Standalone `reconcile` is intentionally strict at the root selected by the
  caller: reconciling a different keyed root entity throws instead of silently
  changing what that slot represents. Projection return values use the
  authoritative-swap rule described below.

## Shallow stores — reactive root, raw records

`{ shallow: true }` makes only the root object properties or array slots
reactive. Nested records are returned raw and compared/replaced by reference;
mutating a field inside one is invisible to Solid. Replace the root slot:

```ts
const [rows, setRows] = createStore([{ id: 1, label: "old" }], {
  shallow: true
});

// Wrong: rows[0] is raw; no reactive slot changed.
setRows(draft => { draft[0].label = "new"; });
// Right: root slot replacement is reactive.
setRows(draft => { draft[0] = { ...draft[0], label: "new" }; });
```

`reconcile` respects the shallow boundary: it compares nested records by
reference and replaces changed root slots instead of recursively mutating the
raw records. If a server refresh rebuilds every row object, preserve DOM row
identity at the consumer with an explicit key:

```tsx
<For each={rows} keyed={row => row.id}>{row => <Row row={row} />}</For>
```

Use shallow mode only when records are immutable-by-convention. In-place
nested mutation is the central footgun.

## Derived stores: the memo/signal split, mirrored

| Signals | Stores |
|---|---|
| `createMemo(fn)` — readonly derived value | `createProjection(fn, seed, options?)` — readonly derived store |
| `createSignal(fn)` — writable derived value | `createStore(fn, seed, options?)` — writable derived store |

The derive function receives a **draft** it can mutate. If it **returns** a
value (sync or async — Promise/AsyncIterable supported), that value is
**reconciled** into the output keyed by `options.key` (default `"id"`; use
`null` for positional reconciliation). A returned new root is authoritative:
`createProjection`, derived `createStore`, and derived
`createOptimisticStore` swap the root entity and discard its descendants when
the root identity/shape changes. This differs deliberately from standalone
`reconcile`, where the caller-selected different root entity is an error.
`seed` is the real backing host object/array — an explicit seed, not a
memo-style "initial value".

```ts
// Selection without notifying every row (replaces createSelector)
const [selectedId, setSelectedId] = createSignal("a");
const selected = createProjection(s => {
  const id = selectedId();
  s[id] = true;
  if (s._prev != null) delete s[s._prev];
  s._prev = id;
}, {});

// Async derived collection, reconciled by key — refreshable via refresh(users)
const users = createProjection(async () => api.listUsers(), [], { key: "id" });

// Writable derived store: reactively derived + imperative writes
const [cache, setCache] = createStore(draft => { draft.x = compute(); }, { x: 0 });
setCache(s => { s.override = true; });
```

Do not catch readiness inside a derive. Reading another pending async source
throws `NotReadyError`; that throw is the subscription/retry signal, especially
during SSR where there is no persistent client subscription graph. A broad
`try/catch` that returns the partially mutated draft can make the server commit
an incomplete projection and never retry it. Let `NotReadyError` propagate (or
rethrow it if a narrow catch must handle some other error); use `isPending` at a
consumer boundary to present readiness rather than swallowing the derive read.

Under active optimism, a derived store's source/derive draft reads
**authoritative** state, not the caller's optimistic overlay. Fresh source
landings fold into the retaining transaction and reveal atomically at settle;
ordinary readers keep the committed view, while authoritative readers such as
`latest(() => store.x)` and `until(() => store.x)` can see staged truth.
Projection recomputes driven by a held transition likewise remain isolated:
context-free readers see committed data until reveal; use
`latest(() => projection.x)` for the explicit speculative read. Do not merge
the caller's optimistic row into a source-authored draft by hand.

### Store-in-store views stay live

A derive may return a foreign store or include one in its returned root. That
does not turn it into a one-time snapshot: the chain stays live. Structural
consumers of the wrapper — `<For>`/`mapArray`, `Object.keys`, `snapshot`, and
`deep` — track through to the wrapped store. Adds/deletes and `reconcile()` on
the inner store therefore invalidate the outer view; direct property reads and
enumeration stay consistent:

```tsx
const [items] = createOptimisticStore(() => api.list(), []);
const [view] = createOptimisticStore<{ items: readonly Item[] }>(
  () => ({ items }),
  { items: [] }
);

<For each={view.items}>{item => <Row item={item} />}</For>
```

Structural tracking chains through the outer wrapper to the inner store:
reconcile/add/delete invalidates `<For>`/`mapArray`, `Object.keys`, `snapshot`,
and `deep`. Do not clone the inner store as a workaround; that discards its
fine-grained identity.

### Patch-driven lists are a compiler/runtime integration, not an app API

rc.5 can opt compiled member bindings and eligible keyed `<For>` consumers into
a patch channel so structural store updates drive the list directly. The
compiler option is `patchDriver?: boolean | string` and defaults to `false`.
Application code still writes ordinary store drafts/reconciles and renders an
ordinary `<For>`; do not call `patchableRaw`, `registerPatch`, `registerRowOps`,
`registerSlotPatch`, `rowProof`, `driveList`, or `installListDriver` by hand.
Those published exports are compiler/renderer integration seams, not general
store primitives.

Published rc.5 can drive ordinary, projection, and optimistic store arrays when
the compiler emits eligible patch-mode rows. Projection recomputes emit
reconcile-derived row/slot operations; optimistic families emit lane-timed
identity row operations and an identity resync on revert. Explicit custom-key
lists still decline to the classic path, and an engaged list can fall back if
its subject later leaves the proven contract. Shallow slot-patch registration
supports multiple driven consumers. Enabling the optimization must not change
application behavior; if it does, disable it and report a compiler/runtime bug
rather than coding against the patch protocol.

## Raw platform objects and class instances

Platform/native host objects (`Map`, `Date`, DOM nodes, `Headers`, and similar
branded built-ins) are raw by default. A store slot containing one is reactive
when reassigned, but mutating the object's internal state (`map.set(...)`,
`date.setTime(...)`) is not tracked:

```ts
const [state, setState] = createStore({ cache: new Map<string, number>() });
setState(s => { s.cache.set("a", 1); });             // internal mutation: inert
setState(s => { s.cache = new Map(s.cache).set("a", 1); }); // reactive slot swap
```

User-defined class instances remain wrappable (unless frozen), so do not infer
that every non-plain object is raw. `markRaw` exists only in store internals;
it is **not** a public `solid-js` root export. Do not import or teach it as an
application API—use shallow stores or reference replacement instead.

Function-form `createSignal` (the "writable memo") completes the picture:

```ts
const [value, setValue] = createSignal(() => props.initial);
// recompute on deps change; setValue writes like a normal signal
```

This is the replacement for `createComputed`-with-writeback, and the canonical
way to seed local state from a prop. (TS note: with a generic `T`, the plain
value overload can fail `Exclude<T, Function>` — the compute-fn overload
`createSignal(() => initial)` is the fix.)

## `snapshot` and `deep`

Both return **plain** (non-proxy) deep copies; they differ in tracking:

```ts
snapshot(store); // no subscription — serialization, interop, test assertions
deep(store);     // subscribes to EVERY nested property — use in an effect's
                 // compute phase to react to any nested change
```

`snapshot` replaces 1.x `unwrap` (the immutable internals mean unwrapping
proxies isn't sufficient; `snapshot` builds a distinct object graph, preserving
references where nothing changed).

- Both **read through an active optimistic override** on a
  `createOptimisticStore` — the optimistic value is THE value for every reader
  (same as the proxy traps; see async optimistic mask in
  `async-and-actions.md`).
- A deleted trailing slot (`delete arr[i]`) stays a hole: `length` is preserved
  and the hole serializes as `null` — the copy is not truncated.
- Enumerable symbol-keyed properties survive both `snapshot` and `deep`
  (top-level and nested), not just string keys.

## `merge` / `omit` (replace `mergeProps` / `splitProps`)

```ts
const merged = merge(defaults, props, overrides); // right-most wins, reactivity preserved
const rest = omit(props, "class", "style");       // vararg keys, proxy view (no copy)
```

Gotcha carried into every setter/merge: **`undefined` is a real value** — it
overrides, it does not mean "skip this key".

```ts
merge({ a: 1, b: 2 }, { b: undefined }).b; // undefined
```
