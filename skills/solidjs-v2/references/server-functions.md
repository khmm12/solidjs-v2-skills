# Server functions

Verified against solid-js@2.0.0-rc.5 / @solidjs/web@2.0.0-rc.5 published
typings/runtime and `solidjs/solid@5eb3250a` sources/tests. Server functions are
a core Solid 2.0 feature, not a metaframework add-on: any Vite app gets them,
with or without a router/Start.

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
directive registers each export's evaluated terminal value on the server and
emits a bare reference on the client. This means a server-only wrapper really
does wrap both HTTP dispatch and direct SSR calls:

```ts
"use server";
export const getUser = withValidation(userIdSchema, async id =>
  db.users.find(id)
);
```

The compiler does not inspect the initializer's shape. The terminal export must
evaluate to a function or module evaluation throws; anonymous default expressions
receive a synthesized binding. Wrapper/schema/helper code stays out of the client
bundle because the client gets only the bare reference. Plain aliases and
separate declaration/export remain valid.

**Privacy is dead-code elimination, not a runtime check.** The directive pass
removes the function body from client output and DCEs now-unused imports —
schema libraries, DB handles, secrets never reach the client bundle. This
means that for a **function-level** directive, the function body is the trust
boundary: whatever validation, auth guard, or rate-limiting a call needs must
be lines of code inside the body, not in an outer wrapper. That wrapper receives
the already-lowered reference, so it can affect client-side calling but not the
raw function registered for HTTP dispatch:

```ts
export const getUser = GET(async (id: string) => {
  "use server"; // <- function-level form: validate/guard inside this body
  if (typeof id !== "string") throw respond({ error: "bad id" }, { status: 400 });
  return db.users.find(id);
});
```

Arguments are **untrusted input** at the dispatch path regardless of the
TypeScript types on the reference — the codec reconstructs whatever shape an
attacker sends. There is no core/router validation helper. Check args in a
function-level body, or use a module-level server-only wrapper whose terminal
export is the wrapped function; do not confuse those two compilation shapes.

## Runtime split: `@solidjs/web/server-functions`

Two environment-specific entries, same subpath:

```ts
// client entry, once, only to deviate from defaults
import { configureServerFunctionsClient } from "@solidjs/web/server-functions";
configureServerFunctionsClient({ endpoint: "/_server" /* default */, codec, fetch, prepareRequest });

// server entry
import { configureServerFunctionsServer, handleServerFunctionRequest } from "@solidjs/web/server-functions/server";
configureServerFunctionsServer({
  endpoint: "/_server", codec, provideEvent, wrapInvocation, collectFlightData,
  bodySizeLimit: 1_048_576, maxArguments: 1_000,
});

import "virtual:solid-server-function-manifest";
if (url.pathname.startsWith("/_server")) {
  return handleServerFunctionRequest(request, {
    createEvent, provideEvent, transformResult, collectFlightData, handleNoJS, codec,
  });
}
```

`handleServerFunctionRequest` resolves the id, enforces the declared method,
decodes args, runs the function under a request-event scope, and encodes the
result. Every hook is optional; the bare handler works alone. Malformed
encodings get 400, an argument payload over the default 1 MiB gets 413, and
more than the default 1000 decoded arguments gets 400. Config and per-handler
options may change `bodySizeLimit`/`maxArguments`; `Infinity` removes a bound.

Same-origin protection is enabled by default through `csrf`; mutation requests
without `Sec-Fetch-Site`, `Origin`, or `Referer` are rejected unless
`allowRequestsWithoutOriginCheck` is explicitly enabled. Declared GET reads
skip the origin gate by default so shared caches remain usable — which makes
`GET()` a promise that the operation is safe to execute cross-origin with
ambient cookies. Use `csrf: { protectDeclaredReads: true }` when that cache
tradeoff is unwanted. Set `csrf: false` only behind another trusted layer.
`@solidjs/web/server-functions`
(no `/server` or `/client` suffix)
resolves to whichever half matches the current build condition — pick the
explicit subpath only when you need one half's types outside its own build
(e.g. a universal integration file).

Inside a function body: `getRequestEvent()` (from `@solidjs/web`, same signal
as elsewhere in SSR) reads the current request;
`getServerFunctionInvocation()` (from the server-functions entry) returns
`{ id }` for the current call — useful for keying caches/logs. In-process SSR
calls run the original function directly (no HTTP loopback), under a derived
event marked `serverOnly`.

For framework policy that must cover **both** HTTP dispatch and direct SSR,
configure `wrapInvocation(run, { id, args, event, request?, direct })`. The
invocation identity is already established; return `run()`'s result (replace it
only intentionally), and keep the direct path synchronous when `run()` is
synchronous. A per-handler `wrapInvocation` overrides the configured hook for
HTTP calls only. This is an integration/middleware seam, distinct from source
wrappers around a compiled export.

## Response helpers — `respond`, `redirect`, `reload`

All three live on the core `@solidjs/web` entry and are usable from server
functions *and* client-side actions:

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
- `redirect(url, init?)` returns a `Response` — default status 302.
- `reload(init?)` returns an empty `Response` that says "revalidate these keys"
  (all when omitted).
- `init` on all three accepts `revalidate?: string | string[]` alongside the
  usual `ResponseInit` fields — opaque cache keys an integration (router)
  assigns meaning to via `X-Revalidate`. Import the exact header name as
  `REVALIDATE_HEADER` from the root `@solidjs/web` entry.
- Redirect targets and composed revalidation header values are bounded at
  4096 characters. The helpers fail early and the transport also refuses an
  over-limit hand-built `Response`; values are never trimmed, because that
  would silently change a destination or invalidation set.

**Check a `respond()` envelope with `isResponseEnvelope(v)`, never `instanceof
ResponseEnvelope`** — it's a registered-symbol brand so it survives separately
bundled client/server copies of the class; `instanceof` can silently fail
across bundles. This helper does not classify the ordinary `Response` objects
returned by `redirect()` and `reload()`.

### Thrown errors are sanitized by default

Outside the `development` build condition, a plain thrown value reaches the
client as a generic `Error("Internal Server Error")`; messages, stacks, and own
properties are not leaked. Dev builds preserve the original error for DX.
This policy is selected by the package build variant, not `NODE_ENV`.
The same sanitizer walks errors nested in the returned async result graph;
putting an error in a Promise, stream, Map key, or getter is not a disclosure
escape hatch.

For intentionally client-facing errors, return/throw a `respond(...)` envelope
or brand an error with `markSafeError(error)` from `@solidjs/web`. Use
`isSafeError()` for the cross-bundle-safe check. Thrown `Response` and
`ResponseEnvelope` control flow is already intentional and stays intact.

rc.5 transports a plain thrown failure as an actual HTTP 500 plus the protocol
error tag. The client keys failure on that tag, not merely on `status >= 500`:
a **returned** `respond(value, { status: 500 })` still resolves `value`, while
an unrecognized foreign response at 400+ rejects. A 204/205/304 response may
carry only `null`/`undefined`; returning a value with a bodyless status is an
authoring error. If result encoding fails after the head commits, an in-band
terminal trailer rejects the call rather than silently decoding to `undefined`.

Scripted redirects retain their intended 301/302/303/307/308 status and absolute
HTTP(S) target in `X-Server-Function-Redirect`, while the wire response is masked
to 200 so `fetch` does not follow it as a data request. Use
`decodeRedirectHeaderValue` in an integration; do not infer redirect control
flow from the masked status or expect `Location` on that 200. A 304 passes
through. Published rc.5 still accepts an **untagged 2xx** response as
`undefined`; rejecting that malformed peer response is post-rc.5 behavior and
must not be promised by this target.

`JSONCodecOptions.serializeErrorStacks` defaults from runtime `NODE_ENV`, not
the package's build condition. A production artifact run with an unexpected
development environment can therefore serialize stacks for safe/structured
errors; security-sensitive server integrations should set
`codec: { serializeErrorStacks: false }` explicitly.

## Stable identity, URL addressing, `GET`, and metadata

Three lifetime slots for what the old client-proxy surface conflated:
declaration-static (`GET`, `withMeta`), session-dynamic (`prepareRequest`),
and call-scoped (`invoke`, below).

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

- `GET(fn)` additionally allows HTTP GET (args codec-encoded in the query
  string — cacheable by HTTP infra); it also accepts HEAD and does not disable
  POST. Every other method is 405. Needs **no
  compiler support**:
  function-level directives round-trip the wrapper call, so
  `GET(async (...) => { "use server"; ... })` compiles by swapping only the
  inner function expression. Server-side the wrapper is identity-flavored
  (SSR stays in-process); a GET call to a function without this declaration
  receives 405.
- Transport responses default to `Cache-Control: no-store` unless the author
  supplies a policy. A declared read may set `Cache-Control`/`ETag` for normal
  conditional HTTP. A manually scripted callable resolving a 304 receives
  `undefined` and a development warning — use browser/cache infrastructure,
  not `await fn()` itself, to consume conditional-cache semantics.
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

Function ids are identity-keyed in rc.5: `<name>-<hash(root-relative path)>`,
with an ordinal only when a descriptive name repeats in one file. Appending,
deleting, reordering, or editing a function body no longer shifts an existing
address; renaming/removing a function retires the id. An unknown well-formed id
returns 404 with `X-Server-Function-Unknown`; the client error carries
`unknownFunction: true`, which integrations can use to offer a version-skew
reload instead of retrying a mutation against the wrong code.

Addressing now separates response shapes:

- plain HTTP, forms, and `.url`: `<endpoint>/<id>`;
- scripted client transport: `<endpoint>/data/<id>`.

The URL alone determines the response shape; rc.5 removed the transitional
instance-header fallback at the bare address. `serverFunctionUrl(id,
boundArgs?)` builds a bare action URL with JSON-safe bound arguments;
`parseServerFunctionUrl(url)` recovers the id or returns `null`. A bare GET URL
whose query is not the reserved encoded `args` form supplies a single
`URLSearchParams` argument — the `<form method="get">` contract. If a declared
GET callable's encoded URL would exceed 2000 characters, its client transport
falls back to POST while preserving the declaration's read semantics.

**Removed, no compatibility shim:** `.GET` proxy getter, `.withOptions(init)`.
Session-dynamic uses go through `prepareRequest`; call-scoped fetch behavior
uses `invoke`, while single-flight remains subscription-driven (below).

### `invoke(fn, options, ...args)` — per-call transport controls

```ts
import { invoke } from "@solidjs/web/server-functions";

const user = await invoke(getUser, { signal, priority: "high" }, id);
await invoke(saveDraft, { keepalive: true }, draft);
```

`InvokeOptions` is exactly `{ signal?, keepalive?, priority? }`, where priority
is `"high" | "low" | "auto"`. Options are the required second argument to
`invoke`; call the function normally when there are none. Abort rejects and
cancels the client request (or ends a `live` iteration); `keepalive` and
`priority` map to fetch hints. In an in-process server call, the signal rejects
the caller but does not magically stop function work unless that work observes
its own cancellation; the transport hints are no-ops.

`GET` and `live` preserve the one-call/one-request invocation channel. A cache,
deduper, or multicast wrapper must deliberately forward/adapt it and decide what
one caller's abort means for shared work; otherwise `invoke` fails with a
directed error. Do not expose raw `RequestInit` as a per-call API.

### `live(fn)` — reconnecting value streams

`live(fn)` declares a server function whose async iterable is one logical read
source. On the client the call returns the iterable **synchronously**, not a
`Promise<AsyncIterable>`; first-connect failures reject the iteration, later
transient deaths reconnect with backoff, and breaking/aborting ends it. Optional
`onstatus("connected" | "reconnecting" | "closed", error?)` reports wire state.
Compose read metadata inside-out: `live(GET(fn))`. Live reads never participate
in single-flight mutation folding.

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

`configureServerFunctionsClient({ fetch })` replaces delivery for every request
the runtime chooses to send. It receives `(address, init)`, where `address` is
document-relative, and must return the peer's unread `Response`. Forward `init`
unchanged enough to preserve the call's signal/keepalive/priority, and keep the
request same-origin. A retry wrapper may retry when it received **no response**;
never replay after a response ended or its body died mid-stream, because a
mutation may already have executed. Live reconnection belongs to the runtime.
Set `fetch: null` to restore global `fetch`.

## Transport integration seams and argument encoding

The client config also exposes two lower-level integration seams:

```ts
configureServerFunctionsClient({
  responseHandler: {
    capture: ({ id, meta }) => captureOwner(), // synchronous, at the call site
    handle(response, { id, meta, args, context }) {
      return isSpecial(response) ? consumeSpecial(response, context) : undefined;
    },
  },
});
```

`responseHandler.handle` sees every response before normal decoding; a
non-`undefined` return becomes the call result. Its optional `capture` keeps
ambient call-site context available after the fetch. By default argument
lists must be JSON-safe (null, booleans, strings, finite numbers, arrays, and
plain/null-prototype objects), except that one `Blob`, `File`, `FormData`, or
other natively encoded body may be passed directly. `Date`, `Map`, `Set`,
typed arrays, cycles, `undefined`, non-finite numbers, and class instances
need the application-facing opt-in:

```ts
import { enableRichArguments } from "@solidjs/web/server-functions/rich-args";
enableRichArguments();
```

That entry installs the codec's write half as `serializeArgs`; importing it is
the bundle-level opt-in. `codec` alone does not ship the rich argument encoder.
Set `serializeArgs` directly only for a custom wire encoding.

On the server, `configureServerFunctionsServer` accepts server-wide
`transformResult`, `transformFlightResult`, `transformDirectResult`, and
`handleNoJS`; per-request `transformResult`/`transformFlightResult`/`handleNoJS`
options override their configured counterparts. `transformFlightResult` gets
first refusal on `{ value, data }` after collection (frames use it for markup),
whereas `transformDirectResult` mirrors result policy for in-process SSR.
`handleNoJS: null` is valid only in the server-wide config and disables the
built-in form convention. `decodeResponsePayload(response)` is the public
integration decoder that returns `{ value, flightData? }`, splitting a
single-flight payload without making integrations decode its wire shape.

## Single-flight — folding revalidation data into a mutation's response

Opt-in, not automatic-by-default: registering a consumer **is** the opt-in.

```ts
// client — anywhere, typically router/integration setup
import { subscribeFlightData } from "@solidjs/web/server-functions";

const unsubscribe = subscribeFlightData((data, { response }) => {
  // data: integration-produced payload; response: envelope metadata
  // (Location for redirect-with-data, X-Revalidate keys)
});

// named additive source (multiple integrations can coexist)
const unsubscribeCache = subscribeFlightData("cache", (slice, context) => {
  cache.hydrate(slice);
});

// server
import { registerFlightDataSource } from "@solidjs/web/server-functions/server";

configureServerFunctionsServer({
  collectFlightData(event, outcome) {
    // id, value, response, request, thrown;
    // plus targetUrl, revalidateKeys, foldedHeaders
    return produceRouteData(outcome); // any codec-serializable value
  },
});

const unregisterCache = registerFlightDataSource("cache", (event, outcome) =>
  collectCacheSlice(outcome)
);
```

While a consumer is registered, the client transport sends the
`X-Single-Flight` request header on non-GET calls (GET reads stay plain and
cacheable); the server's `collectFlightData` hook then folds its payload into
the response as `{ value, data }`. With no consumer registered, no header is
sent and the server does no collection work — behavior is byte-identical to
without the feature. What `data` *is* (a data-only render, route preloads, a
cache query) is entirely the integration's business; core only standardizes
the wire shape and delivery.

The one-argument subscriber/configured `collectFlightData` pair is the unnamed
channel (reserved wire key `"true"`). The two-argument
`subscribeFlightData(source, consumer)` and server-only
`registerFlightDataSource(source, hook)` create named additive channels.
Source ids must be nonempty, cannot contain a comma, and cannot be `"true"`.
The POST request names its subscribed sources; the response data is keyed by
source and each consumer receives only its slice. Consumers are awaited
sequentially before the mutation promise resolves. A collector failure omits
only that source (and is logged); it does not discard the mutation result or
the other sources. Single-flight never wraps GET/live reads.

`ServerFunctionOutcome` contains the complete call result: build-stable `id`,
caller-visible `value`, optional metadata `response`, original `request`, and
`thrown`. It also supplies pre-digested `targetUrl` (resolved outcome
`Location`, otherwise the referring page; absent for an unusable referer or a
cross-origin redirect), split `revalidateKeys`, and `foldedHeaders`, where
mutation `Set-Cookie` effects have been applied for post-mutation reads. For
custom collection, `foldSetCookies(headers, setCookies)` from the server entry
performs the same cookie folding without mutating its input.

## No-JS / progressive enhancement

A reference's `.url` is the **bare** address and doubles as a form `action`.
An actual browser form navigation (`Sec-Fetch-Mode: navigate`, or missing fetch
metadata for older browsers) gets the no-JS convention. A page script that
manually posts `FormData`/`URLSearchParams` to that bare URL is rejected with
400 **before the mutation runs**; call the reference or use its `/data/`
address and protocol instead. Other direct HTTP callers get the plain response
shape. The URL split, not presence/absence of an instance header, is the normal
shape boundary.

The built-in browser-form path uses `createNoJSHandler()`. Its runtime behavior is:

- a **truthy**, non-`Response` outcome that reaches the handler is stored in the
  one-shot `flash` cookie, then redirected to the request referer (or `base`/`/`
  when no usable referer exists) with 303;
- a falsy ordinary **returned** value (`0`, `false`, `""`, `null`, `undefined`)
  is not flashed because the handler uses a truthiness guard. A plain throw is
  sanitized first: production turns even a falsy unsafe throw into a truthy
  generic `Error`, which is flashed; development preserves the primitive, so a
  falsy primitive throw is not flashed there. Either way the handler redirects;
- a returned or thrown `Response` carries its own headers. Its `Location` is
  resolved against the app base and a valid redirect status is retained; with
  no `Location` it redirects back. A `Response` is never flashed.

A per-request `handleNoJS(result, request, args, thrown?)` overrides the
configured/default handler; server config can install a global custom handler
or use `null` to disable the convention and return the normal serialized
response. Install a custom handler when every falsy returned/thrown outcome
must survive no-JS replay consistently across build variants.

```ts
import {
  configureServerFunctionsServer, createNoJSHandler, decodeFlashCookie,
} from "@solidjs/web/server-functions/server";
import { hasFlashCookie, clearFlashCookie } from "@solidjs/web/server-functions";

configureServerFunctionsServer({
  handleNoJS: createNoJSHandler({ base: "/app" }),
});

export function consumeFlash(request: Request) {
  const cookie = request.headers.get("cookie");
  return {
    submission: decodeFlashCookie(cookie), // feed into the next SSR submission state
    clearCookie: hasFlashCookie(cookie) ? clearFlashCookie() : undefined,
  };
}
```

`FLASH_COOKIE`, `hasFlashCookie`, and `clearFlashCookie` are isomorphic exact
exports. `encodeFlashCookie`/`decodeFlashCookie` and `createNoJSHandler` are
server exports. Flash payloads are JSON in a roughly 4 KB cookie budget:
`FormData`/`URLSearchParams` become entry pairs and files are dropped. When an
outcome is too large, rc.5 degrades rather than losing the entire cookie: input
echo is dropped first, a string is reduced to a bounded prefix by repeated
halving, and a structured outcome reduces to the outcome flag. Decoded
`FlashSubmission` carries `truncated` when either a returned result or thrown
error was reduced; inspect `result` versus `error` before describing the call as
successful. Clear on the immediately following render
whether decoding succeeds or not; append the returned `clearCookie` value as
`Set-Cookie`.

Cookie helpers now accept `partitioned?: boolean` (CHIPS), which requires
`secure: true`. Development also rejects `__Host-`/`__Secure-` prefix
violations and `SameSite=None` or `Partitioned` without `Secure`, rather than
letting the browser silently discard an invalid authentication cookie.

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
is `{ request: Request; locals: RequestEventLocals }`. Type the permissive
locals bag through module augmentation:

```ts
declare module "@solidjs/web" {
  interface RequestEventLocals {
    user: User;
  }
}
```

Put the declaration in a module (`export {}` or a top-level import); a global
script-style `declare module` replaces the package declaration instead of
augmenting it.

## Footguns

- An outer wrapper around a **function-level** directive wraps the lowered
  reference and cannot validate HTTP dispatch; put the check in the body.
  A wrapper exported by a **module-level** `"use server"` file is different:
  its evaluated terminal function is registered whole and runs on HTTP + SSR.
- Every export from a module-level server file must evaluate to a function.
  Non-function terminal values fail loudly during module evaluation.
- `instanceof ResponseEnvelope` can miss across separately bundled
  client/server entries — use `isResponseEnvelope()`.
- Single-flight data only flows once something calls `subscribeFlightData` —
  a router with no registered consumer gets plain responses, not a bug to
  chase.
- `GET()` is a safety declaration, not merely a transport preference: the
  default origin gate skips it. Never put a mutation behind GET.
- A custom client `fetch` that drops `init` breaks abort/live teardown; one
  that retries after receiving a response can execute a mutation twice.
- Default client arguments are deliberately JSON-safe, not the full result
  codec. Call `enableRichArguments()` before passing rich values.
- A flash outcome is one-shot and cookie-sized; never use it for files or a
  large result, and never flash a `Response` yourself. The built-in path drops
  falsy outcomes; use a custom `handleNoJS` when
  those values carry meaning.
