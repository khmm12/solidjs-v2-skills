---
name: solidjs-v2-reviewer
description: Review SolidJS 2.0 diffs or files for reactivity, async, DOM, and API correctness, including React and Solid 1.x assumptions. Applies to solid-js major 2; use solidjs-v2-migration for a requested 1.x conversion.
---

# Review SolidJS 2.0

Reference target: `solid-js@2.0.0-rc.8` and `@solidjs/web@2.0.0-rc.8`.

## Establish scope

Read the installed `solid-js` version and review the requested diff/files.
Apply this checklist to major 2. Keep v1 reviews on their v1 contract.
Published target typings outrank examples and prerelease documentation.

## Check behavior

| Area | Required v2 behavior |
|---|---|
| Component setup | Runs once per mount; reactive props remain `props.x` reads in JSX/compute |
| Props | JSX passes values through getters; accessor-typed APIs follow their declared types |
| Derived state | Memo/projection for readonly state; function-form signal/store for writable derivation |
| Writes/actions | Invoke in handlers, effect apply/error callbacks, or `onSettled`; computation scopes derive |
| Read-after-write | Microtask commit; imperative immediate reads follow `flush()` |
| Effects | Tracked compute + untracked apply; extract fields/deep snapshot in compute, return cleanup from apply |
| Paint | Both lanes run before paint; render lane measures/updates layout before user effects |
| Initial async | Async memo/store consumers sit under `Loading`; errors reach `Errored` with error accessor |
| Pending UI | Input changes or action-scoped `affects`; bare refresh is quiet; saving uses an optimistic flag |
| Mutation sequencing | Generator action yields work; after internal await, yield before writes; yield refresh for fresh truth |
| Live acknowledgment | `until` predicates read authoritative sources, use correlation and timeout |
| Cleanup | Register compute cleanup before await/yield; cancellation releases a parked stream |
| Lifecycle | Create primitives in setup; owned `onSettled` returns teardown, out-of-band callbacks are one-shot |
| Stores | Draft setters; returned values shallow-replace; reconcile's second argument is key/extractor/null |
| Store identity | Standalone reconcile preserves chosen root; derived returns can replace authoritative root |
| Shallow stores | Replace root slots by reference; preserve inner store proxies in live wrapper views |
| List callbacks | Identity: value/accessor; positional: accessor/number; custom key: accessor/accessor |
| Flow bodies | Accessor reads occur in JSX/compute; callback bodies build structure |
| DOM | Lowercase HTML attributes, class arrays/objects, callback refs; dynamic decisions inside event callbacks |
| SSR | Per-request user state; async data sources; lazy code holds shell, dynamic data follows boundary/options |
| Server validation | Function directive: body validates; module directive: exported wrapper value is registered |
| Transport | GET/withMeta for declarations, prepareRequest for session policy, invoke for per-call cancellation |

React's rerender/dependency-array model and Solid 1.x's synchronous writes,
single-callback effects, resource flags, and old import paths need semantic review.
Check a suspicious identifier against the actual import and installed type before
reporting it. A callback/accessor prop can be intentional; justify findings by
its consumer contract.

For v1 import/rename details, use the installed `solidjs-v2-migration` skill's map.
For detailed semantics, use the installed `solidjs-v2` skill and its task router.
If those companion skills are unavailable, verify against installed typings and
upstream sources. This checklist remains usable when installed alone.

## Report

Report only evidenced findings: severity, file/line, concrete failing behavior,
and smallest correct change. Separate runtime failures from dev diagnostics and
style choices. State which type/runtime checks ran and what remains unverified.
