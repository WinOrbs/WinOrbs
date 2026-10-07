# Server Configuration

## Overview

The production entry point loads `.env` through `apps/server/config/environment.js`, then imports the immutable configuration exported by `apps/server/config/index.js`. Environment parsing and validation live in `apps/server/config/env.js`; non-secret defaults are in `apps/server/config/defaults.js`.

`createConfig(env)` is a pure function used by tests and can be passed an explicit environment object. The runtime config is constructed once at startup. Invalid values produce errors naming the environment variable and expected form; values and credentials are never interpolated into validation errors.

## Runtime environments

`NODE_ENV` accepts `development`, `test`, or `production` (case-insensitive; defaults to `development`). Other values fail startup.

| Setting | Development | Test | Production |
|---|---|---|---|
| CORS when `CORS_ORIGIN` is unset | Allow all origins | Allow all origins | Startup fails |
| Explicit wildcard CORS | Allowed | Allowed | Rejected |
| Firebase service account absent | Economy disabled | Economy disabled | Economy disabled; paid workflows remain fail-closed |
| Admin password absent | Admin password authentication disabled | Admin password authentication disabled | Admin password authentication disabled |
| Server port | `3000` | `3000` | `3000` unless `PORT` is set |

The development/test wildcard keeps local use convenient. Production must name one or more explicit HTTP(S) origins and cannot use `*`. Production CORS origin entries must be origins only (no paths), separated by commas.

## Environment variables

| Variable | Validation and behavior |
|---|---|
| `NODE_ENV` | Optional; one of `development`, `test`, `production`. Defaults to `development`. |
| `PORT` | Optional integer from 1 to 65535. Defaults to `3000`. The process listens on `0.0.0.0`, preserving the current container/deployment behavior. |
| `CORS_ORIGIN` | Optional outside production. Comma-separated HTTP(S) origins. Required in production; empty or wildcard production configuration fails before server startup. |
| `TRUST_PROXY` | Optional `true`, `false`, or non-negative integer hop count. Defaults to `1`, preserving the current Express behavior. Configure to match the actual trusted proxy topology. |
| `PREMIOS_AUTO_MS` | Optional integer of at least 60000 milliseconds. Defaults to 120000. Invalid values fail startup instead of becoming an unintended rapid timer. |
| `ADMIN_PASSWORD` | Optional secret. There is no source-code fallback; without it, admin password authentication stays disabled. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Optional path used by Firebase Application Default Credentials. When set, it retains precedence over service-account JSON sources. |
| `FIREBASE_SERVICE_ACCOUNT_B64` | Optional Base64-encoded service-account JSON. Used when Application Default Credentials is not selected. |
| `FIREBASE_SERVICE_ACCOUNT` | Optional service-account JSON or a path to a service-account file. Existing local and `/etc/secrets` file fallbacks remain available. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Optional; Telegram notifications remain unavailable unless both are configured. Neither value is logged. |

Firebase is intentionally not a mandatory startup dependency: the existing runtime supports a safe, fail-closed mode when credentials are unavailable. In that mode, economy and paid-room settlement are disabled; there is no client-trusted fallback. A configured but unusable credential source also leaves economy disabled. Firebase initialization logs only generic failures and does not print credential values.

## Central defaults

`defaults.js` centralizes the server port/host and proxy default; CORS defaults; Firebase service-account fallback paths; per-IP socket and input-rate limits; the current admin-session, disconnect, shooting, bomb, reload, and state-emission timings; the prize-reconciliation interval; and Socket.IO recovery/CORS options. `PREMIOS_AUTO_MS` overrides only the reconciliation interval. Existing simulation/map timings and gameplay policy not listed here remain in `server.js` as domain tuning; they are intentionally not changed as part of configuration work.

The HTTP factory receives the validated proxy setting and origin policy. Socket.IO receives the centralized recovery duration, middleware behavior, CORS methods, and credentials setting. The Firebase initializer receives only the Firebase portion of the centralized configuration. Existing flat configuration exports (`isProduction`, `corsRaw`, `corsAllowAll`, `isOriginAllowed`, and `adminPassword`) remain available for compatibility.

## Testing

Run `npm run test:config` for deterministic configuration coverage. It checks development/test/production modes, required production CORS and startup failure, valid and invalid values, secret-free errors, origin decisions, proxy parsing, Firebase configuration mapping, central timing/limit defaults, and immutable configuration. `npm test` includes this target.
