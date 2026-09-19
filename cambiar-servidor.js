// ─────────────────────────────────────────────────────────────
// cambiar-servidor.js — Actualiza de golpe la URL del backend.
//
// Los "quick tunnels" de Cloudflare (trycloudflare.com) cambian de URL cada
// vez que se reinicia cloudflared. Ese cambio afecta a DOS sitios:
//   1) public/js/servidor-config.js → window.SERVIDOR_URL (lo usa el frontend)
//   2) .env                         → CORS_ORIGIN (orígenes que acepta server.js)
// Olvidar el segundo provoca el error de CORS en el handshake de Socket.IO.
// Este script reescribe ambos a la vez.
//
// Uso:
//   node cambiar-servidor.js https://nueva-url.trycloudflare.com
//   node cambiar-servidor.js ""     # volver a local (mismo origen)
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const CONFIG = path.join(__dirname, 'public/js/servidor-config.js');
const ENV = path.join(__dirname, '.env');
const CORS_BASE = 'https://winorbs.pages.dev'; // frontend en Cloudflare Pages

function salir(msg) { console.error(msg); process.exit(1); }

const arg = process.argv[2];
if (arg === undefined) {
    salir('Falta la URL.\n' +
        '  Uso: node cambiar-servidor.js https://xxxxx.trycloudflare.com\n' +
        '       node cambiar-servidor.js ""   (local / mismo origen)');
}

// Sin "/" final (el cliente Socket.IO lo exige) y sin "#" (rompería el .env).
let url = String(arg).trim().replace(/\/+$/, '');
if (url === 'undefined' || url === 'null') url = '';
if (url && !/^https?:\/\/[^\s#]+$/.test(url)) {
    salir('URL no válida (debe empezar por http:// o https:// y no llevar "#"): ' + arg);
}

// ── 1) Frontend ──────────────────────────────────────────────
// OJO: primero se comprueba que el patrón EXISTE. Si se usara solo
// `nuevaCfg === cfg` como señal de error, un reemplazo que produce el mismo
// texto (la URL ya era esa) se confundiría con "no encontré la línea".
const cfg = fs.readFileSync(CONFIG, 'utf8');
const RE_CFG = /window\.SERVIDOR_URL\s*=\s*"[^"]*";/;
if (!RE_CFG.test(cfg)) salir('No encontré la línea window.SERVIDOR_URL en ' + CONFIG);
const nuevaCfg = cfg.replace(RE_CFG, 'window.SERVIDOR_URL = "' + url + '";');
const cambioCfg = nuevaCfg !== cfg;
if (cambioCfg) fs.writeFileSync(CONFIG, nuevaCfg);

// ── 2) .env (solo si existe) ─────────────────────────────────
const origenes = [CORS_BASE].concat(url && url !== CORS_BASE ? [url] : []);
const lineaCors = 'CORS_ORIGIN=' + origenes.join(',');
const RE_CORS = /^CORS_ORIGIN=.*$/m;
const envExiste = fs.existsSync(ENV);
let cambioEnv = false;
if (envExiste) {
    const env = fs.readFileSync(ENV, 'utf8');
    const nuevaEnv = RE_CORS.test(env)
        ? env.replace(RE_CORS, lineaCors)
        : env.replace(/\s*$/, '\n') + '\n# Añadido por cambiar-servidor.js\n' + lineaCors + '\n';
    if (nuevaEnv !== env) { fs.writeFileSync(ENV, nuevaEnv); cambioEnv = true; }
}

// ── Resumen ──────────────────────────────────────────────────
console.log(cambioCfg
    ? '✔ public/js/servidor-config.js → ' + (url || '(vacío: local, mismo origen)')
    : '— public/js/servidor-config.js sin cambios (ya apuntaba a "' + url + '")');
if (!envExiste) {
    console.warn('⚠️  No hay .env en esta carpeta: actualiza CORS_ORIGIN en el .env del SERVIDOR a mano.');
} else {
    console.log(cambioEnv
        ? '✔ .env                          → ' + lineaCors
        : '— .env sin cambios (ya estaba en ' + lineaCors + ')');
}
console.log('\nPara que surta efecto:');
console.log('  1) git add public/js/servidor-config.js && git commit -m "chore(deploy): nueva URL del backend" && git push   (redespliega Pages)');
console.log('  2) Si el .env cambió: súbelo al servidor (scp) y reinicia el backend.');
console.log('  3) Comprueba:  curl -s ' + (url || 'http://localhost:3000') + '/status');
