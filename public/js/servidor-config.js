// ─────────────────────────────────────────────────────────────
// Configuración del SERVIDOR de juego (backend Node: server.js).
//
// ⚠️ ESTE ES EL ÚNICO ARCHIVO A TOCAR al cambiar de backend.
// Pega la URL pública del backend (SIN "/" final):
//   - VPS + Tailscale Funnel: https://mmgv-studio.tail96bd34.ts.net
//   - VPS + túnel Cloudflare: https://xxxxx.trycloudflare.com
//   - Render:                 https://winorbs-api.onrender.com
//
// El backend de producción de WinOrbs está alojado en Render.
// No se usa Cloudflare Workers como backend del juego.
//
// Déjalo VACÍO ("") para desarrollo local (mismo origen, localhost:3000).
// ─────────────────────────────────────────────────────────────
window.SERVIDOR_URL = "https://winorbs-api.onrender.com";

