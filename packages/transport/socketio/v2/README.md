# Socket.IO Transport v2

This adapter is a transport-only boundary:

```text
Socket.IO handshake -> Identity v2 -> socket-bound principal
Socket.IO event -> Application v2 -> Match Coordinator v2 -> Game Engine v2
```

Create it at the composition root with an existing Socket.IO server,
`IdentityService`, and `ApplicationBoundary`:

```js
createSocketIoTransport({ io, identity, application });
```

The adapter registers Socket.IO authentication middleware and connection
handlers. Authentication reads only `socket.handshake.auth.credential` and
calls `identity.authenticate({ credential })`. The resulting principal is
stored in a private `WeakMap`; identity, roles, and permissions in event
payloads are rejected and never used to construct the principal.

Supported client events are `match:join`, `match:leave`, `match:ready`,
`game:command`, `match:snapshot`, and `match:events`. Their payloads are
limited to an optional `matchId`, except `game:command`, which accepts
`{ matchId?, command }`. The complete command object is passed unchanged to
Application so its contract validation remains authoritative. Actor and
session values in that command must match the socket-bound principal.

Use Socket.IO acknowledgements for responses. If a client omits an
acknowledgement callback, the adapter emits `transport:response` with the event
name and the same structured response. Error messages are fixed, safe strings;
internal exceptions, stacks, credentials, and tokens are never returned.
Unsupported events are rejected, and recognized SYSTEM-operation event names
are explicitly denied. No client events are registered for `startCountdown`,
`startMatch`, `finishMatch`, or `lockResult`.

Disconnect only removes the socket-to-principal association. It does not call
Application or Coordinator and has no gameplay, economy, persistence, or
settlement side effects.

The module has no direct imports or runtime dependencies. It does not create
Express or Socket.IO servers, and must only be composed outside Identity,
Application, Coordinator, and Engine.
