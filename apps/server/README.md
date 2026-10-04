# WinOrbs 2.0 — Server

This directory is the new server boundary for the incremental migration from the legacy monolithic `server.js`.

Migration rule: extract one responsibility at a time, preserve behavior, add tests, then remove the legacy responsibility only after verification.

The legacy `server.js` remains untouched until each migrated boundary is proven.
