// ─────────────────────────────────────────────────────────────────────────────
// test_latencia.js — Diagnóstico de latencia (rendimiento, Fase 0).
//
// Responde a la pregunta: "¿el retraso que siento es de la RED o del JUEGO?".
// Mide cuatro capas por separado y emite un veredicto:
//   1) RED      : DNS, TCP, TLS y TTFB de /ping (HTTP)
//   2) HANDSHAKE: Socket.IO con polling (default) vs websocket forzado
//   3) CANAL    : RTT real del juego por el evento 'latProbe' (30 muestras,
//                 media/mediana/p95/jitter/pérdida)
//   4) PAYLOAD  : Hz y bytes/s de 'gameState' — cuánto de eso es geometría
//                 ESTÁTICA (lo que la Fase 2 quitará del tick)
//
// Uso:
//   node test_latencia.js                        (URL de public/js/servidor-config.js)
//   node test_latencia.js https://tu-url         (URL explícita)
//   node test_latencia.js --sala p05_1           (mide payload de esa sala)
//
// SEGURIDAD: por defecto NO se une a ninguna sala (solo lectura). Si se pasa
// --sala, se verifica antes que sea GRATIS (precioEntrada 0): el script se
// niega a entrar en salas de pago, y se desconecta al terminar.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const tls = require('tls');
try { require('dotenv').config(); } catch (e) { /* dotenv opcional */ }

// ── Argumentos ───────────────────────────────────────────────────────────────
const ARGS = process.argv.slice(2);
function valorFlag(nombres) {
    for (const n of nombres) {
        const i = ARGS.indexOf(n);
        if (i >= 0 && ARGS[i + 1]) return ARGS[i + 1];
    }
    return null;
}
const SALA = valorFlag(['--sala', '--room']);

function urlObjetivo() {
    const explicita = ARGS.find((a) => /^https?:\/\//.test(a));
    if (explicita) return explicita.replace(/\/+$/, '');
    try {
        const cfg = fs.readFileSync(path.join(__dirname, 'public/js/servidor-config.js'), 'utf8');
        const m = cfg.match(/window\.SERVIDOR_URL\s*=\s*"([^"]*)"/);
        if (m && m[1]) return m[1].replace(/\/+$/, '');
    } catch (e) { /* sin config: se usa local */ }
    // Sin URL configurada = mismo origen (desarrollo local, ver server.js).
    return 'http://localhost:' + (process.env.PORT || 3000);
}
const BASE = urlObjetivo();

// ── Estadística básica ───────────────────────────────────────────────────────
const limpios = (a) => a.filter((x) => Number.isFinite(x));
const media = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const mediana = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentil = (a, p) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
};
const sigma = (a) => {
    const m = media(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
};
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const stat = (a) => {
    const l = limpios(a);
    if (!l.length) return { n: 0, media: NaN, mediana: NaN, p95: NaN, jit: NaN, min: NaN, max: NaN };
    return {
        n: l.length,
        media: media(l),
        mediana: mediana(l),
        p95: percentil(l, 0.95),
        jit: sigma(l),
        min: Math.min(...l),
        max: Math.max(...l)
    };
};
const fila = (etiqueta, s) =>
    '  ' + etiqueta.padEnd(26) + 'media ' + f1(s.media).padStart(8) + ' ms   ' +
    'mediana ' + f1(s.mediana).padStart(8) + ' ms   ' +
    'p95 ' + f1(s.p95).padStart(8) + ' ms   ' +
    'jitter ' + f1(s.jit).padStart(6) + ' ms';

const b1 = (n) => Number(n).toFixed(1);
const t0 = () => process.hrtime.bigint();
const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6;

// ─ 1) RED: DNS ──────────────────────────────────────────────────────────────
async function medirDns(host, n = 5) {
    const r = [];
    for (let i = 0; i < n; i++) {
        const t = t0();
        try { await dns.promises.lookup(host); r.push(ms(t)); } catch (e) { r.push(NaN); }
    }
    return r;
}

// ── 1) RED: TCP + TLS (handshake de conexión, sin HTTP) ─────────────────────
function medirTlsUna(host, port) {
    return new Promise((res) => {
        const out = { tcp: NaN, tls: NaN, total: NaN };
        const t = t0();
        let tcp = null, hecho = false;
        const fin = () => { if (hecho) return; hecho = true; res(out); };
        let s;
        try {
            s = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
                out.tcp = tcp ? Number(tcp - t) / 1e6 : NaN;
                out.tls = Number(process.hrtime.bigint() - (tcp || t)) / 1e6;
                out.total = ms(t);
                try { s.destroy(); } catch (e) { /* ya cerrado */ }
                fin();
            });
        } catch (e) { return fin(); }
        s.on('connect', () => { tcp = process.hrtime.bigint(); });
        s.on('error', fin);
        s.setTimeout(8000, () => { try { s.destroy(); } catch (e) { } fin(); });
    });
}
async function medirTls(host, port, n = 5) {
    const tcp = [], tlsm = [], total = [];
    for (let i = 0; i < n; i++) {
        const r = await medirTlsUna(host, port);
        tcp.push(r.tcp); tlsm.push(r.tls); total.push(r.total);
    }
    return { tcp, tls: tlsm, total };
}

// ─ 1) RED: petición HTTP (TTFB y total), en frío y en caliente ─────────────
function httpUna(url, usarAgente) {
    return new Promise((res) => {
        const mod = url.startsWith('https:') ? require('https') : require('http');
        const t = t0();
        const req = mod.request(url, { method: 'GET', agent: usarAgente ? undefined : false }, (r) => {
            const ttfb = ms(t);
            r.resume();
            r.on('end', () => res({ ttfb, total: ms(t), code: r.statusCode }));
        });
        req.on('error', (e) => res({ ttfb: NaN, total: NaN, error: e.message }));
        req.setTimeout(10000, () => { req.destroy(); res({ ttfb: NaN, total: NaN, error: 'timeout' }); });
        req.end();
    });
}
async function medirHttp(url, n = 10) {
    const frio = await httpUna(url, false);          // conexión nueva (incluye DNS+TCP+TLS)
    const ttfb = [], total = [];
    for (let i = 0; i < n; i++) {
        const r = await httpUna(url, true);          // conexión reutilizada ≈ RTT puro
        ttfb.push(r.ttfb); total.push(r.total);
    }
    return { frio, ttfb, total };
}

// ── 2) HANDSHAKE de Socket.IO (polling vs websocket) ────────────────────────
function medirHandshake(url, opts = {}) {
    const { io } = require('socket.io-client');
    return new Promise((res) => {
        const t = t0();
        let hecho = false;
        const s = io(url, Object.assign({ reconnection: false, timeout: 10000 }, opts));
        const fin = (error) => {
            if (hecho) return;
            hecho = true;
            let transporte = '?';
            try { transporte = s.io.engine.transport.name; } catch (e) { /* sin engine */ }
            res({ ms: error ? NaN : ms(t), transporte, error, socket: s });
        };
        s.on('connect', () => fin(null));
        s.on('connect_error', (e) => fin(e.message));
    });
}

// ── 3) CANAL de juego: RTT por ack del evento 'latProbe' ────────────────────
function pingUnico(socket, esperaMs = 3000) {
    return new Promise((res) => {
        const t = t0();
        let hecho = false;
        const to = setTimeout(() => {
            if (hecho) return;
            hecho = true;
            res(NaN);   // pérdida (o servidor sin el probe)
        }, esperaMs);
        socket.emit('latProbe', Date.now(), () => {
            if (hecho) return;
            hecho = true;
            clearTimeout(to);
            res(ms(t));
        });
    });
}
async function medirPing(socket, n = 30) {
    const r = [];
    for (let i = 0; i < n; i++) {
        r.push(await pingUnico(socket));
        // Si las 3 primeras no responden, el servidor no tiene el probe: no
        // tiene sentido esperar 30 timeouts (90 s en una ruta lenta).
        if (r.length === 3 && r.every((x) => !Number.isFinite(x))) break;
    }
    return r;
}

// ── 4) PAYLOAD: Hz y bytes/s de 'gameState' ───────────────────────────────
// Geometría que NO cambia en cada tick (lo que la Fase 2 sacará del bucle).
const CLAVES_ESTATICAS = ['mapSize', 'obstacles', 'walls', 'speedPads', 'shopZones', 'bankZone'];
function medirGameState(socket, duracionMs = 5000) {
    return new Promise((res) => {
        let n = 0, bytes = 0, ultimo = null;
        const handler = (st) => {
            n++;
            try {
                bytes += Buffer.byteLength(JSON.stringify(st), 'utf8');
                ultimo = st;
            } catch (e) { /* estado no serializable: no se cuenta */ }
        };
        socket.on('gameState', handler);
        setTimeout(() => {
            socket.off('gameState', handler);
            let bytesEstaticos = 0;
            if (ultimo) {
                for (const k of CLAVES_ESTATICAS) {
                    if (ultimo[k] === undefined) continue;
                    try { bytesEstaticos += Buffer.byteLength(JSON.stringify({ [k]: ultimo[k] }), 'utf8'); } catch (e) { }
                }
            }
            res({ n, bytes, ultimo, bytesEstaticos, duracionMs });
        }, duracionMs);
    });
}
// ── Informe ─────────────────────────────────────────────────────────────────
async function main() {
    const u = new URL(BASE);
    const host = u.hostname;
    const puerto = u.port || (u.protocol === 'https:' ? 443 : 80);
    const esHttps = u.protocol === 'https:';

    console.log('\n═══ test_latencia.js — diagnóstico de latencia (Fase 0) ══');
    console.log('  objetivo : ' + BASE);
    console.log('  host     : ' + host + ':' + puerto + (esHttps ? ' (TLS)' : ' (sin TLS)'));
    console.log('  sala     : ' + (SALA ? SALA + ' (se verifica que sea GRATIS)' : 'ninguna (solo lectura)') + '\n');

    const d = stat(await medirDns(host, 5));
    console.log('── 1) RED — resolución y conexión');
    console.log(fila('DNS (dns.lookup)', d));

    if (esHttps) {
        const t = await medirTls(host, Number(puerto), 5);
        console.log(fila('TCP (SYN→connect)', stat(t.tcp)));
        console.log(fila('TLS (handshake)', stat(t.tls)));
    } else {
        console.log('  TCP/TLS            omitido (objetivo http://)');
    }

    const ping = await medirHttp(BASE + '/ping', 10);
    console.log(fila('/ping TTFB (caliente)', stat(ping.ttfb)));
    console.log(fila('/ping total (caliente)', stat(ping.total)));
    console.log('  /ping primera vez (frío)  ' + f1(ping.frio.total) + ' ms\n');

    const st = await medirHttp(BASE + '/status', 6);
    console.log(fila('/status TTFB (caliente)', stat(st.ttfb)));
    console.log('  (incluye una lectura real de Firestore por petición)\n');

    console.log('── 2) HANDSHAKE de Socket.IO (lo que tarda el juego en conectar)');
    const hp = await medirHandshake(BASE, {});                                   // default = polling
    console.log('  polling (default)        ' + f1(hp.ms).padStart(8) + ' ms   transporte final: ' + hp.transporte);
    const hw = await medirHandshake(BASE, { transports: ['websocket'] });         // forzado
    console.log('  websocket (forzado)      ' + f1(hw.ms).padStart(8) + ' ms   transporte final: ' + hw.transporte);
    if (Number.isFinite(hp.ms) && Number.isFinite(hw.ms)) {
        const ahorro = hp.ms - hw.ms;
        console.log('  → ahorro al forzar websocket: ' + f1(ahorro) + ' ms (' +
            (hp.ms > 0 ? Math.round(ahorro / hp.ms * 100) : 0) + '%)');
    }
    if (hp.socket && hp.socket.connected) hp.socket.disconnect();   // el de polling no se reutiliza

    const sock = hw.socket || hp.socket;
    if (!sock || !sock.connected) {
        console.log('\n✖ No se pudo abrir el canal Socket.IO: ' + (hw.error || hp.error || 'sin conexión'));
        console.log('  Revisa que el servidor esté arriba y el CORS_ORIGIN del .env.');
        process.exit(1);
    }

    console.log('\n── 3) CANAL de juego (RTT del propio socket, 30 muestras)');
    const rtts = await medirPing(sock, 30);
    const perdidos = rtts.filter((x) => !Number.isFinite(x)).length;
    const r = stat(rtts);
    console.log(fila('latProbe (RTT)', r));
    console.log('  min ' + f1(r.min) + ' ms · max ' + f1(r.max) + ' ms · pérdida ' +
        perdidos + '/' + rtts.length + ' (' + Math.round(perdidos / rtts.length * 100) + '%)');
    if (perdidos === rtts.length) {
        console.log('  ⚠️  100% de pérdida: el servidor NO tiene el probe latProbe todavía');
        console.log('     (se añadió en server.js; reinicia el backend para activarlo).');
    }
    console.log('\n── 4) PAYLOAD del tick (gameState)');
    if (!SALA) {
        console.log('  Omitido: sin --sala este script no entra en ninguna sala (solo lectura).');
        console.log('  Para medirlo:  node test_latencia.js --sala <id-de-una-sala-GRATIS>');
    } else {
        const salas = await pedirSalas();
        const info = (salas || []).find((s) => s.id === SALA);
        if (!info) {
            console.log('  ✖ No existe la sala "' + SALA + '" (revisa el id). No se mide.');
        } else if (Number(info.precioEntrada || 0) > 0) {
            console.log('  ✖ La sala "' + SALA + '" es de PAGO ($' + info.precioEntrada + '). No se entra.');
        } else {
            const resultado = await new Promise((res) => {
                const to = setTimeout(() => res('timeout'), 5000);
                sock.once('joinedSuccess', () => { clearTimeout(to); res(null); });
                sock.once('errorMsg', (m) => { clearTimeout(to); res(String(m)); });
                sock.emit('joinRoom', { roomId: SALA, password: '', nick: 'LatTest', skin: {} });
            });
            if (resultado) {
                console.log('  No se pudo entrar en la sala (' + resultado + '). No se mide.');
            } else {
                console.log('  Midiendo 5 s dentro de "' + SALA + '"…');
                const g = await medirGameState(sock, 5000);
                const seg = g.duracionMs / 1000;
                const hz = g.n / seg;
                const porEstado = g.n ? g.bytes / g.n : 0;
                const porSeg = g.bytes / seg;
                console.log('  estados recibidos        ' + g.n + ' en ' + seg + ' s  →  ' + f1(hz) + ' Hz');
                console.log('  tamaño medio por estado  ' + f1(porEstado / 1024) + ' KB');
                console.log('  ancho de banda           ' + f1(porSeg / 1024) + ' KB/s (' +
                    f1(porSeg * 8 / 1e6) + ' Mbps) por jugador');
                if (g.bytesEstaticos) {
                    const pct = Math.round(g.bytesEstaticos / (porEstado || 1) * 100);
                    console.log('  de eso, GEOMETRÍA FIJA   ' + f1(g.bytesEstaticos / 1024) + ' KB (' + pct +
                        '% de cada estado) → lo que quita la Fase 2');
                }
                sock.emit('leaveRoom');
                console.log('  (sala de prueba abandonada)');
            }
        }
    }

    console.log('\n── VEREDICTO');
    const p95 = r.p95;
    const jit = r.jit;
    if (!r.n) {
        console.log('  Sin muestras de RTT: no se puede juzgar (revisa el probe y la conexión).');
    } else if (p95 < 80 && jit < 25) {
        console.log('  RED SANA (p95 ' + f1(p95) + ' ms, jitter ' + f1(jit) + ' ms).');
        console.log('  → El retraso que sientes NO es de red: lo explica el diseño del juego');
        console.log('    (estado completo a 60 Hz + sin predicción local). Fase 1 y 2 lo reducen.');
    } else if (p95 < 150) {
        console.log('  RED ACEPTABLE (p95 ' + f1(p95) + ' ms, jitter ' + f1(jit) + ' ms).');
        console.log('  → La red aporta ~' + f1(p95) + ' ms perceptibles; el resto es del juego.');
    } else {
        console.log('  RED LENTA (p95 ' + f1(p95) + ' ms, jitter ' + f1(jit) + ' ms).');
        console.log('  → La ruta/túnel pesa de verdad: optimizar el payload ayuda, pero el');
        console.log('    retraso no desaparece hasta revisar la infra (Fase 4).');
    }
    console.log('\n  Referencia para la Fase 1: handshake con websocket forzado = ' +
        f1(hw.ms) + ' ms (objetivo < 500 ms).\n');

    try { sock.disconnect(); } catch (e) { /* ya cerrado */ }
    process.exit(0);
}

// Lista de salas en un socket desechable (el principal ya consumió la suya al
// conectar). Se usa solo para verificar que la sala de --sala sea GRATIS.
function pedirSalas() {
    const { io } = require('socket.io-client');
    return new Promise((res) => {
        const s = io(BASE, { transports: ['websocket'], reconnection: false, timeout: 8000 });
        const to = setTimeout(() => { try { s.disconnect(); } catch (e) { } res(null); }, 6000);
        s.on('roomsList', (l) => { clearTimeout(to); try { s.disconnect(); } catch (e) { } res(l); });
        s.on('connect_error', () => { clearTimeout(to); try { s.disconnect(); } catch (e) { } res(null); });
    });
}

main().catch((e) => {
    console.error('\n✖ Error en la medición: ' + (e && e.message ? e.message : e));
    process.exit(1);
});

