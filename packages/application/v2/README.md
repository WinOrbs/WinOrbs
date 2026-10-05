# Application Boundary v2

The application boundary accepts only principals minted by the injected
Identity service. It authorizes each player operation, checks that the supplied
session matches the authenticated session, derives the effective actor from
`principal.userId`, and delegates match work to an injected Match Coordinator.

Lifecycle operations are separate methods and require an operation-scoped
capability issued by Identity after a trusted system credential is verified.
They are not authorized by player roles or permissions. `finishMatch` in the
current Coordinator atomically locks the result; `lockResult` is the separately
authorized operation for reading/confirming that locked result.

`reassociatePlayerSession(request)` uses the existing `match.join` permission
and requires an Identity-minted, unexpired Principal whose user is already in
the restored match roster. The effective actor and replacement session come
only from that Principal; a caller-supplied actor mismatch is rejected. The
Coordinator accepts reassociation only for a restored instance. Replacing a
session does not add/remove a member, clear readiness, generate gameplay
events, or write session data to persistence. Repeating the same session is
idempotent; a new authenticated session for the same actor replaces the old
in-memory binding. A prior session can no longer submit commands.

This package contains no game rules or persistence, transport, economy, or
administration integration.
