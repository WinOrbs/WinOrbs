# Identity v2

Identity v2 accepts an injected authentication adapter. The adapter verifies
an external credential and returns trusted `userId`, `provider`, `sessionId`,
and `expiresAt` values; client-supplied identity, roles, and permissions are
not used. A separate injected authorization resolver supplies roles and
permissions explicitly—roles do not imply permissions.

Only principal objects minted by the service instance are accepted by its
authorization methods. Sessions are checked at authentication time and again
for each authorization decision. Adapters and the clock are supplied by the
composition root; this package has no transport, identity-provider SDK, or
persistence dependency.

System operations use operation-scoped, one-time capabilities minted only
after the injected system credential verifier approves them. There is no
SYSTEM principal or public system-principal factory. System credentials must
remain private to trusted server-side composition code.
