# Server functions

Verified against solid-js@2.0.0-rc.8 / @solidjs/web@2.0.0-rc.8 published typings and solidjs/solid@f8b40b7e sources/tests.

Server functions are core Solid functionality. Use the Solid compiler/Vite
integration and mount the runtime handler; a router or SolidStart is optional.

## Directive and trust boundary

```ts
export async function getUser(id: string) {
  "use server";
  if (typeof id !== "string") throw respond({ error: "bad id" }, { status: 400 });
  return db.users.find(id);
}
```

Function-level `"use server"` registers the inner function for HTTP dispatch and
replaces it with a client reference. Put validation/auth inside that function:
an outer wrapper around the reference affects the caller, not HTTP dispatch.

Module-level `"use server"` registers each export's **evaluated value**. A userland
wrapper exported there is part of the registered server function and runs on
HTTP and direct calls. The client receives bare references; wrappers, schemas,
and server dependencies stay server-side. Exported values must be functions
(runtime registration checks this). Aliases and wrapped/default exports work.

The compiler removes server bodies and unused dependencies from client output.
Validate decoded arguments on the server regardless of TypeScript annotations;
keep any remaining client-used imports suitable for the client bundle.

## Configuration and request scope

```ts
// server entry
import { configureServerFunctionsServer, handleServerFunctionRequest } from "@solidjs/web/server-functions/server";
import "virtual:solid-server-function-manifest";
configureServerFunctionsServer({ endpoint: "/_server" });
// At the matching endpoint:
const response = await handleServerFunctionRequest(request);
```

The conditional `@solidjs/web/server-functions` entry selects client/server;
explicit `/client` and `/server` entries expose one environment's types.
The default endpoint is `/_server`. Handler hooks include `createEvent`,
`provideEvent`, `wrapInvocation`, `transformResult`, `collectFlightData`, `handleNoJS`.
`wrapInvocation` wraps server execution; integrations compose middleware there.

Same-origin CSRF checking is enabled by default. Requests missing origin evidence
are rejected unless `allowRequestsWithoutOriginCheck` is explicitly enabled.
Keep this protection, or supply an equivalent trusted layer. Argument payloads
are bounded by `bodySizeLimit` (1 MiB default) and `maxArguments` (1000 default).

`getRequestEvent()` from `@solidjs/web` returns `{ request, locals }`;
`getServerFunctionInvocation()` from the server-functions entry exposes `{ id }`.
Direct SSR calls execute in-process under a derived event marked `serverOnly`.
`provideRequestEvent` from `@solidjs/web/storage` establishes AsyncLocalStorage:

```ts
provideRequestEvent({ request, locals: {} }, () => handleServerFunctionRequest(request));
```

Augment locals in a declaration that is itself a module:

```ts
export {};
declare module "@solidjs/web" {
  interface RequestEventLocals { user: User; }
}
```

A global script-style ambient declaration replaces package types instead.

## Declaration, session, and call options

| Lifetime | API |
|---|---|
| Declaration | `GET(fn)`, `withMeta(fn, metadata)` |
| Session transport policy | `configureServerFunctionsClient({ prepareRequest })` |
| One invocation | `invoke(fn, { signal, keepalive, priority }, ...args)` |

```ts
import { GET, withMeta, invoke } from "@solidjs/web/server-functions";
export const getUser = withMeta(GET(async (id: string) => {
  "use server";
  return lookupAuthorizedUser(id);
}), { requiresAuth: true });
const user = await invoke(getUser, { signal: abort.signal }, id);
```

`GET` additionally permits GET and keeps POST accepted; an undeclared GET gets
405. `withMeta` shallow-merges metadata and composes with GET in either order.
These wrappers are runtime functions. A function-level `"use server"` transform
preserves the outer wrapper call; wrappers need no special compiler transform.
Read it with `getServerFunctionMetadata(fn)` / `isServerFunction(fn)`: their
registered-symbol brands work across bundles. References expose build-stable
`id` and `url` (forms/raw fetch). Use these APIs for method/metadata inspection;
`.GET`/`.withOptions` are absent.

`prepareRequest(init, { id, meta })` runs before each outgoing call and returns
its `RequestInit`. Compose one hook for rotating credentials and session policy;
use `new Headers(init.headers)` when adding headers to preserve every HeadersInit
shape. Client `fetch(address, init)` can replace the transport.

`invoke` accepts only `signal`, `keepalive`, and `priority` (`high`/`low`/`auto`).
Timeouts compose through `AbortSignal.timeout`/`any`; headers/method belong to
the longer-lived APIs above. Abort rejects with the signal's reason and cancels
the request. In-process server invocation still rejects the caller on abort;
transport hints have no effect there. Integration wrappers must deliberately
forward/adapt the invocation channel to support cancellation of shared work.

`live(fn)` declares a server async iterable as successive snapshots of a query.
It reconnects after post-connect failures with backoff; first-connect failures
reject. `break` cancels the request; `invoke`'s signal spans reconnects. Compose
as `live(GET(fn))`. A live source re-emits current state on each invocation and
uses ordinary reads, outside mutation single-flight delivery.

## Responses and errors

Import from `@solidjs/web`:

- `respond(value, init?)`: a `ResponseEnvelope` containing value and HTTP metadata;
  scripted transport unwraps the value, direct HTTP can read its JSON body.
- `redirect(url, init?)`: redirect envelope (302 default).
- `reload(init?)`: empty revalidation envelope.
- `init.revalidate`: a string or string array of integration-defined cache keys.
  Use `REVALIDATE_HEADER` for the header name.
- `isResponseEnvelope(value)`: cross-bundle structural brand check.

Production builds sanitize ordinary thrown errors to `Error("Internal Server Error")`;
dev builds preserve originals (build condition selects this policy).
Return/throw a response envelope for intentional client-facing outcomes, or use
`markSafeError(error)` and `isSafeError` for explicitly safe errors.
Thrown Response/ResponseEnvelope control flow retains its meaning.

## Encoding and integration hooks

Default argument lists are JSON-safe (finite numbers, strings, booleans, null,
arrays, plain objects), with a single native body such as FormData/File/Blob
also supported. Rich values (Date/Map/Set, typed arrays, cycles, undefined,
non-finite numbers, instances) require:

```ts
import { enableRichArguments } from "@solidjs/web/server-functions/rich-args";
enableRichArguments();
```

This installs `serializeArgs`; configuring `codec` alone supplies no rich
argument encoder. Custom wire integrations can provide `serializeArgs` directly.

Client `responseHandler.capture` synchronously captures call-site context;
`responseHandler.handle(response, { id, meta, args, context })` sees the response
before decoding. A non-undefined return becomes the result.
`decodeResponsePayload(response)` returns `{ value, flightData? }`.
Server `transformResult` handles transport outcomes; `transformDirectResult`
handles in-process ones. Per-request `transformResult` overrides server config.

## Single-flight

Client `subscribeFlightData((data, { response }) => ...)` registers a consumer
and returns an unsubscribe function. While registered, non-GET calls send
`X-Single-Flight`; server `collectFlightData(event, outcome)` supplies revalidation
data folded into that response. GET reads stay plain/cacheable. With no consumer,
the transport sends ordinary responses and performs no collection work.

`ServerFunctionOutcome` provides `id`, `value`, optional `response`, `request`,
`thrown`, `targetUrl`, `revalidateKeys`, `foldedHeaders`. Target URL is the same-origin
Location or referring page (absent for unusable/cross-origin targets); revalidation
keys are split; folded headers apply mutation Set-Cookie effects for follow-up reads.
Server `foldSetCookies(headers, setCookies)` exposes this nonmutating cookie fold.

## No-JS forms and flash

Use the reference's `.url` as a form action. Scripted calls carry
`X-Server-Function-Instance`; unscripted calls decode FormData/query input.
The built-in form convention applies to browser form navigation; scripted or
tagged direct HTTP calls retain their response protocol.
`createNoJSHandler` redirects ordinary outcomes with 303 to the
referer, falling back to configured base or `/`:

- Ordinary non-Response outcomes, including `0`, `false`, `""`, and `null`, are
  eligible for one-shot flash replay. `undefined` redirects without a flash.
- Response outcomes retain headers and a valid redirect status/Location;
  without Location they redirect back. They are outside flash serialization.

For flash, configure a deployment-wide high-entropy `secret` (at least 32 random
bytes, supplied from deployment secrets); the bundler-injected secret is the
fallback. Every serving instance needs the same secret. Flash is AES-GCM encrypted;
with no secret the redirect succeeds but the outcome is withheld. Invalid/tampered
cookies decode as no flash. Cookies use SameSite=Lax and Max-Age=60.

```ts
import { decodeFlashCookie } from "@solidjs/web/server-functions/server";
import { hasFlashCookie, clearFlashCookie } from "@solidjs/web/server-functions";
const cookie = request.headers.get("cookie");
const submission = await decodeFlashCookie(cookie);
if (hasFlashCookie(cookie)) response.headers.append("Set-Cookie", clearFlashCookie());
```

`encodeFlashCookie` is async too; `FLASH_COOKIE`, `hasFlashCookie`, `clearFlashCookie`
are isomorphic. Clear flash on the next render even when decode fails. The payload
has a roughly 4 KB ceiling: FormData/URLSearchParams become pairs, files are dropped,
and oversized outcomes may degrade to `truncated: true`; render that as a bounded
status instead of replaying the full result.

Use a custom `handleNoJS` for application-specific form handling. Per-request overrides take priority;
server config `handleNoJS: null` disables the convention and uses serialized responses.
