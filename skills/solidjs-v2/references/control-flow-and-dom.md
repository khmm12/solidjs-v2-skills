# Control flow and DOM

Verified against solid-js@2.0.0-rc.8 / @solidjs/web@2.0.0-rc.8 published typings and solidjs/solid@f8b40b7e sources/tests.

Control-flow components come from `solid-js`; `render`, `hydrate`, `Portal`,
`dynamic`, and `Dynamic` come from `@solidjs/web`.

## Lists

| `For` mode | Item | Index |
|---|---|---|
| default / `keyed={true}` (identity) | raw value | accessor |
| `keyed={false}` (position) | accessor | number |
| `keyed={row => row.id}` (custom key) | accessor | accessor |

```tsx
<For each={rows}>{(row, i) => <Row row={row} index={i()} />}</For>
<For each={rows} keyed={false}>{(row, i) => <Row row={row()} index={i} />}</For>
<For each={rows} keyed={row => row.id}>{row => <Row row={row()} />}</For>
```

Use a literal boolean or key function so the callback type stays definite.
Read accessors in JSX/memos/effect compute: the callback body is an owned setup
scope, and a top-level capture freezes the value. List identity comes from
`For`'s keying mode, rather than React's per-element `key` prop.

`Repeat` renders stable numeric slots without array diffing:

```tsx
<Repeat count={store.items.length} from={start()} fallback={<Empty />}>
  {i => <Row name={store.items[i].name} />}
</Repeat>
```

Its index is a plain number; store field reads supply reactivity.

## Conditional branches and boundaries

```tsx
<Show when={user()} fallback={<Login />}>{u => <Profile user={u()} />}</Show>
<Show when={user()} keyed>{u => <Profile user={u} />}</Show>
<Switch fallback={<Missing />}>
  <Match when={detail()} keyed>{d => <Detail data={d} />}</Match>
</Switch>
```

`Show`/`Match` function children receive a narrowed accessor by default, or the
raw narrowed value in keyed mode. Read through JSX/compute, as with lists.
`Loading` owns initial readiness; `Errored` owns errors with `(errorAccessor,
reset)` fallback. Read [async and actions](async-and-actions.md) for pending rules.

### Reveal

`Reveal` coordinates its direct boundary slots:

- `order="sequential"` (default): DOM order; `collapsed` hides later fallbacks.
- `order="together"`: release the group together.
- `order="natural"`: children settle independently.

Each `Loading`/`Errored` boundary severs ancestor coordination for its subtree.
Nested boundaries stay local; content streamed into a held slot queues until
that slot is released. A nested `Reveal` is one composite slot in a sequential/
together parent, then follows its own order. A natural parent activates nested
composites immediately. SSR `together`/`collapsed` use `renderToStream`;
synchronous `renderToString` supports natural and uncollapsed sequential.

## Dynamic and lazy components

```tsx
const Active = dynamic(() => editing() ? Editor : Viewer);
<Active value={value()} />
// Inline equivalent:
<Dynamic component={editing() ? Editor : Viewer} value={value()} />
```

The factory returns a stable component, shares source evaluation across instances,
and accepts async component sources. Imperative construction uses
`createComponent(dynamic(source), props)`.

### SSR shell timing

- Pending `dynamic()` under `Loading` emits the boundary fallback in the shell;
  its resolved component streams later.
- `dynamic(source, { deferStream: true })` holds the first shell until its source
  settles. The client ignores that option.
- A pending `lazy()` module always holds an open shell: its code must run to
  discover more async work. Async data found by that code still belongs to its
  nearest boundary. A lazy mounted after shell flush streams normally.
- An unbounded pending root hole holds the shell until content can render inline.

### Lazy hydration identity

```tsx
const About = lazy(() => import("./About"));
const Settings = lazy(() => import("./pages"), { export: "Settings" });
const moduleRef: string | undefined = About.moduleUrl;
```

`lazy(loader, options?, moduleUrl?)` comes from `solid-js`. Keep `options.export`
a call-site literal. The bundler normally supplies the third argument.
Hydration matches preloaded modules by positional hydration id, including
`import.meta.glob` callsites without that argument.

On the server, a missing callsite URL uses the module's injected `$$moduleUrl`
for deferred asset registration; `Lazy.moduleUrl` itself remains undefined.
If both identities are absent, SSR renders and warns about late client loading.
A supplied URL resolves through the request asset manifest, registering preload
hints; outside a request or on a manifest miss it stays the raw specifier.
`NoHydration` still renders lazy content; reading its resolved URL can preload
code for separately mounted islands.

## Attributes, classes, events

Use lowercase HTML attributes (`tabindex`, `readonly`) and camelCase handlers
(`onClick`). Boolean attributes use presence/absence. Stateful properties retain
platform forms: `value`, `defaultValue`, `checked`, `defaultChecked`, `selected`,
`defaultSelected`, `muted`, `defaultMuted`. Use defaults for initial field state.

```tsx
<div class={["card", props.class, { active: active() }]} />
<button onClick={event => (enabled() ? save : explain)(event)}>Save</button>
```

Class accepts strings, arrays, and objects. Event binding expressions are evaluated
once; put changing decisions inside a stable callback. Spread props reapply changed
handlers, which is a separate binding path.

Delegated listeners belong to render containers, including ShadowRoots; root
disposal removes them. Portal events bubble through the logical tree.
Native listener options belong in ref setup, with cleanup where its lifetime
requires removal (especially shared/external nodes).

## Refs and directives

Use callbacks, callback arrays (nesting allowed), or a factory returning a callback:

```ts
function titleDirective(source: () => string) {
  let node: HTMLElement | undefined;
  createEffect(source, title => { if (node) node.title = title; });
  return (el: HTMLElement) => { node = el; el.title = source(); };
}
```

Create reactive work in the factory's owned setup; apply DOM work in the returned
ref. Compose `ref={[el => { node = el; }, autofocus]}`; bare local assignment is
compiled only for a single `ref={node}`. See [TypeScript setup](typescript-setup.md)
for `JSX.Ref` and `applyRef`, and [reactivity](reactivity.md) for measurement timing.

`claimElementTree(root)` is renderer infrastructure for frames/routers/adopted
SSR ranges. It sweep-claims `a[href]` and `form[action]` descendants when DOM arrives
without compiled creation code; server export is a no-op. App code uses normal refs.

## Render and Portal

`render`/`hydrate` come from `@solidjs/web`; dispose via the returned root disposer.
`renderToString` is synchronous. For settled async HTML, use
`await renderToStream(code, options)` (`PromiseLike<string>`). Consume once through
await, `.pipe`, `.pipeTo`, or `.readable`; mixed consumers throw.
`renderToStringAsync` is absent from the published exports.

```tsx
import { renderToStream } from "@solidjs/web";
const html: string = await renderToStream(() => <App />);
```

The await already consumes this render and returns a string. Start a separate
render if another output needs a stream.

`Portal` is client-only: SSR skips its children, async work, and serialization.
Hydration renders the children fresh after settle. Hoist server-required reads
above it and put a local `Loading` inside for client-started data:

```tsx
<Portal mount={modalRoot}>
  <Loading fallback={<Spinner />}><Dialog /></Loading>
</Portal>
```

Already initialized ancestor boundaries treat this late work as ordinary pending;
the local boundary provides its initial fallback.
