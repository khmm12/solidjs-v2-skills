# Server functions

Verified against solid-js@2.0.0-beta.21 / @solidjs/web@2.0.0-beta.21 (published
typings) and `next@2bf022eb` sources. Server functions are a core Solid 2.0
feature, not a metaframework add-on: any Vite app gets them, with or without a
router/Start.

## The directive is the whole compiler contract

```ts
export async function addTodo(title: string) {
  "use server";
  await db.insert(title);
  return reload({ revalidate: "todos" });
}
```

A function-level `"use server"` extracts that function to the server build and
replaces it with a fetch-backed reference on the client. A **module-level**
directive does the same for every export — but has one live compiler bug:
a wrapped export (`export const x = wrapper(async () => { "use server"; ... })`)
is silently **dropped** from the client build under a module-level directive —
only direct function exports become references. Function-level directives
don't have this problem (the wrapper call round-trips in both builds — see
`GET` below). Prefer the function-level directive when any export is wrapped.

**Privacy is dead-code elimination, not a runtime check.** The directive pass
removes the function body from client output and DCEs now-unused imports —
schema libraries, DB handles, secrets never reach the client bundle. This
means **the function body is the trust boundary**: whatever validation, auth
guard, or rate-limiting a call needs must be lines of code inside the body,
not in a wrapper. A wrapper wraps the *reference*, not the registered
function — `registerServerReference(id, fn)` registers the raw inner function
for HTTP dispatch *before* any wrapper runs, so wrapper-position code can only
affect the client transport, never HTTP dispatch:

```ts
export const getUser = GET(async (id: string) => {
  "use server"; // <- validate/guard here; GET() itself never sees the request
  if (typeof id !== "string") throw respond({ error: "bad id" }, { status: 400 });
  return db.users.find(id);
});
```

Arguments are **untrusted input** at the dispatch path regardless of the
TypeScript types on the reference — the codec reconstructs whatever shape an
attacker sends. There is no core/router validation helper (deliberately —
touches no privileged surface, so it's userland); check args in the body.

## Runtime split: `@solidjs/web/server-functions`

Two environment-specific entries, same subpath:

```ts
// client entry, once, only to deviate from defaults
import { configureServerFunctionsClient } from "@solidjs/web/server-functions";
configureServerFunctionsClient({ endpoint: "/_server" /* default */, codec, prepareRequest });

// server entry
import { configureServerFunctionsServer, handleServerFunctionRequest } from "@solidjs/web/server-functions/server";
configureServerFunctionsServer({ endpoint: "/_server", codec, provideEvent, collectFlightData });

import "virtual:solid-server-function-manifest";
if (url.pathname.startsWith("/_server")) {
  return handleServerFunctionRequest(request, {
    createEvent, provideEvent, transformResult, collectFlightData, handleNoJS, codec,
  });
}
```

`handleServerFunctionRequest` resolves the id, enforces the declared method
(405 on mismatch), decodes args, runs the function under a request-event
scope, encodes the result. Every hook is optional; the bare handler works
alone. `@solidjs/web/server-functions` (no `/server` or `/client` suffix)
resolves to whichever half matches the current build condition — pick the
explicit subpath only when you need one half's types outside its own build
(e.g. a universal integration file).

Inside a function body: `getRequestEvent()` (from `@solidjs/web`, same
signal as elsewhere in SSR) reads the current request; `getServerFunctionMeta()`
(from the server subpath) reads the calling function's own id — useful for
keying caches/logs. In-process SSR calls run the original function directly
(no HTTP loopback), under a derived event marked `serverOnly`.

## Response helpers — `respond`, `redirect`, `reload`

All three live on the core `@solidjs/web` entry, usable from server functions
*and* client-side actions — same object, same meaning both sides:

```ts
import { respond, redirect, reload, isResponseEnvelope } from "@solidjs/web";

async function login(formData: FormData) {
  "use server";
  if (formData.get("password") !== "hunter2") {
    return respond({ error: "bad credentials" }, { status: 401 });
  }
  return redirect("/dashboard", { revalidate: "session" });
}
```

- `respond(value, init?)` returns a `ResponseEnvelope<T>` — HTTP metadata
  (`status`, `headers`, `revalidate`) paired with an in-memory value. Scripted
  callers get `value` transparently (the transport unwraps it); the carried
  `Response` holds a real JSON body, so no-JS form posts / direct HTTP callers
  get plain JSON too — no reparse either way.
- `redirect(url, init?)` — default status 302.
- `reload(init?)` — empty response, just "revalidate these keys" (all when
  omitted).
- `init` on all three accepts `revalidate?: string | string[]` alongside the
  usual `ResponseInit` fields — opaque cache keys an integration (router)
  assigns meaning to via `X-Revalidate`.

**Check envelopes with `isResponseEnvelope(v)`, never `instanceof
ResponseEnvelope`** — it's a registered-symbol brand so it survives separately
bundled client/server copies of the class; `instanceof` can silently fail
across bundles.

## `GET`, `withMeta`, and the metadata channel

Three lifetime slots for what the old client-proxy surface conflated:
declaration-static (`GET`, `withMeta`), session-dynamic (`prepareRequest`),
call-scoped (nothing — both prior use cases moved elsewhere).

```ts
import { GET, withMeta, getServerFunctionMetadata, isServerFunction } from "@solidjs/web/server-functions";

export const getUser = withMeta(
  GET(async (id: string) => {
    "use server";
    return db.users.find(id);
  }),
  { requiresAuth: true } // arbitrary user-declared transport metadata
);

getServerFunctionMetadata(getUser)?.method === "GET"; // true
isServerFunction(getUser);                             // true
```

- `GET(fn)` declares a function callable over HTTP GET (args codec-encoded in
  the query string — cacheable by HTTP infra). Needs **no compiler support**:
  function-level directives round-trip the wrapper call, so
  `GET(async (...) => { "use server"; ... })` compiles by swapping only the
  inner function expression. Server-side the wrapper is identity-flavored
  (SSR stays in-process); the handler still enforces the method (405 on a
  non-GET call to a `GET`-declared function, and vice versa).
- `withMeta(fn, meta)` writes arbitrary metadata to the same channel `GET`
  uses; later writes shallow-merge over earlier ones, so it composes with
  `GET` in either order. It's the only public writer — without it,
  `prepareRequest`'s `meta` parameter would be unreachable for user
  declarations.
- `getServerFunctionMetadata(fn)` / `isServerFunction(fn)` detect structurally
  (registered-symbol brand) — correct across duplicated module instances and
  both sides of the directive boundary. Routers use these instead of property
  sniffing (`fn.GET` is gone).
- The reference itself exposes `id` (build-stable, stable across client/server
  builds) and `url` (for form `action`s / raw fetches) — both proxies, not
  just the client one.

**Removed, no compatibility shim:** `.GET` proxy getter, `.withOptions(init)`.
Session-dynamic uses go through `prepareRequest`; call-scoped uses (abort
signals, per-call single-flight opt-in) had no consumer left once
`subscribeFlightData` covers single-flight (below).

## `prepareRequest` — session-dynamic client transport hook

```ts
configureServerFunctionsClient({
  prepareRequest(init, { id, meta }) {
    if (meta?.requiresAuth) {
      return { ...init, headers: { ...init.headers, Authorization: `Bearer ${session.token()}` } };
    }
    return init;
  },
});
```

Runs before every outgoing server-function fetch; return the `RequestInit` the
transport will use. **One hook, not a chain** — compose in userland by
wrapping. The motivating case is rotating credentials (OAuth bearer tokens)
that apply uniformly to every call — declaration-time metadata is the wrong
tool for something session-dynamic, and this is the client-side symmetric of
the server handler hooks (`createEvent`/`transformResult`/`handleNoJS`).

## Single-flight — folding revalidation data into a mutation's response

Opt-in, not automatic-by-default: registering a consumer **is** the opt-in.

```ts
// client — anywhere, typically router/integration setup
import { subscribeFlightData } from "@solidjs/web/server-functions";

const unsubscribe = subscribeFlightData((data, { response }) => {
  // data: integration-produced payload; response: envelope metadata
  // (Location for redirect-with-data, X-Revalidate keys)
});

// server
configureServerFunctionsServer({
  collectFlightData(event, outcome) {
    // outcome: { id, value, response, request, thrown }
    return produceRouteData(outcome); // any codec-serializable value
  },
});
```

While a consumer is registered, the client transport sends the
`X-Single-Flight` request header on non-GET calls (GET reads stay plain and
cacheable); the server's `collectFlightData` hook then folds its payload into
the response as `{ value, data }`. With no consumer registered, no header is
sent and the server does no collection work — behavior is byte-identical to
without the feature. What `data` *is* (a data-only render, route preloads, a
cache query) is entirely the integration's business; core only standardizes
the wire shape and delivery.

## No-JS / progressive enhancement

A reference's `.url` doubles as a form `action`. The presence/absence of the
`X-Server-Function-Instance` header is how the server tells a scripted call
from an unscripted one (no-JS form post, direct HTTP) — unscripted calls get
their args parsed from FormData/query string instead of the codec, and get
routed through the `handleNoJS(result, request, args, thrown?)` handler hook
(default: the normal serialized response). Core's job stops at detection and
the hook; the flash-cookie convention and SSR submission-state seeding are a
router/Start concern, not core's.

## `RequestEvent` and request scoping

```ts
import { provideRequestEvent } from "@solidjs/web/storage"; // separate subpath: pulls in node:async_hooks

async function handler(request: Request) {
  return provideRequestEvent({ request, locals: {} }, () =>
    handleServerFunctionRequest(request)
  );
}
```

`provideRequestEvent` establishes the AsyncLocalStorage scope
`getRequestEvent()` reads from; server functions pick it up automatically as
their default event provider if nothing else establishes one. `RequestEvent`
is `{ request: Request; locals: Record<string | number | symbol, any> }` —
frameworks extend `locals` with their own shape.

## Footguns

- Validating in wrapper position (`withValidation(schema, fn)`-style) doesn't
  work — wrappers never reach the HTTP dispatch path (see the DCE/body-is-the-
  boundary section above). Validate at the top of the function body.
- Module-level `"use server"` on a file with any wrapped export
  (`GET(fn)`, `withMeta(fn, ...)`, or your own wrapper) silently drops that
  export from the client build. Use the function-level directive when
  wrapping.
- `instanceof ResponseEnvelope` can miss across separately bundled
  client/server entries — use `isResponseEnvelope()`.
- Single-flight data only flows once something calls `subscribeFlightData` —
  a router with no registered consumer gets plain responses, not a bug to
  chase.
