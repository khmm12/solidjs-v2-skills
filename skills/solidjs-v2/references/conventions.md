# Naming primitives

- `createX`: creates a fresh reactive primitive/resource for this calling scope.
  Examples: `createSignal`, `createMemo`, `createWindowSize`.
- `useX`: accesses an existing shared value. Examples: `useContext`, or a
  singleton variant of `createWindowSize` named `useWindowSize`.

Solid components perform setup once per mount. Choose the prefix by lifetime
rather than applying React's `useX` hook convention to every helper. A singleton
needs deliberate lifetime management and, for user data, SSR request isolation.
