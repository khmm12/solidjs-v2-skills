# TypeScript, JSX, imports, project setup

Verified against solid-js@2.0.0-beta.28 / @solidjs/web@2.0.0-beta.28 typings.

## Import paths

| 1.x | 2.0 |
|---|---|
| `solid-js/web` | `@solidjs/web` |
| `solid-js/store` | `solid-js` (store APIs are core exports) |
| `solid-js/h` | `@solidjs/h` |
| `solid-js/html` | `@solidjs/html` |
| `solid-js/universal` | `@solidjs/universal` |
| `solid-js/jsx-runtime` | `@solidjs/web/jsx-runtime` |

Upgrade `solid-js`, `@solidjs/web`, `babel-preset-solid` (and other
`@solidjs/*` packages) together — betas move in lockstep.

`@solidjs/web` also ships `./server-functions` (see
`references/server-functions.md`), `./storage`, and `./serialization`
subpaths for server-side concerns — not part of the renderer-neutral surface
above.

## tsconfig for web apps

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@solidjs/web"
  }
}
```

`solid-js` no longer owns JSX: no `JSX` namespace export, no
`solid-js/jsx-runtime`. Renderer packages own JSX types (`@solidjs/web` for
DOM, `@solidjs/h` for hyperscript with `"jsx": "react-jsx"`; custom renderers
ship their own `jsx-runtime` type entries).

## Where types come from

```ts
// Renderer-neutral (component libraries, shared code) — from solid-js
import type { Component, ParentComponent, VoidComponent, FlowComponent, Element } from "solid-js";
type Wrapper = Component<{ children?: Element }>;   // Element replaces "JSX.Element" here

// DOM-specific — from @solidjs/web
import type { JSX, ComponentProps } from "@solidjs/web";
type ButtonProps = ComponentProps<"button">;
type ClickHandler = JSX.EventHandler<HTMLButtonElement, MouseEvent>;
```

Rule of thumb: `Element` from `solid-js` for "anything renderable";
`JSX.*` from `@solidjs/web` only when you genuinely mean DOM JSX.
JSX helper types were reshaped in 2.0 (e.g. `JSX.ClassValue` for the
object/array `class` prop) — verify names against the installed typings
rather than 1.x memory.

## DOM ref typing and `applyRef`

`JSX.Ref<T>` is recursive and includes direct assignment, a callback, or nested
arrays of either shape:

```ts
type RefCallback<T> = (el: T) => void;
type Ref<T> = T | RefCallback<T> | Ref<T>[];
```

This is why `ref={[first, [second, third]]}` type-checks. Library code that has
resolved refs to invoke should use the renderer's `applyRef` helper. Its beta.28
client typing is:

```ts
declare function applyRef<T extends Element = Element>(
  callbacks:
    | ((element: NoInfer<T>) => void)
    | ((element: NoInfer<T>) => void)[],
  element: T
): void;
```

That block is the published declaration, not code to paste beside an import.
Application/library usage imports the real function:

```ts
import { applyRef } from "@solidjs/web";

applyRef<HTMLButtonElement>(button => button.focus(), buttonElement);
```

Here `Element` is the DOM type, not Solid's renderer-neutral renderable
`Element`. `NoInfer<T>` keeps callback parameter annotations from choosing or
widening `T`; the actual `element` argument determines the element subtype.
Do not call ref callbacks by hand or replace `applyRef` with React-style ref
object handling.

## Context typing

`createContext<T>()` (no default) is `Context<T>` — `useContext` returns `T`,
not `T | undefined`, and throws `ContextNotFoundError` without a Provider.

```tsx
const TodosContext = createContext<TodosCtx>();

// ❌ delete these 1.x wrappers — they only existed to narrow T | undefined
const useTodos = () => { const ctx = useContext(TodosContext); if (!ctx) throw ...; return ctx; };

// ✅ direct call
const [todos, { addTodo }] = useContext(TodosContext);

// Provider: the context IS the component
<TodosContext value={createTodos()}>{props.children}</TodosContext>
```

`createContext<T>(defaultValue)` keeps the fallback behavior — reserve for
primitive config (theme, locale). App-wide state doesn't need Context at all:
a module-scope signal/store *is* a global.

## Known typing traps (beta.21, unchanged in beta.28)

- `createSignal<T>(value)` with a generic `T` can fail the
  `Exclude<T, Function>` value overload — seed via the compute-fn overload:
  `createSignal(() => initial)`.
- Effects: the apply callback must return `(() => void) | undefined`;
  returning the value (e.g. arrow shorthand over an assignment) is a type
  **and** runtime error.
- `createMemo`'s second parameter is `MemoOptions`, not an initial value —
  1.x-style `createMemo(fn, 0)` is a type error.

## Testing setup

- Wrap reactive code in `createRoot(dispose => { ... })` — primitives without
  an owner leak and warn.
- `flush()` before asserting: `setCount(1); flush(); expect(count()).toBe(1)`.
- `await resolve(() => value())` to wait for async computations to settle.
- `DEV.diagnostics.capture()` to assert on dev diagnostics.
