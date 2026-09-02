# Server components (experimental preview)

Verified against solid-js@2.0.0-rc.5 / @solidjs/web@2.0.0-rc.5 published
typings/runtime and `solidjs/solid@5eb3250a` sources.

Server components are an **experimental preview outside Solid 2.0's stability
contract**, not a stable 2.0 API. They live under conditional
`@solidjs/web/frames`, with explicit `@solidjs/web/frames/client` and
`@solidjs/web/frames/server` subpaths for environment-specific code.

## A server component is a returned server function result

```tsx
// server function module
import type { Slot } from "@solidjs/web/frames/server";

export async function userCard(id: string) {
  "use server";
  const user = await db.users.find(id);
  return (props: { actions: Slot<{ compact?: boolean }> }) => (
    <article>
      <h2>{user.name}</h2>
      {props.actions({ compact: true })}
    </article>
  );
}

// client component
import { dynamic, hydrate } from "@solidjs/web";
import { installServerComponents } from "@solidjs/web/frames/client";
import { userCard } from "./user-card";

installServerComponents(); // before hydrate() or render()

function Page(props: { id: string }) {
  const UserCard = dynamic(() => userCard(props.id));
  return <UserCard actions={p => <button disabled={p.compact}>Edit</button>} />;
}

hydrate(() => <Page id="42" />, document.getElementById("app")!);
```

The server function's arguments are the server inputs. Props passed to the
returned component are client-owned slots/positions; they do not become
ordinary server data. Consume the promise of a component through
`dynamic(() => serverFn(...))`, which keeps a stable boundary across
refetches. Install the transport once before hydration or client rendering;
the package is side-effect-free, so a bare import is insufficient.

Enable compilation with `@solidjs/vite-plugin`:

```ts
solid({ serverFunctions: { components: true } })
```

The plugin wires endpoint frame responses automatically. Turnkey SSR also
wires document rendering/adoption; authored entries must install the frames
render/bootstrap/client pieces themselves.

## Stream and ownership model

The response is a frame-tagged HTML/chunk stream. New server-owned HTML is
morphed in place into its boundary rather than replacing the subtree;
client-owned slot ranges, their DOM identity, and client state survive server
updates. A slot's optional `$key` gives an occurrence stable identity across
reordering; positional identity is the default.

rc.5 keys a live frame by the delivered server-function address (function id
plus argument identity), so argument changes rebind the existing host instead
of colliding with another call. The frame stream also carries the typed SSR
`PreloadLink` descriptors registered by lazy/server-component assets, including
late root assets; the client preserves and applies those records. Both are
transport guarantees, not APIs for application components to drive manually.

Key public integration surfaces are intentionally small:

- client: `installServerComponents`, `createFrameHost`, `createFrameElement`,
  `applyFrameResponse`, `isFrameStreamResponse`, and the `Slot` type;
- server: `Slot`, `renderServerComponent`, `serverComponentResponse`,
  `frameTransformResult`, `frameTransformDirectResult`, and
  `frameTransformFlightResult`. Supply the last adapter as the server-function
  handler's `transformFlightResult` when framed single-flight outcomes can carry
  invalidated markup with the mutation envelope.

## Footguns

- This preview can change independently of stable Solid 2.0 APIs; pin matching
  `@solidjs/web` and `@solidjs/vite-plugin` prerelease versions.
- App context never crosses a server-component root. The component renders
  inline at document time but standalone on refetch/mutation responses, so
  reading an outer Provider would diverge. Default-less `useContext` throws an
  error explaining the boundary; defaulted contexts read their default.
  Providers created inside the server component work normally, as do the
  framework's Loading/Errored/reveal boundary contexts.
- The current boundary is a real `<solid-frame data-fid="…"
  style="display:contents">` custom element, not an invisible marker range.
  It is normally box/layout-transparent, but remains a real DOM node; account
  for that seam instead of assuming the server component adds no element.
- Call `installServerComponents()` explicitly and early. Installing after
  `hydrate()`/`render()` lets the first server-function response use the
  ordinary data decoder instead of the frame transport.
