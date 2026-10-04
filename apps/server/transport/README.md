# WinOrbs 2.0 — Transport Boundary

Socket.IO is transport only. Incoming gameplay events must be normalized and validated before reaching domain modules.

Migration rule: preserve legacy event names while moving validation and authorization out of the monolithic server.
