// ─────────────────────────────────────────────────────────────
// Configuración del SERVIDOR de juego (backend Node: server.js).
//
// ⚠️ ESTE ES EL ÚNICO ARCHIVO A TOCAR al cambiar de backend.
// Pega la URL pública del backend (SIN "/" final):
//   - VPS + túnel Cloudflare: https://xxxxx.trycloudflare.com
//   - Render:                 https://winorbs-api.onrender.com
//
// OJO: los "quick tunnels" de trycloudflare.com cambian de URL cada vez
// que se reinicia cloudflared → si cambia, actualiza SOLO esta línea.
//
// Déjalo VACÍO ("") para desarrollo local (mismo origen, localhost:3000).
// ─────────────────────────────────────────────────────────────
window.SERVIDOR_URL = "https://texas-babies-colon-unexpected.trycloudflare.com";

