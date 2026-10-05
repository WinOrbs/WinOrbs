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

This package contains no game rules or persistence, transport, economy, or
administration integration.
