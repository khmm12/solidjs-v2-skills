# TypeScript and project setup

## Packages and JSX

Use matching `solid-js`/`@solidjs/web` prereleases and a compatible compiler:
`@solidjs/babel-plugin` for Babel or `@solidjs/vite-plugin` for Vite
(default compiler: `@solidjs/compiler`).

```json
{ "compilerOptions": { "jsx": "preserve", "jsxImportSource": "@solidjs/web" } }
```

Import `createStore` and other reactive/store APIs from `solid-js`, and
`render`/`Portal` from `@solidjs/web`. Use `class` object/array props.
Renderer-neutral APIs/types come from `solid-js`; DOM APIs/types from `@solidjs/web`:

```ts
import type { Component, ParentComponent, VoidComponent, FlowComponent, Element } from "solid-js";
import type { JSX, ComponentProps } from "@solidjs/web";
type Wrapper = Component<{ children?: Element }>;
type ButtonProps = ComponentProps<"button">;
type ClickHandler = JSX.EventHandler<HTMLButtonElement, MouseEvent>;
```

`Element` is the renderer-neutral renderable type. DOM JSX lives in
`@solidjs/web/jsx-runtime`; hyperscript uses `@solidjs/h` (`jsx: "react-jsx"`),
HTML templates `@solidjs/html`, custom renderers `@solidjs/universal`.
`JSX.ClassValue` describes class object/array forms.

For `getRequestEvent().locals` types, augment `RequestEventLocals` using the
[request-scope declaration](server-functions.md#configuration-and-request-scope).

## DOM refs

Use the imported type for forwarded refs:

```ts
import type { JSX } from "@solidjs/web";
type ForwardedRef<T> = JSX.Ref<T>;
const refs: ForwardedRef<HTMLButtonElement> = [
  button => button.focus(),
  [button => button.setAttribute("data-ready", "true")]
];
```

Its recursive shape, expressed as a local alias:

```ts
type RefCallback<T> = (el: T) => void;
type Ref<T> = T | RefCallback<T> | undefined | Ref<T>[];
```

Use callbacks when composing arrays: `ref={[el => { button = el; }, focus]}`.
The compiler assigns a bare local only in a single `ref={button}`, not as an
array element. Library code can walk nested forwarded refs and pass each resolved
callback to `applyRef`; element values/`undefined` need no callback invocation:

```ts
import { applyRef } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
function applyForwardedRef<T extends Element>(ref: JSX.Ref<T>, element: T): void {
  if (Array.isArray(ref)) {
    for (const child of ref) applyForwardedRef(child, element);
  } else if (typeof ref === "function") {
    applyRef(node => ref(node), element);
  }
}
```

Published signature (DOM `Element`, separate from Solid's renderable type):

```ts
declare function applyRef<T extends Element = Element>(
  callbacks: ((element: NoInfer<T>) => void) | ((element: NoInfer<T>) => void)[],
  element: T
): void;
```

The element argument determines `T`; `NoInfer` keeps callback annotations from
widening it. `JSX.Ref` admits nested arrays; `applyRef`'s declared parameter is
a callback or a flat callback array. Follow the helper's parameter type.

## Context

```tsx
const TodosContext = createContext<TodosCtx>();
const todos = useContext(TodosContext);
<TodosContext value={createTodos()}>{props.children}</TodosContext>
```

The context itself is the provider component. Without a default, `useContext`
returns `T` and throws `ContextNotFoundError` for a missing provider.
Use it directly; a wrapper whose sole purpose is narrowing `T | undefined` is
redundant. `createContext(defaultValue)` supplies an explicit fallback.
Context scopes services/state to a subtree and supports per-request SSR isolation.

## Typechecks and reactive tests

- Generic value `createSignal<T>(initial)` can hit `Exclude<T, Function>`;
  `createSignal(() => initial)` selects the compute overload.
- Effect apply callbacks return cleanup or `undefined`; use braces for assignments.
- `createMemo`'s second argument is options; seed `prev` via a default parameter.
- Create test graphs in `createRoot`, retain/call disposal, and `flush()` before
  checking committed values. `await resolve(source)` waits for async settlement.
- Capture diagnostics through `OBSERVE?.diagnostics.capture()`; the dedicated harness
  is described in [reactivity](reactivity.md).
