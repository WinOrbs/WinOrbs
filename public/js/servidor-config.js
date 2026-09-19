// ─────────────────────────────────────────────────────────────
// Configuración del SERVIDOR de juego (backend Node: server.js).
//
// ⚠️ ESTE ES EL ÚNICO ARCHIVO A TOCAR al cambiar de backend.
// Pega la URL pública del backend (SIN "/" final):
//   - VPS + Tailscale Funnel: https://mmgv-studio.tail96bd34.ts.net
//   - VPS + túnel Cloudflare: https://xxxxx.trycloudflare.com
//   - Render:                 https://winorbs-api.onrender.com
//
// OJO: los "quick tunnels" de trycloudflare.com CAMBIAN de URL cada vez que se
// reinicia cloudflared. La URL de Tailscale Funnel (*.ts.net) es FIJA, así que
// es la opción recomendada. Al cambiar de URL usa:  node cambiar-servidor.js
// (actualiza este archivo y el CORS_ORIGIN del .env de una sola vez).
//
// Déjalo VACÍO ("") para desarrollo local (mismo origen, localhost:3000).
// ─────────────────────────────────────────────────────────────
window.SERVIDOR_URL = "https://mmgv-studio.tail96bd34.ts.net";

