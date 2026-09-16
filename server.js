// Carga variables de entorno desde .env (si existe) — debe ir primero
try { require('dotenv').config(); } catch (e) { /* dotenv no instalado: usar variables de entorno del sistema */ }

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const io = new Server(server, { cors: { origin: CORS_ORIGIN } });

app.use(express.static(__dirname + '/public'));

// Endpoint ligero para keep-alive externo (UptimeRobot / cron-job.org)
app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

const MAP_SIZE = 5000;
const rooms = {};

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// ── FIREBASE ADMIN (inflado/anticheat de dinero) ─────────────────────────────
// Modo ECONOMÍA ACTIVA: si hay clave de servicio (serviceAccountKey.json o
// GOOGLE_APPLICATION_CREDENTIALS), el SERVIDOR cobra entradas y paga premios con
// Admin SDK → inmune a hacks del cliente. El cliente YA NO puede subir su saldo.
// Modo DEGRADADO (sin clave): funciona con los parches de Fase 0 (premio por
// aprobación del admin). Genera la clave en Firebase Console → Configuración del
// proyecto → Cuentas de servicio → Generar clave privada → serviceAccountKey.json
// ─────────────────────────────────────────────────────────────────────────────
let firebaseAdmin = null;
let FIREBASE_DB = null;
let FIREBASE_ECONOMY = false;
try {
    firebaseAdmin = require('firebase-admin');
    // Busca la clave de servicio en varios sitios (local y Render):
    //  - GOOGLE_APPLICATION_CREDENTIALS: ruta estándar de Google
    //  - FIREBASE_SERVICE_ACCOUNT: ruta a un archivo O el contenido JSON inline
    //  - FIREBASE_SERVICE_ACCOUNT_B64: contenido JSON en Base64 (útil en Render)
    //  - __dirname/serviceAccountKey.json (local)
    //  - /etc/secrets/... (Render Secret Files: se montan ahí en runtime)
    const fs = require('fs');
    const CANDIDATOS = [
        process.env.FIREBASE_SERVICE_ACCOUNT,
        __dirname + '/serviceAccountKey.json',
        '/etc/secrets/serviceAccountKey.json'
    ].filter(Boolean);
    let sa = null;
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.applicationDefault() });
        sa = true;
    } else {
        if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
            try {
                sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'));
            } catch (e) {
                console.warn('[FIREBASE] FIREBASE_SERVICE_ACCOUNT_B64 presente pero no es Base64/JSON válido:', e.message);
            }
        } else if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_SERVICE_ACCOUNT.trim().startsWith('{')) {
            // Contenido JSON pegado inline como variable de entorno
            try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); }
            catch (e) { console.warn('[FIREBASE] FIREBASE_SERVICE_ACCOUNT es JSON inválido:', e.message); }
        }
        if (!sa && process.env.FIREBASE_SERVICE_ACCOUNT) {
            // Tolerante a comillas sobrantes añadidas por el panel del host
            let txt = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
            if (txt.length >= 2 && txt.startsWith('"') && txt.endsWith('"')) txt = txt.slice(1, -1);
            try {
                const parsed = JSON.parse(txt);
                if (parsed && typeof parsed === 'object' && parsed.client_email) {
                    sa = parsed;
                    console.log('[FIREBASE] Clave de servicio cargada desde FIREBASE_SERVICE_ACCOUNT (inline).');
                }
            } catch (e) { /* no es JSON inline; el loop de rutas ya lo habrá probado como archivo */ }
        }
        if (!sa) {
            for (const ruta of CANDIDATOS) {
                try {
                    if (!fs.existsSync(ruta)) continue;
                    sa = JSON.parse(fs.readFileSync(ruta, 'utf8'));
                    console.log('[FIREBASE] Clave de servicio cargada desde: ' + ruta);
                    break;
                } catch (e) {
                    console.warn('[FIREBASE] No se pudo usar la clave en ' + ruta + ':', e.message);
                }
            }
        }
        if (!sa) {
            // Último recurso: cualquier *.json en /etc/secrets que parezca una clave de servicio
            try {
                if (fs.existsSync('/etc/secrets')) {
                    const candidatos = fs.readdirSync('/etc/secrets').filter(f => f.endsWith('.json'));
                    for (const f of candidatos) {
                        try {
                            const txt = fs.readFileSync('/etc/secrets/' + f, 'utf8');
                            if (txt.includes('"private_key"') && txt.includes('"client_email"')) {
                                sa = JSON.parse(txt);
                                console.log('[FIREBASE] Clave de servicio detectada en /etc/secrets/' + f);
                                break;
                            }
                        } catch (e) { /* JSON ilegible/corrupto: probar el siguiente */ }
                    }
                }
            } catch (e) { /* sin permiso o sin dir: ignorar */ }
        }
        if (sa && typeof sa === 'object') {
            firebaseAdmin.initializeApp({
                credential: firebaseAdmin.credential.cert(sa),
                projectId: sa.project_id || undefined
            });
        }
    }
    if (sa) {
        FIREBASE_DB = firebaseAdmin.firestore();
        FIREBASE_ECONOMY = true;
        console.log('[FIREBASE] Modo economía SEGURA activado (Admin SDK). El servidor maneja entradas y premios.');
    } else {
        console.log('[FIREBASE] Sin clave de servicio (busqué en FIREBASE_SERVICE_ACCOUNT, /etc/secrets/ y ' + __dirname + '): modo DEGRADADO. Cobro/premio los gestiona el cliente (parches Fase 0).');
    }
} catch (e) {
    console.warn('[FIREBASE] firebase-admin no disponible:', e.message);
}

// Límites de seguridad
const MAX_SOCKETS_PER_IP = 3;          // en salas de pago
const INPUT_MIN_INTERVAL = 8;          // ms entre eventos playerInput
const SHOOT_COOLDOWN = { 1: 120, 2: 400 }; // ms por arma
const ITEM_COSTOS = { medkit: 30, shield: 50, bomb: 40, orbGun: 100 };

// ── RECARGA (tecla R) ────────────────────────────────────────────────────────
// Ya NO existe auto-recarga en el cliente: sin balas no se dispara hasta
// recargar. La recarga tarda RELOAD_TICKS (~2.5 s) y bloquea el disparo.
const RELOAD_TICKS = 150;           // ~2.5 s a 60 fps
const RECARGA_ORBES_COSTE = 25;     // gemas NO aseguradas por recargar el Lanza-Orbes
const ORBGUN_MAX_AMMO = 3;          // orbes por cargador del Lanza-Orbes
const PISTOLA_MAX_AMMO = 15;        // balas por cargador de la Pistola Base

// ── ZONA SEGURA (battle royale) ──────────────────────────────────────────────
// El mapa ENTERO es zona segura durante casi toda la partida: el círculo sólo se
// cierra en los ZONA_CIERRE_T segundos finales. ZONA_AVISO_T segundos antes de
// que arranque el cierre se MARCA en el mapa dónde caerá la zona final
// (zoneNext), para que dé tiempo a rotar como en cualquier battle royale.
// El radio inicial cubre la esquina del mapa (MAP_SIZE/2·√2 ≈ 3535), así nadie
// recibe daño de zona al arrancar. Cada fase indica el radio objetivo cuando
// quedan `t` segundos; entre fases el radio se interpola linealmente.
const ZONA_RADIO_INICIAL = Math.ceil(MAP_SIZE / 2 * 1.4142);
const ZONA_RADIO_FINAL = 280;
const ZONA_CIERRE_T = 40;           // s finales en los que la zona se cierra
const ZONA_AVISO_T = 70;            // s restantes cuando se marca la zona final
const ZONA_FASES = [
    { t: ZONA_CIERRE_T, r: ZONA_RADIO_INICIAL },
    { t: 30, r: 2600 },
    { t: 20, r: 1800 },
    { t: 10, r: 1000 },
    { t: 0,  r: ZONA_RADIO_FINAL }
];
const ZONA_DPS = [4, 8, 12, 16, 20]; // HP/s fuera de la zona, por fase de cierre
const ZONA_CIERRE_PX_S = 200;        // tope de cierre (px/s): el tramo más rápido pide ~94
// La zona cierra en LUGARES ALEATORIOS: cada fase elige un centro nuevo dentro
// del círculo anterior, de modo que la partida termina en un sitio distinto cada
// vez (antes era siempre el centro del mapa). El centro deriva además hacia su
// objetivo con un tope, para que el círculo se "desplace" y no dé saltos.
const ZONA_CENTRO_PX_S = 200;       // tope de deriva del centro (px/s): el pico pide ~66
const ZONA_MARGEN_CENTRO = 400;     // el centro nunca a menos de 400 px del borde
                                    // (≥ radio final 280: la zona final cae en el mapa)

// ── TIENDAS ITINERANTES ─────────────────────────────────────────────────────
// Antes eran 6 casetas fijas en esquinas y bordes: nadie las disputaba y el
// camping era trivial. Ahora son 3 casetas en puntos aleatorios DENTRO de la
// zona segura, que se reubican al agotar su vida (~15 s), con vidas iniciales
// desfasadas para que nunca salten todas a la vez.
const TIENDA_NUM = 3;
const TIENDA_RADIO = 80;
const TIENDA_VIDA_TICKS = 900;          // ~15 s a 60 fps
const TIENDA_DESFASES = [900, 600, 300]; // vida inicial por caseta (escalonada)
const TIENDA_MIN_BANCO = 400;           // distancia mínima al banco
const TIENDA_MIN_ENTRE = 500;           // separación mínima entre tiendas
const TIENDA_MARGEN_SOLIDO = 80;        // holgura frente a muros/obstáculos
const TIENDA_MARGEN_BORDE = 120;        // margen al borde del mapa
const TIENDA_MIN_JUGADOR = 250;         // no reubicar encima de un jugador vivo

// ── OBSTÁCULOS DESTRUCTIBLES ────────────────────────────────────────────────
// roca: solo las bombas la dañan y las balas la atraviesan (igual que antes).
// coche / moto / barril: bloquean balas (−6) y EXPLOTAN al destruirse; el barril
// prende en cadena a los que tenga cerca (cola con retardo, sin recursión).
const OBSTACULOS_TIPOS = {
    roca:   { radio: 0,   dano: 0,  hp: 30 },
    coche:  { radio: 150, dano: 45, hp: 36 },
    moto:   { radio: 100, dano: 25, hp: 18 },
    barril: { radio: 130, dano: 40, hp: 12 }
};
const BARRIL_CADENA_TICKS = 6;      // retardo de la reacción en cadena (~0,1 s)
const BARRIL_CADENA_RADIO = 40;     // margen extra de encendido entre explosivos
const COCHE_ORBES = 2;              // orbes que suelta un coche destruido
const COCHE_ORBE_VAL = 10;
const MOTO_TURBO_TICKS = 120;       // ~2 s de turbo ×1.9 al reventar una moto

// ─ BOTIQUINES Y BOTÍN DE AIRDROP ────────────────────────────────────────────
const KIT_VAL = 40;             // HP que cura un botiquín
const KIT_VIDA = 1800;          // ~30 s en el suelo
const KIT_MAX_MAPA = 6;         // tope de botiquines generados en el mapa
const KIT_INTERVALO = 12;       // s entre intentos de reposición
const KIT_SIEMBRA = 3;          // botiquines al arrancar la partida
const ORBGUN_VIDA = 1200;       // ~20 s para recoger el Lanza-Orbes soltado
const KIT_LOOT_PROB = 0.65;     // probabilidad de botiquín al abrir un airdrop
const ORBGUN_LOOT_PROB = 0.35;  // probabilidad de Lanza-Orbes al abrir un airdrop
const adminFailuresByIP = {};          // rate-limit del panel admin

if (ADMIN_PASSWORD === "admin123" && !process.env.ADMIN_PASSWORD) {
    console.warn('⚠️  ADMIN: usando la contraseña por defecto "admin123". Define ADMIN_PASSWORD como variable de entorno.');
}

async function telegramNotify(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' })
        });
    } catch (e) { console.error("Error Telegram Bot:", e.message); }
}

// Sanitización anti-XSS
function sanitizeNick(nick) {
    let n = String(nick || '').replace(/[<>&"'`]/g, '').replace(/[\x00-\x1F]/g, '').trim();
    n = Array.from(n).slice(0, 16).join('');
    return n || 'Mercenario';
}
function sanitizeSkin(skin) {
    const out = {};
    if (skin && typeof skin === 'object') {
        ['c1', 'c2', 'border'].forEach(k => {
            let v = String(skin[k] || '').replace(/[<>&"'`]/g, '').replace(/[\x00-\x1F]/g, '').trim().slice(0, 32);
            if (v) out[k] = v;
        });
        // URL de imagen (PNG/JPG/GIF) opcional para skins compradas.
        // OJO: este campo viaja en gameState a TODOS los jugadores ~60 veces por
        // segundo, así que se acota el peso REAL que ocupará en el paquete:
        // Socket.IO aplica encodeURIComponent al payload y los caracteres no-ASCII
        // y '%' se expanden ×3, de modo que 500 chars podían convertirse en ~1500
        // en cada frame. Se mide el peor caso (encodeURIComponent) y se descarta
        // la URL si excede el tope. La URL de Cloudinary (~100 chars) entra holgada.
        const url = String(skin.imagenUrl || '').trim();
        if (/^https:\/\/[^\s'"<>]{10,500}$/i.test(url) && encodeURIComponent(url).length <= 260) {
            out.imagenUrl = url;
        }
    }
    return Object.keys(out).length ? out : { c1: '#38bdf8', c2: '#0284c7', border: '#bae6fd' };
}


// ── Tienda de skins (compra server-side con Admin SDK) ──────────────────────
// Las 4 skins básicas son gratis y viajan hardcoded; las compradas se validan
// contra Firestore (skins + usuarios.skins_compradas) para que nadie pueda
// usar una skin de pago sin haberla comprado realmente.
const SKINS_BASICAS = {
    cielo: { c1: '#38bdf8', c2: '#0284c7', border: '#bae6fd' },
    fuego: { c1: '#f97316', c2: '#c2410c', border: '#ffedd5' },
    neon: { c1: '#a855f7', c2: '#6b21a8', border: '#f3e8ff' },
    esmeralda: { c1: '#22c55e', c2: '#15803d', border: '#dcfce7' }
};

function sanitizeHex(v, fallback) {
    const s = String(v || '').replace(/[<>&"'`]/g, '').replace(/[\x00-\x1F]/g, '').trim().slice(0, 32);
    return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : fallback;
}

const SKIN_FALLBACK = { nombre: 'cielo', ...SKINS_BASICAS.cielo };

// Devuelve la skin saneada si el cliente la posee (o es básica); si no, el básico
async function validarSkinCliente(skin, uid) {
    try {
        if (!skin || typeof skin !== 'object') return SKIN_FALLBACK;
        // Nombre normalizado: sin acentos y en minúsculas ('Neón' → 'neon',
        // 'Esmeralda' → 'esmeralda') para que las básicas coincidan siempre.
        const nombreRaw = String(skin.nombre || '').replace(/[<>&"'`]/g, '').trim().slice(0, 32);
        const nombre = nombreRaw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        if (SKINS_BASICAS[nombre]) return { nombre, ...SKINS_BASICAS[nombre] }; // gratis
        const id = String(skin.id || '').replace(/[^\w-]/g, '').slice(0, 64);
        // Skins básicas equipadas desde la Tienda viajan con id 'bas-*' (gratis y
        // sin Firestore: funcionan incluso en modo economía degradado)
        const basicaPorId = /^bas-(cielo|fuego|neon|esmeralda)$/.exec(id);
        if (basicaPorId) return { id, nombre: basicaPorId[1], ...SKINS_BASICAS[basicaPorId[1]] };
        if (!id || !FIREBASE_ECONOMY || !FIREBASE_DB) return SKIN_FALLBACK;
        const refSkin = FIREBASE_DB.collection('skins').doc(id);
        const refUser = FIREBASE_DB.collection('usuarios').doc(uid || '__nulo__');
        const [snapSkin, snapUser] = await Promise.all([refSkin.get(), refUser.get()]);
        if (!snapSkin.exists || !snapSkin.data().activo) return SKIN_FALLBACK;
        const d = snapSkin.data();
        const propietario = snapUser.exists && ((snapUser.data() || {}).skins_compradas || []).includes(id);
        if (!(Number(d.precio || 0) > 0) || propietario) {
            return {
                id,
                nombre: sanitizeNick(String(d.nombre || 'Skin')),
                c1: sanitizeHex(d.c1, '#38bdf8'),
                c2: sanitizeHex(d.c2, '#0284c7'),
                border: sanitizeHex(d.border, '#bae6fd'),
                imagenUrl: sanitizeSkin({ imagenUrl: d.imagenUrl }).imagenUrl || ''
            };
        }
        return SKIN_FALLBACK;
    } catch (e) {
        return SKIN_FALLBACK;
    }
}

// Compra de skin: transacción atómica (saldo, inventario y equipada)
async function servidorComprarSkin(uid, skinId) {
    if (!FIREBASE_ECONOMY || !FIREBASE_DB) return { ok: false, error: 'ECONOMY_OFF' };
    if (!uid) return { ok: false, error: 'NO_AUTH' };
    if (typeof skinId !== 'string' || !skinId || skinId.length > 128) return { ok: false, error: 'SKIN_INVALIDA' };
    try {
        return await FIREBASE_DB.runTransaction(async (t) => {
            const refU = FIREBASE_DB.collection('usuarios').doc(uid);
            const refS = FIREBASE_DB.collection('skins').doc(skinId);
            const [su, ss] = await Promise.all([t.get(refU), t.get(refS)]);
            if (!su.exists) return { ok: false, error: 'NO_PROFILE' };
            if (!ss.exists || !ss.data().activo) return { ok: false, error: 'SKIN_NO_DISPONIBLE' };
            const precio = Number(ss.data().precio || 0);
            const compradas = ((su.data() || {}).skins_compradas) || [];
            if (compradas.includes(skinId)) return { ok: false, error: 'YA_COMPRADA' };
            const saldo = Number((su.data() || {}).saldo || 0);
            if (saldo < precio) return { ok: false, error: 'SALDO_INSUFICIENTE' };
            const nuevoSaldo = +(saldo - precio).toFixed(2);
            t.update(refU, {
                saldo: nuevoSaldo,
                skins_compradas: firebaseAdmin.firestore.FieldValue.arrayUnion(skinId),
                skin_equipada: skinId
            });
            // Historial: compra de skin
            t.set(FIREBASE_DB.collection('movimientos').doc(), {
                usuarioId: uid, tipo: 'skin', monto: -precio,
                detalle: 'Compra de skin: ' + String(ss.data().nombre || skinId).slice(0, 40),
                refId: skinId,
                fecha: firebaseAdmin.firestore.FieldValue.serverTimestamp()
            });
            return { ok: true, saldo: nuevoSaldo, skin: { id: skinId, ...ss.data() } };
        });
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Utilidades Firestore del servidor (solo con Admin SDK) ────────────────────
async function servidorCobrarEntrada(uid, salaId, monto) {
    if (!FIREBASE_ECONOMY || !FIREBASE_DB || !uid || !(monto > 0)) return { ok: false, error: 'ECONOMY_OFF' };
    try {
        // Idempotencia ATÓMICA: documento con ID determinista por (uid, sala).
        // Dos joins concurrentes ejecutan la MISMA transacción → un solo cobro.
        return await FIREBASE_DB.runTransaction(async (t) => {
            const refP = FIREBASE_DB.collection('usuarios').doc(uid);
            const refEnt = FIREBASE_DB.collection('entradas').doc('ent_' + uid + '_' + salaId);
            const [snap, snapE] = await Promise.all([t.get(refP), t.get(refEnt)]);

            // Ya cobrada → reutilizar (sin doble cobro)
            if (snapE.exists && snapE.data().estado === 'cobrada') {
                return { ok: true, entradasId: refEnt.id, yaExistia: true };
            }
            if (!snap.exists) return { ok: false, error: 'NO_PROFILE' };
            const saldo = Number(snap.data().saldo || 0);
            if (saldo < monto) return { ok: false, error: 'SALDO_INSUFICIENTE' };

            t.update(refP, { saldo: +(saldo - monto).toFixed(2) });
            t.set(refEnt, {
                usuarioId: uid, salaId: salaId, monto: monto,
                estado: 'cobrada', fecha: firebaseAdmin.firestore.FieldValue.serverTimestamp()
            });
            // Historial de movimientos (últimos 10 en la wallet), atómico con el cobro
            t.set(FIREBASE_DB.collection('movimientos').doc(), {
                usuarioId: uid, tipo: 'entrada', monto: -monto,
                detalle: 'Entrada a la sala ' + salaId, refId: refEnt.id,
                fecha: firebaseAdmin.firestore.FieldValue.serverTimestamp()
            });
            return { ok: true, entradasId: refEnt.id };
        });
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function servidorReembolsar(uid, entradasId, monto) {
    if (!FIREBASE_ECONOMY || !FIREBASE_DB || !uid || !entradasId) return;
    try {
        await FIREBASE_DB.runTransaction(async (t) => {
            const refE = FIREBASE_DB.collection('entradas').doc(entradasId);
            const refU = FIREBASE_DB.collection('usuarios').doc(uid);
            const sE = await t.get(refE);
            if (!sE.exists) return;
            if (sE.data().estado === 'reembolsada') return; // ya reembolsado
            const sU = await t.get(refU);
            t.update(refE, {
                estado: 'reembolsada',
                reembolsadoEn: firebaseAdmin.firestore.FieldValue.serverTimestamp()
            });
            if (sU.exists) {
                const saldo = Number(sU.data().saldo || 0);
                t.update(refU, { saldo: +(saldo + Number(monto || 0)).toFixed(2) });
                // Historial: reembolso acreditado
                t.set(FIREBASE_DB.collection('movimientos').doc(), {
                    usuarioId: uid, tipo: 'reembolso', monto: +Number(monto || 0).toFixed(2),
                    detalle: 'Reembolso de entrada · sala ' + (sE.data().salaId || '—'),
                    refId: entradasId,
                    fecha: firebaseAdmin.firestore.FieldValue.serverTimestamp()
                });
            }
        });
    } catch (e) {
        console.warn('[FIREBASE] Reembolso fallido para ' + uid + ':', e.message);
    }
}

async function servidorPagarPremio(room, gameId, abandono = false) {
    if (!FIREBASE_ECONOMY || !FIREBASE_DB || !room || !gameId) return;
    try {
        const lb = room.getLeaderboard();
        const ganador = lb[0];
        // Con 1 solo jugador solo paga si es victoria por abandono (bote estático)
        if (!ganador || (lb.length < 2 && !abandono)) return; // partida sin ganador real
        // Bote ESTÁTICO fijado al arrancar la partida; el 20% va a la casa
        const pozo = +(room.pozoTotal || (lb.length * room.entryFee)).toFixed(2);
        if (!(pozo > 0)) return;
        const comision = +(pozo * 0.2).toFixed(2);
        const neto = +(pozo - comision).toFixed(2);
        const ganadorUid = ganador.uid || null;
        const ganadorNick = ganador.nick || '—';

        await FIREBASE_DB.runTransaction(async (t) => {
            const refP = FIREBASE_DB.collection('partidas').doc(gameId);
            const snap = await t.get(refP);
            if (snap.exists) return; // ya pagada (dedupe)
            t.set(refP, {
                gameId: gameId, salaId: room.id, pozo, comision, neto,
                jugadores: lb.length, precioEntrada: room.entryFee,
                ganadorUid: ganadorUid || '', ganadorNick,
                estado: ganadorUid ? 'pagada' : 'premio_pendiente_admin',
                comisionContabilizada: true,
                fecha: firebaseAdmin.firestore.FieldValue.serverTimestamp()
            });
            t.set(FIREBASE_DB.collection('metricas').doc('casa'),
                { comisionesAcumuladas: firebaseAdmin.firestore.FieldValue.increment(comision) },
                { merge: true });
            if (ganadorUid) {
                const refU = FIREBASE_DB.collection('usuarios').doc(ganadorUid);
                const sU = await t.get(refU);
                if (sU.exists) {
                    const saldo = Number(sU.data().saldo || 0);
                    t.update(refU, { saldo: +(saldo + neto).toFixed(2) });
                    // Historial: premio acreditado al disponible del ganador
                    t.set(FIREBASE_DB.collection('movimientos').doc(), {
                        usuarioId: ganadorUid, tipo: 'premio', monto: neto,
                        detalle: 'Premio de la partida ' + gameId + ' · sala ' + room.id,
                        refId: gameId,
                        fecha: firebaseAdmin.firestore.FieldValue.serverTimestamp()
                    });
                }
            }
        });

        if (ganadorUid) {
            telegramNotify(`🏆 <b>POZO PAGADO (servidor)</b>\nSala: ${room.name}\nGanador: ${ganadorNick}\nNeto: $${neto.toFixed(2)} USD\nComisión casa: $${comision.toFixed(2)} USD`);
        } else {
            telegramNotify(`⚠️ <b>PREMIO SIN UID</b> en partida ${gameId}. Requiere aprobación manual del admin.`);
        }
    } catch (e) {
        console.error('[FIREBASE] Error pagando premio:', e.message);
    }
}

// ── CONCILIACIÓN AUTOMÁTICA de Premios Pendientes ────────────────────────────
// Origen: ganador sin UID → partida 'premio_pendiente_admin' con solo apodo.
// Solo autoconcilia con UN ÚNICO match exacto de apodo. Pago transaccional
// idempotente; la comisión NO se duplica (flag comisionContabilizada).
async function servidorAcreditarPremioPendiente(gameId, uidDestino, opts = {}) {
    if (!FIREBASE_ECONOMY || !FIREBASE_DB || !gameId || !uidDestino) {
        return { ok: false, error: 'PARAMS' };
    }
    try {
        const res = await FIREBASE_DB.runTransaction(async (t) => {
            const refP = FIREBASE_DB.collection('partidas').doc(gameId);
            const snap = await t.get(refP);
            if (!snap.exists) return { ok: false, error: 'NO_EXISTE' };
            const p = snap.data() || {};
            if (p.estado === 'pagada') return { ok: false, error: 'YA_PAGADA' };
            if (p.estado !== 'premio_pendiente_admin') return { ok: false, error: 'ESTADO_INVALIDO' };
            const neto = Number(p.neto || 0);
            if (!(neto > 0)) return { ok: false, error: 'MONTO_INVALIDO' };
            const refU = FIREBASE_DB.collection('usuarios').doc(uidDestino);
            const sU = await t.get(refU);
            if (!sU.exists) return { ok: false, error: 'USUARIO_NO_EXISTE' };
            if (opts.exigirMatchApodo) {
                const apodo = String((sU.data() || {}).apodo || '').trim().toLowerCase();
                const nick = String(p.ganadorNick || '').trim().toLowerCase();
                if (!apodo || !nick || apodo !== nick) return { ok: false, error: 'APODO_NO_COINCIDE' };
            }
            const saldo = Number((sU.data() || {}).saldo || 0);
            t.update(refU, { saldo: +(saldo + neto).toFixed(2) });
            t.set(FIREBASE_DB.collection('movimientos').doc(), {
                usuarioId: uidDestino, tipo: 'premio', monto: +neto.toFixed(2),
                detalle: 'Premio conciliado (auto) · partida ' + gameId + (opts.manual ? ' · vinculado por admin' : ''),
                refId: gameId,
                fecha: firebaseAdmin.firestore.FieldValue.serverTimestamp()
            });
            // La comisión YA se contabilizó al crear la partida (servidorPagarPremio
            // siempre la suma, con o sin UID), así que aquí NUNCA se vuelve a sumar.
            // El flag comisionContabilizada queda como marca de auditoría.
            t.update(refP, {
                estado: 'pagada',
                ganadorUid: uidDestino,
                pagadoEn: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
                pagadoPorAdmin: !!opts.manual,
                conciliacionAuto: !opts.manual
            });
            return { ok: true, neto, ganadorNick: p.ganadorNick || '—' };
        });
        if (res && res.ok) {
            telegramNotify('🏆 <b>PREMIO CONCILIADO' + (opts.manual ? ' (manual UID)' : ' (auto)') + '</b>\nPartida: ' + gameId + '\nGanador: ' + res.ganadorNick + '\nNeto: $' + Number(res.neto).toFixed(2) + ' USD');
        }
        return res;
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function servidorBuscarUidPorApodo(nick) {
    const nombre = String(nick || '').trim();
    if (!nombre || !FIREBASE_DB) return { uids: [] };
    const snap = await FIREBASE_DB.collection('usuarios').where('apodo', '==', nombre).limit(5).get();
    return { uids: snap.docs.map((d) => d.id) };
}

async function servidorConciliarPremiosPendientes(origen) {
    if (!FIREBASE_ECONOMY || !FIREBASE_DB) return { ok: false, error: 'ECONOMY_OFF' };
    const resumen = { pagados: [], ambiguos: [], sinMatch: [], errores: [] };
    try {
        const snap = await FIREBASE_DB.collection('partidas').where('estado', '==', 'premio_pendiente_admin').limit(50).get();
        for (const d of snap.docs) {
            const p = d.data() || {};
            try {
                const found = await servidorBuscarUidPorApodo(p.ganadorNick);
                if (found.uids.length === 1) {
                    const r = await servidorAcreditarPremioPendiente(d.id, found.uids[0], { exigirMatchApodo: true });
                    if (r.ok) resumen.pagados.push({ gameId: d.id, uid: found.uids[0], neto: r.neto });
                    else if (r.error !== 'YA_PAGADA') resumen.errores.push({ gameId: d.id, error: r.error });
                } else if (found.uids.length === 0) {
                    resumen.sinMatch.push({ gameId: d.id, nick: p.ganadorNick || '—' });
                } else {
                    resumen.ambiguos.push({ gameId: d.id, nick: p.ganadorNick || '—', n: found.uids.length });
                }
            } catch (e) { resumen.errores.push({ gameId: d.id, error: e.message }); }
        }
        if (resumen.pagados.length > 0) console.log('[PREMIOS] Conciliacion (' + (origen || 'auto') + '): ' + resumen.pagados.length + ' pagados.');
        return Object.assign({ ok: true }, resumen);
    } catch (e) {
        return Object.assign({ ok: false, error: e.message }, resumen);
    }
}

async function servidorReclamarPremiosDeUsuario(uid) {
    if (!FIREBASE_ECONOMY || !FIREBASE_DB || !uid) return { ok: false, error: 'PARAMS' };
    try {
        const sU = await FIREBASE_DB.collection('usuarios').doc(uid).get();
        if (!sU.exists) return { ok: false, error: 'USUARIO_NO_EXISTE' };
        const apodo = String((sU.data() || {}).apodo || '').trim().toLowerCase();
        const snap = await FIREBASE_DB.collection('partidas').where('estado', '==', 'premio_pendiente_admin').limit(50).get();
        const acreditados = [];
        for (const d of snap.docs) {
            const p = d.data() || {};
            const porUid = String(p.ganadorUid || '') === uid;
            const porApodo = !!apodo && String(p.ganadorNick || '').trim().toLowerCase() === apodo;
            if (!porUid && !porApodo) continue;
            const r = await servidorAcreditarPremioPendiente(d.id, uid, { exigirMatchApodo: !porUid });
            if (r.ok) acreditados.push({ gameId: d.id, neto: r.neto });
        }
        return { ok: true, acreditados };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

const CONCILIAR_CADA_MS = Math.max(60000, Number(process.env.PREMIOS_AUTO_MS || 2 * 60 * 1000));
setInterval(() => { servidorConciliarPremiosPendientes('worker').catch(() => {}); }, CONCILIAR_CADA_MS);

function randID() {
    return Math.random().toString(36).substr(2, 9);
}

class GameRoom {
    constructor(id, name, maxPlayers, entryFee, isPrivate, password = "") {
        this.id = id;
        this.name = name;
        this.maxPlayers = maxPlayers;
        this.entryFee = entryFee;
        this.isPrivate = isPrivate;
        this.password = password;

        this.players = {};
        this.bullets = [];
        this.droppedEnergy = [];
        this.droppedHealthKits = [];
        this.droppedOrbGuns = [];   // Lanza-Orbes en el suelo (botín de airdrop)
        this.bombs = [];
        this.explosions = [];
        this.bankZone = { x: MAP_SIZE / 2, y: MAP_SIZE / 2, radius: 130 };
        this.gameTime = 300;
        this.zoneRadius = ZONA_RADIO_INICIAL;
        this.zoneShrinking = false;
        this.zoneFase = 0;
        this.zoneDps = ZONA_DPS[0];
        // Zona móvil: centro actual (arranca en el centro del mapa) y cadena de
        // centros aleatorios de las fases, elegida de nuevo en cada partida.
        this.zoneCx = MAP_SIZE / 2;
        this.zoneCy = MAP_SIZE / 2;
        this.zoneNext = null;                     // círculo final marcado en el mapa
        this.zoneChain = this.generarCentrosZona();
        this.kitTimer = 0;

        this.hazardZones = [];
        this.speedPads = this.generateSpeedPads();
        this.airdrops = [];
        this.obstacles = this.generateObstacles();
        this.shopZones = this.generarTiendas();   // tras obstáculos y antes de muros
        this.walls = this.generateWalls();
        this.explosionChain = [];                 // barriles encendidos (cola)

        this.airdropTimer = 0;
        this.hazardTimer = 0;
        this.lobbyActive = false;
        this.gameStarted = false;
        this.countdown = 0;
        this.waitingTimer = null;      // contador de espera de 30 s
        this.lastPlayerCount = 0;
        this.soloTimer = null;         // victoria por abandono (10 s)
        this.pozoTotal = 0;            // bote estático fijado al arrancar la partida
        this.pendingStart = null;
        this.ending = false;

        this.initEnergy();
        this.startLoop();
    }

    // Cadena de centros de las fases de la zona: cada fase puede cerrarse en
    // cualquier punto del mapa, pero cada círculo nuevo SIEMPRE queda contenido
    // en el anterior: el desplazamiento se limita a 0.7·(rPrev − rNext) y el
    // centro se proyecta a [ZONA_MARGEN_CENTRO, MAP_SIZE − ZONA_MARGEN_CENTRO]
    // (proyección sobre una caja convexa = no expansiva → conserva la contención).
    // Como el margen (400) es mayor que el radio final (280), la última zona
    // siempre cae completamente dentro del mapa.
    generarCentrosZona() {
        const centros = [];
        const clamp = (v) => Math.max(ZONA_MARGEN_CENTRO, Math.min(MAP_SIZE - ZONA_MARGEN_CENTRO, v));
        let cx = MAP_SIZE / 2, cy = MAP_SIZE / 2;
        ZONA_FASES.forEach((fase, i) => {
            if (i > 0) {
                const rPrev = ZONA_FASES[i - 1].r;
                const derivaMax = Math.max(0, (rPrev - fase.r) * 0.7);
                const ang = Math.random() * Math.PI * 2;
                const dist = Math.sqrt(Math.random()) * derivaMax; // uniforme en el disco
                cx = clamp(cx + Math.cos(ang) * dist);
                cy = clamp(cy + Math.sin(ang) * dist);
            }
            centros.push({ x: cx, y: cy });
        });
        return centros;
    }

    // Centro objetivo de la zona: se interpola con el MISMO progreso que usa
    // zonaObjetivo() para el radio, así el círculo deriva mientras se cierra en
    // lugar de saltar de golpe al cambiar de fase.
    centroObjetivo() {
        if (!this.zoneChain || !this.zoneChain.length) return { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
        if (this.gameTime >= ZONA_FASES[0].t) return { ...this.zoneChain[0] };
        for (let i = 0; i < ZONA_FASES.length - 1; i++) {
            const alta = ZONA_FASES[i], baja = ZONA_FASES[i + 1];
            if (this.gameTime <= alta.t && this.gameTime > baja.t) {
                const tramo = (alta.t - baja.t) || 1;
                const progreso = (alta.t - this.gameTime) / tramo;
                const a = this.zoneChain[i], b = this.zoneChain[i + 1];
                return { x: a.x + (b.x - a.x) * progreso, y: a.y + (b.y - a.y) * progreso };
            }
        }
        return { ...this.zoneChain[this.zoneChain.length - 1] };
    }

    // Tiendas itinerantes: puntos aleatorios DENTRO de la zona segura actual (lejos
    // del banco, entre sí y de muros/obstáculos/turbos) con vida escalonada para
    // que se reubiquen de una en una. El cliente pinta gameState.shopZones y la
    // compra sigue siendo por proximidad → el flujo de compra no cambia.
    generarTiendas() {
        const tiendas = [];
        for (let i = 0; i < TIENDA_NUM; i++) {
            const punto = this.puntoLibreTienda(tiendas);
            tiendas.push({
                x: punto.x,
                y: punto.y,
                radius: TIENDA_RADIO,
                life: TIENDA_DESFASES[i % TIENDA_DESFASES.length],
                maxLife: TIENDA_VIDA_TICKS
            });
        }
        return tiendas;
    }

    // Punto válido para una caseta (reintentos acotados; si no encuentra uno
    // perfecto devuelve el último candidato evaluado para no dejar huecos).
    puntoLibreTienda(otras) {
        const zona = this.zoneRadius || ZONA_RADIO_INICIAL;
        const cx = this.zoneCx || MAP_SIZE / 2;
        const cy = this.zoneCy || MAP_SIZE / 2;
        const solido = [...(this.walls || []), ...(this.obstacles || [])];
        let candidato = { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
        for (let intento = 0; intento < 60; intento++) {
            const x = TIENDA_MARGEN_BORDE + Math.random() * (MAP_SIZE - TIENDA_MARGEN_BORDE * 2);
            const y = TIENDA_MARGEN_BORDE + Math.random() * (MAP_SIZE - TIENDA_MARGEN_BORDE * 2);
            candidato = { x, y };
            // Dentro de la zona segura, con holgura para que la caseta quepa entera
            if (Math.hypot(x - cx, y - cy) > Math.max(0, zona - TIENDA_RADIO - 60)) continue;
            if (Math.hypot(x - this.bankZone.x, y - this.bankZone.y) < this.bankZone.radius + TIENDA_MIN_BANCO) continue;
            if ((otras || []).some(t => Math.hypot(x - t.x, y - t.y) < TIENDA_MIN_ENTRE)) continue;
            if (solido.some(s => x > s.x - TIENDA_RADIO - TIENDA_MARGEN_SOLIDO && x < s.x + s.w + TIENDA_RADIO + TIENDA_MARGEN_SOLIDO &&
                y > s.y - TIENDA_RADIO - TIENDA_MARGEN_SOLIDO && y < s.y + s.h + TIENDA_RADIO + TIENDA_MARGEN_SOLIDO)) continue;
            if ((this.speedPads || []).some(pd => x > pd.x - TIENDA_RADIO - 40 && x < pd.x + pd.w + TIENDA_RADIO + 40 &&
                y > pd.y - TIENDA_RADIO - 40 && y < pd.y + pd.h + TIENDA_RADIO + 40)) continue;
            if (Object.values(this.players || {}).some(p => !p.isDead && Math.hypot(x - p.x, y - p.y) < TIENDA_MIN_JUGADOR)) continue;
            return { x, y };
        }
        return candidato;
    }

    // Reubica una caseta agotada: nuevo punto libre dentro de la zona segura y
    // vida reiniciada (mantiene su ciclo de ~15 s).
    moverTienda(i) {
        const t = this.shopZones[i];
        if (!t) return;
        const otras = this.shopZones.filter((_, j) => j !== i);
        const punto = this.puntoLibreTienda(otras);
        t.x = punto.x;
        t.y = punto.y;
        t.life = TIENDA_VIDA_TICKS;
        t.maxLife = TIENDA_VIDA_TICKS;
    }

    generateSpeedPads() {
        const pads = [];
        for (let i = 0; i < 6; i++) {
            pads.push({
                x: Math.random() * (MAP_SIZE - 400) + 200,
                y: Math.random() * (MAP_SIZE - 400) + 200,
                w: 80,
                h: 30,
                angle: Math.random() * Math.PI * 2
            });
        }
        return pads;
    }

    // Obstáculos tipados: rocas (daño solo de bombas, las balas las atraviesan),
    // coches y motos (cobertura destructible que EXPLOTA) y barriles reactivos.
    // Todos viven en this.obstacles → la colisión de jugador, spawnPoint() y el
    // daño de bomba se reutilizan sin tocar nada.
    generateObstacles() {
        const defs = [
            { tipo: 'roca',   n: 14, ancho: [60, 120], alto: [60, 120] },
            { tipo: 'coche',  n: 6,  ancho: [70, 70],  alto: [44, 44] },
            { tipo: 'moto',   n: 6,  ancho: [46, 46],  alto: [26, 26] },
            { tipo: 'barril', n: 8,  ancho: [30, 30],  alto: [30, 30] }
        ];
        const obs = [];
        const entreSi = 60;   // separación mínima entre obstáculos (evita racimos)
        for (const d of defs) {
            const hp = (OBSTACULOS_TIPOS[d.tipo] || {}).hp || 30;
            for (let i = 0; i < d.n; i++) {
                for (let intento = 0; intento < 40; intento++) {
                    const w = d.ancho[0] + Math.random() * (d.ancho[1] - d.ancho[0]);
                    const h = d.alto[0] + Math.random() * (d.alto[1] - d.alto[0]);
                    const x = 150 + Math.random() * Math.max(1, MAP_SIZE - 300 - w);
                    const y = 150 + Math.random() * Math.max(1, MAP_SIZE - 300 - h);
                    if (x + w > MAP_SIZE || y + h > MAP_SIZE) continue;
                    // Fuera del banco (antes podían caer encima) y de los turbos
                    if (Math.hypot(x + w / 2 - this.bankZone.x, y + h / 2 - this.bankZone.y) < this.bankZone.radius + 90) continue;
                    if ((this.speedPads || []).some(pd => x < pd.x + pd.w + 40 && x + w > pd.x - 40 &&
                        y < pd.y + pd.h + 40 && y + h > pd.y - 40)) continue;
                    if (obs.some(o => x < o.x + o.w + entreSi && x + w + entreSi > o.x &&
                        y < o.y + o.h + entreSi && y + h + entreSi > o.y)) continue;
                    obs.push({ x, y, w, h, hp, maxHp: hp, tipo: d.tipo });
                    break;
                }
            }
        }
        return obs;
    }

    // Muros simétricos en los 4 cuadrantes: se genera en el cuadrante
    // superior-izquierdo y se refleja; sin solapes (pasillo mínimo 95 px) y
    // lejos de banco, tiendas y turbos.
    generateWalls() {
        const walls = [];
        const minGap = 95;
        const margin = 160;
        const blocked = [];
        blocked.push({
            x: this.bankZone.x - this.bankZone.radius - 80,
            y: this.bankZone.y - this.bankZone.radius - 80,
            w: (this.bankZone.radius + 80) * 2,
            h: (this.bankZone.radius + 80) * 2
        });
        this.shopZones.forEach(s => {
            blocked.push({ x: s.x - s.radius - 70, y: s.y - s.radius - 70, w: (s.radius + 70) * 2, h: (s.radius + 70) * 2 });
        });
        const overlapsBlocked = (r) => blocked.some(b =>
            r.x - minGap < b.x + b.w && r.x + r.w + minGap > b.x &&
            r.y - minGap < b.y + b.h && r.y + r.h + minGap > b.y);
        const overlapsWall = (r) => walls.some(o =>
            r.x - minGap < o.x + o.w && r.x + r.w + minGap > o.x &&
            r.y - minGap < o.y + o.h && r.y + r.h + minGap > o.y);
        const overlapsPad = (r) => this.speedPads.some(pd =>
            r.x - 40 < pd.x + pd.w && r.x + r.w + 40 > pd.x &&
            r.y - 40 < pd.y + pd.h && r.y + r.h + 40 > pd.y);
        // Los muros tampoco se levantan encima de un obstáculo (coches/rocas)
        const overlapsObstaculo = (r) => (this.obstacles || []).some(o =>
            r.x - 40 < o.x + o.w && r.x + r.w + 40 > o.x &&
            r.y - 40 < o.y + o.h && r.y + r.h + 40 > o.y);
        const maxGrupo = 5;
        for (let i = 0; i < 60 && walls.length < maxGrupo * 4; i++) {
            const w = 80 + Math.random() * 110;
            const h = 40 + Math.random() * 90;
            const x = margin + Math.random() * Math.max(1, MAP_SIZE / 2 - margin - minGap - w);
            const y = margin + Math.random() * Math.max(1, MAP_SIZE / 2 - margin - minGap - h);
            const variantes = [
                { x, y, w, h },
                { x: MAP_SIZE - x - w, y, w, h },
                { x, y: MAP_SIZE - y - h, w, h },
                { x: MAP_SIZE - x - w, y: MAP_SIZE - y - h, w, h }
            ];
            if (variantes.some(v => v.x < margin || v.y < margin ||
                v.x + v.w > MAP_SIZE - margin || v.y + v.h > MAP_SIZE - margin ||
                overlapsBlocked(v) || overlapsWall(v) || overlapsPad(v) || overlapsObstaculo(v))) continue;
            variantes.forEach(v => walls.push({ ...v, hp: 30, maxHp: 30, tipo: 'muro' }));
        }

        // Muros finos: tiras de 14 px que aguantan 3 balas (hp 15). Sirven de
        // cobertura ligera y rompen líneas de tiro sin bloquear pasillos.
        let gruposFinos = 0;
        for (let i = 0; i < 60 && gruposFinos < 2; i++) {
            const vertical = Math.random() < 0.5;
            const largo = 140 + Math.random() * 80;      // 140-220 px
            const w = vertical ? 14 : largo;
            const h = vertical ? largo : 14;
            const x = margin + Math.random() * Math.max(1, MAP_SIZE / 2 - margin - minGap - w);
            const y = margin + Math.random() * Math.max(1, MAP_SIZE / 2 - margin - minGap - h);
            const variantes = [
                { x, y, w, h },
                { x: MAP_SIZE - x - w, y, w, h },
                { x, y: MAP_SIZE - y - h, w, h },
                { x: MAP_SIZE - x - w, y: MAP_SIZE - y - h, w, h }
            ];
            if (variantes.some(v => v.x < margin || v.y < margin ||
                v.x + v.w > MAP_SIZE - margin || v.y + v.h > MAP_SIZE - margin ||
                overlapsBlocked(v) || overlapsWall(v) || overlapsPad(v) || overlapsObstaculo(v))) continue;
            gruposFinos++;
            variantes.forEach(v => walls.push({ ...v, hp: 15, maxHp: 15, tipo: 'fino' }));
        }
        return walls;
    }

    // Punto de spawn/respawn que nunca cae dentro de un muro u obstáculo
    spawnPoint() {
        const solid = [...this.walls, ...this.obstacles];
        for (let i = 0; i < 40; i++) {
            const x = Math.random() * (MAP_SIZE - 600) + 300;
            const y = Math.random() * (MAP_SIZE - 600) + 300;
            const dentro = (r) => x > r.x - 30 && x < r.x + r.w + 30 && y > r.y - 30 && y < r.y + r.h + 30;
            if (!solid.some(dentro)) return { x, y };
        }
        return { x: Math.random() * (MAP_SIZE - 600) + 300, y: Math.random() * (MAP_SIZE - 600) + 300 };
    }

    // Botiquín en un punto libre del mapa (spawnPoint evita muros y obstáculos).
    generateHealthKit() {
        if (this.droppedHealthKits.length >= KIT_MAX_MAPA) return;
        const sp = this.spawnPoint();
        this.droppedHealthKits.push({
            id: 'h_' + randID(),
            x: sp.x,
            y: sp.y,
            val: KIT_VAL,
            life: KIT_VIDA
        });
    }

    // Siembra inicial de botiquines al arrancar la partida.
    sembrarBotiquines() {
        this.droppedHealthKits = [];
        this.kitTimer = 0;
        for (let i = 0; i < KIT_SIEMBRA; i++) this.generateHealthKit();
    }

    initEnergy() {
        for (let i = 0; i < 150; i++) {
            this.droppedEnergy.push({
                id: 'e_' + randID(),
                x: Math.random() * (MAP_SIZE - 300) + 150,
                y: Math.random() * (MAP_SIZE - 300) + 150,
                val: 10
            });
        }
    }

    addPlayer(socketId, nick, skin, uid) {
        const sp = this.spawnPoint();
        this.players[socketId] = {
            id: socketId,
            nick: sanitizeNick(nick),
            uid: uid || null, // UID de Firebase: necesario para premios
            skin: sanitizeSkin(skin),
            x: sp.x,
            y: sp.y,
            hp: 100, maxHp: 100,
            shield: 0, maxShield: 50,
            charge: 0, bankedScore: 0,
            radius: 22, speed: 5.5,
            angle: 0,
            inputs: { w: false, a: false, s: false, d: false, angle: 0 },
            isDead: false,
            respawnTimer: 0,
            canRespawn: false,
            currentWeapon: 1,
            ammo: PISTOLA_MAX_AMMO, maxAmmo: PISTOLA_MAX_AMMO,
            bombs: 0,
            hasOrbGun: false,
            ammo2: ORBGUN_MAX_AMMO, maxAmmo2: ORBGUN_MAX_AMMO, // cargador del Lanza-Orbes
            isReloading: false, reloadTimer: 0, reloadWeapon: 0,
            isExtracting: false,
            dashProgress: 100,
            dashCooldown: 0,
            isDashing: false,
            lastShotAt: 0,
            turboTimer: 0,
            turboCooldown: 0
        };
    }

    removePlayer(socketId) {
        if (this.players[socketId]) {
            let p = this.players[socketId];
            if (p.charge > 0) {
                this.droppedEnergy.push({
                    id: 'e_' + randID(),
                    x: p.x, y: p.y, val: p.charge
                });
            }
            delete this.players[socketId];
        }
    }

    handleInput(socketId, inputData) {
        const p = this.players[socketId];
        if (p && !p.isDead) {
            p.inputs = inputData;
            p.angle = inputData.angle || p.angle;
        }
    }

    // Aviso de cargador vacío (rate-limit: ni el audio ni el banner se saturan)
    avisarSinMunicion(p, texto) {
        const ahora = Date.now();
        if (p.avisadoEn && ahora - p.avisadoEn < 1000) return;
        p.avisadoEn = ahora;
        const s = io.sockets.sockets.get(p.id);
        if (!s) return;
        s.emit('playSound', 'empty');
        s.emit('aviso', texto);
    }

    handleShoot(socketId, shootData) {
        const p = this.players[socketId];
        if (!p || p.isDead || p.isReloading) return;

        // Anticheat: cooldown mínimo entre disparos por arma (mata el spam de balas)
        const ahora = Date.now();
        const cooldown = SHOOT_COOLDOWN[p.currentWeapon] || 120;
        if (ahora - (p.lastShotAt || 0) < cooldown) return;
        p.lastShotAt = ahora;

        if (p.currentWeapon === 1) {
            if (p.ammo <= 0) {
                this.avisarSinMunicion(p, 'Pistola sin balas · pulsa R para recargar');
                return;
            }
            p.ammo--;
            this.bullets.push({
                ownerId: socketId,
                x: p.x + Math.cos(shootData.angle) * (p.radius + 12),
                y: p.y + Math.sin(shootData.angle) * (p.radius + 12),
                vx: Math.cos(shootData.angle) * 18,
                vy: Math.sin(shootData.angle) * 18,
                life: 55,
                damage: 20
            });
            io.to(this.id).emit('playSound', 'shoot');
        } else if (p.currentWeapon === 2 && p.hasOrbGun) {
            if (p.ammo2 <= 0) {
                this.avisarSinMunicion(p, `Lanza-Orbes vacío · pulsa R (${RECARGA_ORBES_COSTE} gemas)`);
                return;
            }
            p.ammo2--;
            this.bullets.push({
                ownerId: socketId,
                x: p.x + Math.cos(shootData.angle) * (p.radius + 12),
                y: p.y + Math.sin(shootData.angle) * (p.radius + 12),
                vx: Math.cos(shootData.angle) * 14,
                vy: Math.sin(shootData.angle) * 14,
                life: 45,
                damage: 15,
                isOrbBullet: true
            });
            io.to(this.id).emit('playSound', 'shoot');
        }
    }

    handleDash(socketId) {
        const p = this.players[socketId];
        if (!p || p.isDead || p.dashCooldown > 0 || p.dashProgress < 100) return;

        p.dashCooldown = 15;
        p.dashProgress = 0;
        p.isDashing = true;
        p.dashTimer = 15;
    }

    // Recarga OBLIGATORIA (~2.5 s). Arma 1: gratis. Arma 2 (Lanza-Orbes): cuesta
    // RECARGA_ORBES_COSTE en gemas NO aseguradas y solo se cobra al COMPLETAR
    // (cambiar de arma o morir a mitad no te quita la energía).
    handleReload(socketId) {
        const p = this.players[socketId];
        if (!p || p.isDead || p.isReloading) return;

        if (p.currentWeapon === 1) {
            if (p.ammo >= p.maxAmmo) return;
        } else if (p.currentWeapon === 2 && p.hasOrbGun) {
            if (p.ammo2 >= p.maxAmmo2) return;
            if (p.charge < RECARGA_ORBES_COSTE) {
                this.avisarSinMunicion(p, `Necesitas ${RECARGA_ORBES_COSTE} gemas sin asegurar para recargar el Lanza-Orbes`);
                return;
            }
        } else {
            return;
        }

        p.isReloading = true;
        p.reloadTimer = RELOAD_TICKS;
        p.reloadWeapon = p.currentWeapon;
        io.sockets.sockets.get(p.id)?.emit('playSound', 'reload');
    }

    handleSwitchWeapon(socketId, data) {
        const p = this.players[socketId];
        if (!p || p.isDead) return;

        const weaponNum = typeof data === 'number' ? data : data.weapon;
        if (weaponNum === 2 && !p.hasOrbGun) return;
        // Cambiar de arma cancela la recarga en curso (sin cobrar nada)
        if (p.isReloading) {
            p.isReloading = false;
            p.reloadTimer = 0;
            p.reloadWeapon = 0;
        }
        p.currentWeapon = weaponNum;
    }

    handleBomb(socketId) {
        const p = this.players[socketId];
        if (!p || p.isDead || p.bombs <= 0) return;
        p.bombs--;

        this.bombs.push({
            ownerId: socketId,
            x: p.x,
            y: p.y,
            currentX: p.x,
            currentY: p.y,
            vx: 0,
            vy: 0,
            life: 180,
            timer: 90,
            exploded: false
        });
    }

    handleBuyItem(socketId, itemType) {
        const p = this.players[socketId];
        if (!p || p.isDead) return;

        const cost = ITEM_COSTOS[itemType];
        if (!cost) return; // ítem desconocido (whitelist anti-exploit)
        if (p.charge < cost) {
            // Aviso no fatal: NO saca al jugador de la partida (a diferencia de errorMsg)
            io.sockets.sockets.get(socketId)?.emit('aviso', 'No tienes suficientes gemas.');
            return;
        }

        p.charge -= cost;

        switch (itemType) {
            case 'medkit':
                p.hp = Math.min(p.maxHp, p.hp + 40);
                io.to(this.id).emit('playSound', 'pickup');
                break;
            case 'shield':
                p.shield = Math.min(p.maxShield, p.shield + 50);
                break;
            case 'bomb':
                p.bombs = Math.min(p.bombs + 1, 3);
                break;
            case 'orbGun':
                p.hasOrbGun = true;
                p.currentWeapon = 2;
                p.ammo2 = p.maxAmmo2; // se entrega con el cargador lleno
                break;
        }
    }

    handleRespawn(socketId) {
        const p = this.players[socketId];
        if (!p || !p.isDead) return;
        if (!p.canRespawn) return;

        p.isDead = false;
        p.hp = 100;
        p.shield = 0;
        p.charge = 0;
        p.isDashing = false;
        p.dashTimer = 0;
        const sp = this.spawnPoint();
        p.x = sp.x;
        p.y = sp.y;
        p.turboTimer = 0;
        p.turboCooldown = 0;
        p.currentWeapon = 1;
        p.ammo = p.maxAmmo;
        p.ammo2 = p.maxAmmo2;
        p.isReloading = false;
        p.reloadTimer = 0;
        p.reloadWeapon = 0;
        p.canRespawn = false;
        p.respawnTimer = 0;
    }

    startLoop() {
        this.interval = setInterval(() => {
            this.update();
            io.to(this.id).emit('gameState', this.getState());
        }, 1000 / 60);

        this.timerInterval = setInterval(() => {
            const playerCount = Object.keys(this.players).length;

            if (this.gameStarted) {
                this.gameTime--;

                // ── Victoria por abandono ──
                if (!this.ending) {
                    if (playerCount === 0) {
                        this.endGame({ abandono: true, inmediato: true });
                    } else if (playerCount === 1) {
                        this.soloTimer = this.soloTimer === null ? 10 : this.soloTimer - 1;
                        io.to(this.id).emit('soloWarning', { segundos: Math.max(0, this.soloTimer) });
                        if (this.soloTimer <= 0) {
                            this.endGame({ abandono: true });
                        }
                    } else if (this.soloTimer !== null) {
                        this.soloTimer = null;
                        io.to(this.id).emit('soloWarning', null);
                    }
                }
            } else if (this.lobbyActive && this.countdown > 0) {
                this.countdown--;
                // Si durante el arranque queda 1 solo jugador, el inicio se cancela
                if (playerCount < 2) {
                    this.lobbyActive = false;
                    this.countdown = 0;
                    io.to(this.id).emit('announcement', '⚠️ Inicio cancelado: quedó un solo jugador en la sala.');
                } else if (this.countdown <= 0) {
                    this.gameStarted = true;
                    this.lobbyActive = false;
                    // Botiquines iniciales repartidos por el mapa (antes solo caían
                    // al matar a alguien, así que la salud casi no se recuperaba).
                    this.sembrarBotiquines();
                    io.to(this.id).emit('announcement', ` ${KIT_SIEMBRA} botiquines repartidos por el mapa`);
                    io.to(this.id).emit('playSound', 'explosion');
                }
            }

            if (this.gameStarted) {
                this.updateZone();

                // Reposición de botiquines: mantiene el mapa surtido sin llenarlo
                this.kitTimer++;
                if (this.kitTimer >= KIT_INTERVALO) {
                    this.kitTimer = 0;
                    this.generateHealthKit();
                }

                if (this.gameStarted && this.gameTime <= 0) {
                    this.endGame();
                }
            }

            // ── Espera con contador de 30 s ──
            // Arranca al cubrir el cupo mínimo (2), se reinicia a 30 con cada
            // inscrito nuevo; si la sala baja de 2, el contador desaparece.
            if (!this.gameStarted && !this.lobbyActive) {
                if (playerCount >= 2) {
                    if (this.lastPlayerCount > 0 && playerCount > this.lastPlayerCount && this.waitingTimer !== null) {
                        this.waitingTimer = 30;
                        io.to(this.id).emit('announcement', `👋 ${playerCount} inscritos · espera reiniciada a 30s`);
                    }
                    if (this.waitingTimer === null) this.waitingTimer = 30;
                    this.waitingTimer--;
                    if (this.waitingTimer <= 0) {
                        this.waitingTimer = null;
                        this.startLobby();
                    }
                } else {
                    this.waitingTimer = null;
                }
                this.lastPlayerCount = playerCount;
            }
        }, 1000);

        this.airdropInterval = setInterval(() => {
            if (!this.gameStarted) return;
            this.airdropTimer++;
            if (this.airdropTimer >= 45) {
                this.spawnAirdrop();
                this.airdropTimer = 0;
                io.to(this.id).emit('announcement', '¡AIRLUCK INMINENTE! Cuidado con el punto de aterrizaje.');
            }
        }, 1000);

        this.hazardInterval = setInterval(() => {
            if (!this.gameStarted || this.gameTime > 120) return;
            this.hazardTimer++;
            if (this.hazardTimer >= 20 && this.hazardZones.length < 3) {
                this.spawnHazard();
                this.hazardTimer = 0;
            }
        }, 1000);
    }

    startLobby() {
        this.lobbyActive = true;
        this.countdown = 5;
        this.pendingStart = null;
        // Bote ESTÁTICO: se fija una sola vez con los inscritos al arrancar la
        // partida; ya no cambia aunque alguien abandone durante el juego.
        this.pozoTotal = +(Object.keys(this.players).length * this.entryFee).toFixed(2);
        if (!this.interval) this.startLoop();
        io.to(this.id).emit('playSound', 'explosion');
        io.to(this.id).emit('gameStarted', { countdown: this.countdown });
    }

    startGame() {
        if (this.gameStarted || this.lobbyActive) return false;
        const playerCount = Object.keys(this.players).length;
        if (playerCount < 2) return false;
        this.startLobby();
        return true;
    }

    spawnAirdrop() {
        if (this.airdrops.length >= 2) return; // tope de 2 airdrops activos
        const angle = Math.random() * Math.PI * 2;
        const dist = (MAP_SIZE / 2 - 300) * 0.8;
        this.airdrops.push({
            id: 'ad_' + randID(),
            x: MAP_SIZE / 2 + Math.cos(angle) * dist,
            y: MAP_SIZE / 2 + Math.sin(angle) * dist,
            radius: 40,
            landed: false,
            landTimer: 240,      // ~4 s de caída (60 fps)
            hp: 60,
            maxHp: 60,
            age: 0               // ticks desde el aterrizaje
        });
    }

    // Al llegar la vida de la caja a 0 por disparos, suelta el botín:
    // 5 orbes ×25 SIEMPRE + tirada de botiquín (65%) y/o Lanza-Orbes (35%).
    openAirdrop(ad) {
        const idx = this.airdrops.indexOf(ad);
        if (idx >= 0) this.airdrops.splice(idx, 1);
        for (let i = 0; i < 5; i++) {
            const a = (Math.PI * 2 * i) / 5 + Math.random() * 0.6;
            const d = ad.radius + 20 + Math.random() * 40;
            this.droppedEnergy.push({
                id: 'e_' + randID(),
                x: ad.x + Math.cos(a) * d,
                y: ad.y + Math.sin(a) * d,
                val: 25,
                life: 900 // caduca a los ~15 s
            });
        }

        const premios = [];
        if (Math.random() < KIT_LOOT_PROB) {
            this.droppedHealthKits.push({
                id: 'h_' + randID(),
                x: ad.x - ad.radius - 30,
                y: ad.y + ad.radius + 30,
                val: KIT_VAL,
                life: KIT_VIDA
            });
            premios.push(`botiquín +${KIT_VAL} HP`);
        }
        if (Math.random() < ORBGUN_LOOT_PROB) {
            this.droppedOrbGuns.push({
                id: 'og_' + randID(),
                x: ad.x + ad.radius + 30,
                y: ad.y - ad.radius - 30,
                val: 1,
                life: ORBGUN_VIDA
            });
            premios.push('LANZA-ORBES');
        }

        this.explosions.push({ x: ad.x, y: ad.y, radius: 70, alpha: 1 });
        io.to(this.id).emit('playSound', 'explosion');
        io.to(this.id).emit('announcement',
            `💥 ¡CAJA ABIERTA! 5 orbes ×25${premios.length ? ' + ' + premios.join(' + ') : ''}. ¡Corre a por el botín!`);
    }

    spawnHazard() {
        this.hazardZones.push({
            x: Math.random() * (MAP_SIZE - 400) + 200,
            y: Math.random() * (MAP_SIZE - 400) + 200,
            radius: 200 + Math.random() * 100,
            damage: 2,
            life: 600
        });
    }

    // Radio objetivo de la zona según el tiempo restante (interpolado entre fases)
    zonaObjetivo() {
        if (this.gameTime >= ZONA_FASES[0].t) return ZONA_FASES[0].r;
        for (let i = 0; i < ZONA_FASES.length - 1; i++) {
            const alta = ZONA_FASES[i], baja = ZONA_FASES[i + 1];
            if (this.gameTime <= alta.t && this.gameTime > baja.t) {
                const tramo = (alta.t - baja.t) || 1;
                const progreso = (alta.t - this.gameTime) / tramo;
                return alta.r + (baja.r - alta.r) * progreso;
            }
        }
        return ZONA_FASES[ZONA_FASES.length - 1].r;
    }

    // Índice de fase (0..ZONA_DPS.length-1) que escala el daño fuera de zona
    indiceFaseZona() {
        let idx = 0;
        for (let i = 0; i < ZONA_FASES.length; i++) {
            if (this.gameTime <= ZONA_FASES[i].t) idx = i;
        }
        return Math.min(idx, ZONA_DPS.length - 1);
    }

    // Reducción de zona tipo battle royale: el círculo permanece a tamaño completo
    // (cubre el mapa) hasta los ZONA_CIERRE_T segundos finales, en los que se
    // cierra siguiendo ZONA_FASES. Antes se cerraba durante toda la partida.
    updateZone() {
        const objetivo = this.zonaObjetivo();
        if (this.zoneRadius > objetivo) {
            this.zoneRadius = Math.max(objetivo, this.zoneRadius - ZONA_CIERRE_PX_S);
        }

        // Deriva del centro: la zona se CIERRA DONDE LA SUERTE DIGA (ya no siempre
        // en el centro del mapa). El centro se acerca al de la fase en curso con un
        // tope de ZONA_CENTRO_PX_S por tick, así el desplazamiento se ve venir.
        const cObj = this.centroObjetivo();
        const dx = cObj.x - this.zoneCx, dy = cObj.y - this.zoneCy;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.5) {
            const paso = Math.min(dist, ZONA_CENTRO_PX_S);
            this.zoneCx += (dx / dist) * paso;
            this.zoneCy += (dy / dist) * paso;
        }

        // AVISO (battle royale): ZONA_AVISO_T segundos antes del cierre se marca en
        // el mapa el círculo definitivo (centro final real de la cadena + radio
        // final) para que dé tiempo a rotar hasta allí.
        if (this.gameTime === ZONA_AVISO_T) {
            const fin = this.zoneChain[this.zoneChain.length - 1];
            this.zoneNext = { x: fin.x, y: fin.y, radius: ZONA_RADIO_FINAL };
            io.to(this.id).emit('announcement', `⭕ NUEVA ZONA MARCADA EN EL MAPA · CIERRA EN ${ZONA_CIERRE_T}s`);
            io.to(this.id).emit('playSound', 'explosion');
        }
        // Arranque del cierre (últimos ZONA_CIERRE_T s): aviso explícito. El índice
        // de fase sigue en 0 en t=ZONA_CIERRE_T, así que el aviso de fase de más
        // abajo no saltaría aquí.
        if (this.gameTime === ZONA_CIERRE_T) {
            io.to(this.id).emit('announcement', '⭕ ¡LA ZONA EMPIEZA A CERRARSE! · ¡AL CÍRCULO!');
            io.to(this.id).emit('playSound', 'explosion');
        }
        // El marcador se limpia cuando el radio ya alcanzó la zona final
        if (this.zoneNext && this.zoneRadius <= this.zoneNext.radius + 1) this.zoneNext = null;

        // "Cerrándose" = ya salió de su tamaño inicial → el anillo se pinta activo
        this.zoneShrinking = this.zoneRadius < ZONA_RADIO_INICIAL - 1;

        const fase = this.indiceFaseZona();
        if (fase !== this.zoneFase) {
            this.zoneFase = fase;
            this.zoneDps = ZONA_DPS[fase];
            io.to(this.id).emit('announcement', `⭕ LA ZONA SE CIERRA · FASE ${fase + 1}/${ZONA_DPS.length} · ¡MUÉVETE AL CENTRO! (${this.zoneDps} HP/s fuera)`);
            io.to(this.id).emit('playSound', 'explosion');
        }
    }

    stopLoop() {
        clearInterval(this.interval);
        clearInterval(this.timerInterval);
        clearInterval(this.airdropInterval);
        clearInterval(this.hazardInterval);
        this.interval = null;
        this.timerInterval = null;
        this.airdropInterval = null;
        this.hazardInterval = null;
    }

    endGame(opts = {}) {
        if (this.ending) return;
        this.ending = true;
        const abandono = !!opts.abandono;
        this.soloTimer = null;

        const gameId = this.id + '_' + Date.now();
        const leaderboard = this.getLeaderboard();

        // Modo economía: el SERVIDOR paga el premio vía Admin SDK
        if (FIREBASE_ECONOMY && FIREBASE_DB) {
            servidorPagarPremio(this, gameId, abandono);
        }

        // Bote ESTÁTICO fijado al arrancar (no cambia con abandonos);
        // premio neto real = 80% del bote (comisión del 20% ya descontada).
        const pozo = +(this.pozoTotal || (leaderboard.length * this.entryFee)).toFixed(2);
        const premioNeto = +(pozo * 0.8).toFixed(2);

        io.to(this.id).emit('gameOver', {
            gameId: gameId,
            entryFee: this.entryFee,
            leaderboard: leaderboard,
            abandono: abandono,
            premioNeto: premioNeto
        });
        this.stopLoop();

        // Dar 10s para ver los resultados y luego expulsar a todos los jugadores
        setTimeout(() => {
            // Si la sala fue destruida por el admin mientras tanto, no hacer nada
            if (!rooms[this.id]) return;

            io.to(this.id).emit('roomClosed', { reason: 'La partida ha finalizado. Volviendo al lobby...' });

            // Expulsar a todos los sockets de la sala
            io.in(this.id).fetchSockets().then(sockets => {
                sockets.forEach(s => {
                    s.leave(this.id);
                    delete s.roomId;
                });
            }).catch(() => { });

            // Vaciar jugadores y resetear la sala para nuevos registros
            this.players = {};
            this.resetForLobby();
            this.startLoop();
            emitirSalasPublicas();
        }, 10000);
    }

    resetForLobby() {
        this.gameStarted = false;
        this.lobbyActive = false;
        this.countdown = 0;
        this.pendingStart = null;
        this.gameTime = 300;
        this.zoneRadius = ZONA_RADIO_INICIAL;
        this.zoneShrinking = false;
        this.zoneFase = 0;
        this.zoneDps = ZONA_DPS[0];
        // Zona móvil: cada partida sortea de nuevo dónde se cierra la zona
        this.zoneCx = MAP_SIZE / 2;
        this.zoneCy = MAP_SIZE / 2;
        this.zoneNext = null;
        this.zoneChain = this.generarCentrosZona();
        this.kitTimer = 0;
        this.bullets = [];
        this.bombs = [];
        this.explosions = [];
        this.droppedEnergy = [];
        this.droppedHealthKits = [];
        this.droppedOrbGuns = [];
        this.airdrops = [];
        this.hazardZones = [];
        this.airdropTimer = 0;
        this.hazardTimer = 0;
        this.walls = [];                          // evita que las tiendas esquiven muros viejos
        this.obstacles = this.generateObstacles();
        this.shopZones = this.generarTiendas();   // obstáculos → tiendas → muros
        this.walls = this.generateWalls();
        this.explosionChain = [];
        this.waitingTimer = null;
        this.lastPlayerCount = 0;
        this.soloTimer = null;
        this.pozoTotal = 0;
        this.ending = false;
        this.initEnergy();
    }

    update() {
        // Tiendas itinerantes: cada caseta tiene su propia cuenta atrás y, al
        // agotarla, se reubica en otro punto libre de la zona segura (solo en
        // partida; en el lobby se quedan quietas).
        if (this.gameStarted) {
            for (let i = this.shopZones.length - 1; i >= 0; i--) {
                const t = this.shopZones[i];
                t.life = (t.life || 0) - 1;
                if (t.life <= 0) this.moverTienda(i);
            }
        }

        Object.values(this.players).forEach(p => {
            if (p.isDead) {
                p.respawnTimer++;
                if (p.respawnTimer >= 300) {
                    p.canRespawn = true;
                }
                return;
            }

            // Recarga temporizada (tecla R): al completar se rellena el cargador
            // del arma que se estaba recargando. El Lanza-Orbes cobra sus gemas
            // al completar; si a mitad murió o gastó la energía, se cancela.
            if (p.isReloading) {
                p.reloadTimer--;
                if (p.reloadTimer <= 0) {
                    const s = io.sockets.sockets.get(p.id);
                    if (p.reloadWeapon === 2) {
                        if (p.hasOrbGun && p.charge >= RECARGA_ORBES_COSTE) {
                            p.charge -= RECARGA_ORBES_COSTE;
                            p.ammo2 = p.maxAmmo2;
                            s?.emit('playSound', 'reload-done');
                        } else {
                            s?.emit('playSound', 'empty');
                        }
                    } else {
                        p.ammo = p.maxAmmo;
                        s?.emit('playSound', 'reload-done');
                    }
                    p.isReloading = false;
                    p.reloadTimer = 0;
                    p.reloadWeapon = 0;
                }
            }

            if (p.isDashing) {
                p.dashTimer--;
                if (p.dashTimer <= 0) {
                    p.isDashing = false;
                }
            }

            if (p.dashCooldown > 0) p.dashCooldown--;
            if (p.dashProgress < 100 && !p.isDashing) {
                p.dashProgress = Math.min(100, p.dashProgress + 0.5);
            }

            let moveX = 0, moveY = 0;
            if (p.inputs.w) moveY -= 1;
            if (p.inputs.s) moveY += 1;
            if (p.inputs.a) moveX -= 1;
            if (p.inputs.d) moveX += 1;

            if (moveX !== 0 && moveY !== 0) { moveX *= 0.7071; moveY *= 0.7071; }

            // Turbos: pisar un pad activa ×1.9 por ~1.4 s (cooldown ~2.5 s)
            if (p.turboCooldown > 0) p.turboCooldown--;
            if (p.turboTimer > 0) {
                p.turboTimer--;
            } else if (p.turboCooldown <= 0) {
                const sobrePad = this.speedPads.some(pad =>
                    Math.abs(p.x - (pad.x + pad.w / 2)) < pad.w / 2 + 20 &&
                    Math.abs(p.y - (pad.y + pad.h / 2)) < pad.h / 2 + 20);
                if (sobrePad) {
                    p.turboTimer = 84;     // ~1.4 s
                    p.turboCooldown = 150; // ~2.5 s
                    io.sockets.sockets.get(p.id)?.emit('playSound', 'turbo');
                }
            }

            let speed = p.speed;
            if (p.isDashing) speed *= 3;
            if (p.turboTimer > 0) speed *= 1.9;

            p.x = Math.max(p.radius, Math.min(MAP_SIZE - p.radius, p.x + moveX * speed));
            p.y = Math.max(p.radius, Math.min(MAP_SIZE - p.radius, p.y + moveY * speed));

            // Colisión jugador↔muro (incluye dash) y jugador↔obstáculo:
            // se resuelve empujando al orbe fuera del rectángulo.
            for (const s of this.walls) {
                if (s.hp <= 0) continue;
                const nx = Math.max(s.x, Math.min(p.x, s.x + s.w));
                const ny = Math.max(s.y, Math.min(p.y, s.y + s.h));
                const dx = p.x - nx, dy = p.y - ny;
                const distSq = dx * dx + dy * dy;
                if (distSq < p.radius * p.radius) {
                    if (distSq > 0.0001) {
                        const d = Math.sqrt(distSq);
                        p.x = nx + (dx / d) * p.radius;
                        p.y = ny + (dy / d) * p.radius;
                    } else {
                        // Centro dentro del rect: empujar por el borde más cercano
                        const izq = p.x - s.x, der = s.x + s.w - p.x;
                        const arriba = p.y - s.y, abajo = s.y + s.h - p.y;
                        const min = Math.min(izq, der, arriba, abajo);
                        if (min === izq) p.x = s.x - p.radius;
                        else if (min === der) p.x = s.x + s.w + p.radius;
                        else if (min === arriba) p.y = s.y - p.radius;
                        else p.y = s.y + s.h + p.radius;
                    }
                }
            }
            for (const s of this.obstacles) {
                if (s.hp <= 0) continue;
                const nx = Math.max(s.x, Math.min(p.x, s.x + s.w));
                const ny = Math.max(s.y, Math.min(p.y, s.y + s.h));
                const dx = p.x - nx, dy = p.y - ny;
                const distSq = dx * dx + dy * dy;
                if (distSq < p.radius * p.radius && distSq > 0.0001) {
                    const d = Math.sqrt(distSq);
                    p.x = nx + (dx / d) * p.radius;
                    p.y = ny + (dy / d) * p.radius;
                }
            }

            p.isExtracting = Math.hypot(p.x - this.bankZone.x, p.y - this.bankZone.y) < this.bankZone.radius;
            if (p.isExtracting && p.charge > 0) {
                p.bankedScore += p.charge;
                p.charge = 0;
                io.to(this.id).emit('playSound', 'pickup');
            }

            for (let i = this.droppedEnergy.length - 1; i >= 0; i--) {
                let g = this.droppedEnergy[i];
                if (Math.hypot(p.x - g.x, p.y - g.y) < p.radius + 10) {
                    p.charge += g.val;
                    io.to(this.id).emit('playSound', 'pickup');
                    this.droppedEnergy.splice(i, 1);
                }
            }

            // Botiquines: solo se recogen si estás herido (no se desperdician)
            if (p.hp < p.maxHp) {
                for (let i = this.droppedHealthKits.length - 1; i >= 0; i--) {
                    const h = this.droppedHealthKits[i];
                    if (Math.hypot(p.x - h.x, p.y - h.y) < p.radius + 10) {
                        p.hp = Math.min(p.maxHp, p.hp + h.val);
                        io.to(this.id).emit('playSound', 'pickup');
                        this.droppedHealthKits.splice(i, 1);
                    }
                }
            }

            // Lanza-Orbes soltado por un airdrop. Si ya lo tienes, la pieza se
            // queda en el suelo para el resto de la sala.
            if (!p.hasOrbGun) {
                for (let i = this.droppedOrbGuns.length - 1; i >= 0; i--) {
                    const g = this.droppedOrbGuns[i];
                    if (Math.hypot(p.x - g.x, p.y - g.y) < p.radius + 14) {
                        p.hasOrbGun = true;
                        p.currentWeapon = 2;
                        p.ammo2 = p.maxAmmo2;
                        this.droppedOrbGuns.splice(i, 1);
                        io.to(this.id).emit('playSound', 'pickup');
                        io.to(this.id).emit('announcement', `🔫 ${p.nick} obtuvo el LANZA-ORBES`);
                        break;
                    }
                }
            }

            // Daño fuera de la zona: HP/s según la fase (antes era 1 HP por tick
            // de 60 fps = 60 HP/s, y solo se aplicaba en el último minuto).
            if (this.gameStarted) {
                const distToCenter = Math.hypot(p.x - this.zoneCx, p.y - this.zoneCy);
                if (distToCenter > this.zoneRadius + p.radius && p.isDead === false) {
                    p.hp -= (this.zoneDps || ZONA_DPS[0]) / 60;
                    if (p.hp <= 0) {
                        this.killPlayer(p);
                        io.to(this.id).emit('playSound', 'explosion');
                    }
                }
            }
        });

        this.hazardZones.forEach(hz => {
            Object.values(this.players).forEach(p => {
                if (!p.isDead && Math.hypot(p.x - hz.x, p.y - hz.y) < hz.radius) {
                    p.hp -= hz.damage;
                    if (p.hp <= 0) {
                        this.killPlayer(p);
                    }
                }
            });
        });
        this.hazardZones = this.hazardZones.filter(hz => hz.life-- > 0);

        // Ciclo de vida de airdrops: caída (~4 s) → aterrizaje; si nadie lo
        // destruye a disparos en ~20 s, la caja se desvanece.
        this.airdrops = this.airdrops.filter(ad => {
            if (!ad.landed) {
                ad.landTimer--;
                if (ad.landTimer <= 0) {
                    ad.landed = true;
                    io.to(this.id).emit('playSound', 'explosion');
                    io.to(this.id).emit('announcement', '📦 ¡AIRDROP ATERRIZADO! Dispárale para abrirlo.');
                }
                return true;
            }
            ad.age++;
            return ad.age < 1200; // ~20 s en el suelo
        });

        // Caducidad de orbes sueltos (solo los que tienen vida definida, ej. airdrop)
        for (let i = this.droppedEnergy.length - 1; i >= 0; i--) {
            const g = this.droppedEnergy[i];
            if (g.life !== undefined && (g.life = g.life - 1) <= 0) {
                this.droppedEnergy.splice(i, 1);
            }
        }

        for (let i = this.droppedHealthKits.length - 1; i >= 0; i--) {
            this.droppedHealthKits[i].life = (this.droppedHealthKits[i].life || KIT_VIDA) - 1;
            if (this.droppedHealthKits[i].life <= 0) {
                this.droppedHealthKits.splice(i, 1);
            }
        }

        // Lanza-Orbes sin recoger: caducan para no saturar el mapa
        for (let i = this.droppedOrbGuns.length - 1; i >= 0; i--) {
            this.droppedOrbGuns[i].life = (this.droppedOrbGuns[i].life || ORBGUN_VIDA) - 1;
            if (this.droppedOrbGuns[i].life <= 0) {
                this.droppedOrbGuns.splice(i, 1);
            }
        }

        for (let i = this.bullets.length - 1; i >= 0; i--) {
            let b = this.bullets[i];
            b.x += b.vx;
            b.y += b.vy;
            b.life--;

            if (b.x < 0 || b.x > MAP_SIZE || b.y < 0 || b.y > MAP_SIZE) {
                this.bullets.splice(i, 1);
                continue;
            }

            if (b.life <= 0) {
                this.bullets.splice(i, 1);
                continue;
            }

            let hit = false;
            Object.values(this.players).forEach(p => {
                if (p.id !== b.ownerId && !p.isDead) {
                    if (Math.hypot(p.x - b.x, p.y - b.y) < p.radius + (b.isOrbBullet ? 6 : 0)) {
                        hit = true;
                        this.damagePlayer(p, b.ownerId, b.damage, b);
                    }
                }
            });

            // Bala ↔ airdrop aterrizado: 6 de daño por bala; al llegar a 0 HP se abre
            if (!hit) {
                for (const ad of this.airdrops) {
                    if (!ad.landed) continue;
                    if (Math.abs(b.x - ad.x) < ad.radius + 8 && Math.abs(b.y - ad.y) < ad.radius + 8) {
                        hit = true;
                        ad.hp -= 6;
                        if (ad.hp <= 0) this.openAirdrop(ad);
                        break;
                    }
                }
            }

            // Bala ↔ muro: 6 de daño por bala; se destruyen al llegar a 0 HP
            if (!hit) {
                for (let wi = this.walls.length - 1; wi >= 0; wi--) {
                    const wl = this.walls[wi];
                    if (b.x > wl.x && b.x < wl.x + wl.w && b.y > wl.y && b.y < wl.y + wl.h) {
                        hit = true;
                        wl.hp -= 6;
                        if (wl.hp <= 0) this.walls.splice(wi, 1);
                        break;
                    }
                }
            }

            // Bala ↔ obstáculo explosivo (coche/moto/barril): 6 de daño por bala y
            // la bala se consume. Las rocas siguen dejando pasar las balas, así el
            // combate actual no cambia.
            if (!hit) {
                for (let oi = this.obstacles.length - 1; oi >= 0; oi--) {
                    const obs = this.obstacles[oi];
                    if (obs.hp <= 0 || !obs.tipo || obs.tipo === 'roca') continue;
                    if (b.x > obs.x && b.x < obs.x + obs.w && b.y > obs.y && b.y < obs.y + obs.h) {
                        hit = true;
                        obs.hp -= 6;
                        if (obs.hp <= 0) this.explotarObstaculo(obs, b.ownerId);
                        break;
                    }
                }
            }

            if (hit) {
                this.bullets.splice(i, 1);
            }
        }

        // Reacción en cadena de los barriles: los explosivos encendidos estallan
        // con un pequeño retardo (cascada visible, sin recursión).
        for (let i = this.explosionChain.length - 1; i >= 0; i--) {
            const e = this.explosionChain[i];
            e.ticks--;
            if (e.ticks > 0) continue;
            this.explosionChain.splice(i, 1);
            this.explotarObstaculo(e.obs, e.ownerId);
        }

        for (let i = this.bombs.length - 1; i >= 0; i--) {
            let bomb = this.bombs[i];
            if (!bomb.exploded) {
                bomb.timer--;
                if (bomb.timer <= 0) {
                    bomb.exploded = true;
                    this.explodeBomb(bomb);
                }
            }
            if (bomb.exploded) {
                this.bombs.splice(i, 1);
            }
        }

        for (let i = this.explosions.length - 1; i >= 0; i--) {
            this.explosions[i].alpha -= 0.02;
            if (this.explosions[i].alpha <= 0) {
                this.explosions.splice(i, 1);
            }
        }
    }

    damagePlayer(p, ownerId, damage, bullet) {
        if (p.shield > 0) {
            const absorbed = Math.min(p.shield, damage);
            p.shield -= absorbed;
            damage -= absorbed;
            if (damage <= 0) return;
        }
        p.hp -= damage;
        if (p.hp <= 0) {
            p.hp = 0;
            p.isDead = true;
            p.isReloading = false;   // morir cancela la recarga (no se cobra nada)
            p.reloadTimer = 0;
            p.reloadWeapon = 0;
            p.respawnTimer = 0;
            p.canRespawn = false;
            if (p.charge > 0) {
                this.droppedEnergy.push({
                    id: 'e_' + randID(),
                    x: p.x, y: p.y, val: p.charge
                });
                p.charge = 0;
            }
            const ownerSocket = io.sockets.sockets.get(ownerId);
            if (ownerSocket) {
                const owner = this.players[ownerId];
                if (owner) {
                    owner.bankedScore += 5;
                }
            }
        }
    }

    killPlayer(p, postKill) {
        if (p.isDead) return;
        p.hp = 0;
        p.isDead = true;
        p.isReloading = false;   // morir cancela la recarga (no se cobra nada)
        p.reloadTimer = 0;
        p.reloadWeapon = 0;
        p.respawnTimer = 0;
        p.canRespawn = false;
        if (p.charge > 0) {
            this.droppedEnergy.push({
                id: 'e_' + randID(),
                x: p.x, y: p.y, val: p.charge
            });
            p.charge = 0;
        }
        if (postKill) postKill();
    }

    explodeBomb(bomb) {
        this.explosions.push({
            x: bomb.currentX,
            y: bomb.currentY,
            radius: 150,
            alpha: 1
        });
        io.to(this.id).emit('playSound', 'explosion');

        Object.values(this.players).forEach(p => {
            if (!p.isDead) {
                const dist = Math.hypot(p.x - bomb.currentX, p.y - bomb.currentY);
                if (dist < 150) {
                    this.damagePlayer(p, bomb.ownerId, 30);
                }
            }
        });

        // Los obstáculos explosivos destruidos por la bomba estallan también (antes
        // las rocas morían en silencio y los vehículos no existían). Las rocas
        // siguen rompiéndose sin explosión, igual que hoy.
        const destruidos = [];
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const obs = this.obstacles[i];
            const dist = Math.hypot(obs.x - bomb.currentX, obs.y - bomb.currentY);
            if (dist >= 150) continue;
            obs.hp -= 50;
            if (obs.hp > 0) continue;
            this.obstacles.splice(i, 1);
            if (obs.tipo && obs.tipo !== 'roca') destruidos.push(obs);
        }
        destruidos.forEach(obs => this.explotarObstaculo(obs, bomb.ownerId));
    }

    // Explosión de un obstáculo destructible (coche, moto o barril) con crédito de
    // baja para quien lo reviente. Las cadenas de barriles NO usan recursión: se
    // encolan en this.explosionChain y se consumen en update() con retardo.
    explotarObstaculo(obs, ownerId) {
        if (!obs || obs.explotado) return;
        obs.explotado = true;
        obs.hp = 0;
        const idx = this.obstacles.indexOf(obs);
        if (idx >= 0) this.obstacles.splice(idx, 1);

        const def = OBSTACULOS_TIPOS[obs.tipo] || OBSTACULOS_TIPOS.roca;
        const cx = obs.x + obs.w / 2, cy = obs.y + obs.h / 2;
        this.explosions.push({ x: cx, y: cy, radius: def.radio, alpha: 1 });
        io.to(this.id).emit('playSound', 'explosion');

        // Daño a jugadores en el radio (con crédito de baja para el disparador)
        Object.values(this.players).forEach(p => {
            if (p.isDead) return;
            if (Math.hypot(p.x - cx, p.y - cy) < def.radio) this.damagePlayer(p, ownerId, def.dano);
        });

        if (obs.tipo === 'coche') {
            // El coche reventado suelta 2 orbes ×10 en el sitio del siniestro
            for (let i = 0; i < COCHE_ORBES; i++) {
                this.droppedEnergy.push({
                    id: 'e_' + randID(),
                    x: cx + (Math.random() - 0.5) * obs.w,
                    y: cy + (Math.random() - 0.5) * obs.h,
                    val: COCHE_ORBE_VAL
                });
            }
        } else if (obs.tipo === 'moto') {
            // Impulso de turbo ×1.9 (~2 s) para quien la reviente
            const p = this.players[ownerId];
            if (p && !p.isDead) {
                p.turboTimer = MOTO_TURBO_TICKS;
                p.turboCooldown = 150;
                io.sockets.sockets.get(p.id)?.emit('playSound', 'turbo');
            }
        } else if (obs.tipo === 'barril') {
            // Reacción en cadena: prende barriles y vehículos cercanos con retardo
            this.obstacles.forEach(o => {
                if (o.explotado || !o.tipo || o.tipo === 'roca') return;
                if (Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy) < def.radio + BARRIL_CADENA_RADIO) {
                    this.explosionChain.push({ obs: o, ownerId, ticks: BARRIL_CADENA_TICKS });
                }
            });
        }
    }

    getSummary() {
        const iniciada = this.gameStarted || this.lobbyActive;
        return {
            id: this.id,
            nombre: this.name,
            maxJugadores: this.maxPlayers,
            jugadoresConectados: Object.keys(this.players).length,
            precioEntrada: this.entryFee,
            // En inscripción: bote en vivo (inscritos × entrada). Una vez
            // iniciada la partida: bote estático fijado al arrancar.
            pozoActual: iniciada ? this.pozoTotal : Object.keys(this.players).length * this.entryFee,
            esPrivada: this.isPrivate,
            iniciada: iniciada
        };
    }

    getLeaderboard() {
        return Object.values(this.players).sort((a, b) => b.bankedScore - a.bankedScore);
    }

    getState() {
        return {
            players: this.players,
            droppedOrbGuns: this.droppedOrbGuns,
            zoneFase: this.zoneFase,
            zoneDps: this.zoneDps,
            bullets: this.bullets,
            droppedEnergy: this.droppedEnergy,
            healthKits: this.droppedHealthKits,
            bankZone: this.bankZone,
            gameTime: this.gameTime,
            zoneRadius: this.zoneRadius,
            zoneShrinking: this.zoneShrinking,
            zoneCx: this.zoneCx,
            zoneCy: this.zoneCy,
            zoneNext: this.zoneNext,
            mapSize: MAP_SIZE,
            shopZones: this.shopZones,
            hazardZones: this.hazardZones,
            speedPads: this.speedPads,
            airdrops: this.airdrops,
            obstacles: this.obstacles,
            walls: this.walls,
            waitingTimer: this.waitingTimer,
            soloTimer: this.soloTimer,
            bombs: this.bombs,
            explosions: this.explosions,
            lobbyActive: this.lobbyActive,
            countdown: this.countdown,
            gameStarted: this.gameStarted,
            pozoTotal: this.pozoTotal,
            maxPlayers: this.maxPlayers,
            entryFee: this.entryFee
        };
    }
}

// Salas iniciales: NO hay salas fijas; solo las automáticas por tier
// (5 × $0.50, 5 × $1, 5 × $3, 5 × $5) + las que cree el admin.

// ── Salas automáticas por tier: 5 × $0.50, 5 × $1, 5 × $3, 5 × $5 (10 plazas) ──
const SALAS_AUTO = [
    { pref: 'p05', nombre: 'Rápida $0.50', fee: 0.50, count: 5 },
    { pref: 'p1', nombre: 'Arena $1', fee: 1.00, count: 5 },
    { pref: 'p3', nombre: 'Liga $3', fee: 3.00, count: 5 },
    { pref: 'p5', nombre: 'High Roller $5', fee: 5.00, count: 5 }
];

function ensureRooms() {
    SALAS_AUTO.forEach(t => {
        for (let i = 1; i <= t.count; i++) {
            const id = `${t.pref}_${i}`;
            if (!rooms[id]) {
                rooms[id] = new GameRoom(id, `${t.nombre} · #${i}`, 10, t.fee, false);
            }
        }
    });
}
ensureRooms();
setInterval(ensureRooms, 30000); // repone salas destruidas por el admin

// Throttle del broadcast de salas: las acciones del admin son inmediatas (immediate=true);
// join/leave/disconnect se agrupan en una sola emisión cada 250 ms (anti DoS ligero).
let roomsEmitScheduled = false;
let roomsEmitQueued = false;
function emitirSalasPublicas(immediate = false) {
    const _send = () => io.emit('roomsList', Object.values(rooms).map(r => r.getSummary()));
    if (immediate) {
        roomsEmitScheduled = false;
        roomsEmitQueued = false;
        _send();
        return;
    }
    roomsEmitQueued = true;
    if (roomsEmitScheduled) return;
    roomsEmitScheduled = true;
    setTimeout(() => {
        roomsEmitScheduled = false;
        if (roomsEmitQueued) {
            roomsEmitQueued = false;
            _send();
        }
    }, 250);
}

// Verifica la identidad de un socket (modo economía: valida el ID token de Firebase;
// modo degradado: confía en el uid del cliente, límite del MVP).
async function verificarUidEnSala(socket, room, payload) {
    let uidRaw = null;
    let token = null;
    if (typeof payload === 'string') {
        uidRaw = payload;
    } else if (payload && typeof payload === 'object') {
        uidRaw = payload.uid;
        token = payload.token;
    }
    if (FIREBASE_ECONOMY && token && typeof token === 'string' && token.length < 6000) {
        try {
            const decoded = await firebaseAdmin.auth().verifyIdToken(token);
            socket.verifiedUid = decoded.uid;
            if (room && room.players && room.players[socket.id]) {
                room.players[socket.id].uid = decoded.uid;
            }
        } catch (e) {
            // token inválido: se queda sin verificación
        }
    } else if (!FIREBASE_ECONOMY && uidRaw && typeof uidRaw === 'string') {
        socket.verifiedUid = uidRaw.slice(0, 128);
    }
}

// Saca a un jugador de su sala actual, reembolsando la entrada si la partida no arrancó
async function salirDeSala(socket, room) {
    if (!room || !room.players[socket.id]) return;
    const p = room.players[socket.id];
    // Reembolso solo mientras se inscribe; una vez arranca la partida
    // (lobby de countdown incluido) la entrada ya no se devuelve.
    if (FIREBASE_ECONOMY && !room.gameStarted && !room.lobbyActive && p.pagoEntrada) {
        const uid = socket.verifiedUid || p.uid;
        if (uid) {
            await servidorReembolsar(uid, p.pagoEntrada.entradasId, p.pagoEntrada.monto);
        }
    }
    room.removePlayer(socket.id);
}

io.on('connection', (socket) => {
    socket.isAdmin = false;
    socket.emit('serverConfig', { economy: FIREBASE_ECONOMY });
    socket.emit('roomsList', Object.values(rooms).map(r => r.getSummary()));

    // Rate-limit del panel admin por IP (5 fallos → bloqueo 60 s)
    socket.on('adminAuth', ({ password }) => {
        const ip = socket.handshake?.address || '';
        const now = Date.now();
        const rec = (adminFailuresByIP[ip] = adminFailuresByIP[ip] || { fail: 0, until: 0 });
        if (rec.until > now) {
            return socket.emit('errorMsg', 'Demasiados intentos de acceso al panel. Espera un momento.');
        }
        if (password === ADMIN_PASSWORD) {
            socket.isAdmin = true;
            rec.fail = 0;
            socket.emit('adminAuthed', true);
        } else {
            rec.fail++;
            if (rec.fail >= 5) {
                rec.until = now + 60000;
                rec.fail = 0;
            }
            socket.emit('adminAuthed', false);
        }
    });

    socket.on('notifyTelegram', (message) => {
        if (!socket.isAdmin) return;
        telegramNotify(message);
    });

    // Notificaciones de jugadores (solicitudes de wallet): validadas y con límite de tasa
    socket.on('notifyPlayerTelegram', (message) => {
        if (socket.isAdmin) return; // el admin usa el evento notifyTelegram
        if (typeof message !== 'string') return;
        const texto = message.trim();
        if (!texto || texto.length > 400) return;
        const ahora = Date.now();
        if (ahora - (socket.__tgUltimo || 0) < 5000) return; // máx. 1 cada 5 s por conexión
        socket.__tgUltimo = ahora;
        telegramNotify('[WINORBS] ' + texto);
    });

    // Auto-reclamo: el ganador logueado pide conciliar sus pendientes (por UID o apodo)
    socket.on('reclamarPremios', async (payload) => {
        try {
            await verificarUidEnSala(socket, null, payload || {});
            const uid = socket.verifiedUid;
            if (!uid) return socket.emit('premiosReclamados', { ok: false, error: 'NO_AUTH' });
            const r = await servidorReclamarPremiosDeUsuario(uid);
            socket.emit('premiosReclamados', r);
        } catch (e) {
            socket.emit('premiosReclamados', { ok: false, error: 'ERROR' });
        }
    });

    // Admin: vincular un pendiente a un UID concreto (respaldo manual)
    socket.on('adminVincularPremio', async (payload) => {
        if (!socket.isAdmin) return socket.emit('premioVinculado', { ok: false, error: 'NO_ADMIN' });
        const p = (payload && typeof payload === 'object') ? payload : {};
        if (!p.gameId || !p.uid) return socket.emit('premioVinculado', { ok: false, error: 'PARAMS' });
        const r = await servidorAcreditarPremioPendiente(String(p.gameId), String(p.uid), { manual: true, exigirMatchApodo: false });
        socket.emit('premioVinculado', Object.assign({ gameId: p.gameId }, r));
        if (r.ok) io.emit('premiosActualizados', { gameId: p.gameId });
    });

    // Admin: forzar pasada de conciliación automática bajo demanda
    socket.on('adminConciliarPremios', async () => {
        if (!socket.isAdmin) return socket.emit('premiosConciliados', { ok: false, error: 'NO_ADMIN' });
        const r = await servidorConciliarPremiosPendientes('manual-admin');
        socket.emit('premiosConciliados', r);
        if (r.ok && (r.pagados || []).length > 0) io.emit('premiosActualizados', { n: r.pagados.length });
    });

    socket.on('adminCreateRoom', (roomData) => {
        if (!socket.isAdmin) {
            return socket.emit('errorMsg', 'No tienes permisos de administrador.');
        }
        if (!roomData || !roomData.id || rooms[roomData.id]) {
            return socket.emit('errorMsg', 'ID de sala inválido o ya existe.');
        }
        rooms[roomData.id] = new GameRoom(
            roomData.id,
            sanitizeNick(roomData.nombre),
            roomData.maxJugadores || 6,
            roomData.precioEntrada || 0,
            roomData.esPrivada || false,
            roomData.password || ""
        );
        emitirSalasPublicas(true);
    });

    socket.on('adminDestroyRoom', async ({ roomId }) => {
        if (!socket.isAdmin) {
            return socket.emit('errorMsg', 'No tienes permisos de administrador.');
        }
        if (rooms[roomId]) {
            const room = rooms[roomId];

            // Reembolsar entradas solo si la partida aún no arrancó
            if (FIREBASE_ECONOMY && !room.gameStarted && !room.lobbyActive) {
                Object.values(room.players).forEach(p => {
                    if (p.pagoEntrada && p.uid) {
                        servidorReembolsar(p.uid, p.pagoEntrada.entradasId, p.pagoEntrada.monto);
                    }
                });
            }

            // Notificar y expulsar a todos los jugadores antes de cerrar la sala
            io.to(roomId).emit('roomClosed', { reason: 'La sala fue cerrada por el administrador.' });
            io.in(roomId).fetchSockets().then(sockets => {
                sockets.forEach(s => {
                    s.leave(roomId);
                    delete s.roomId;
                });
            }).catch(() => { });

            room.stopLoop();
            delete rooms[roomId];
            emitirSalasPublicas(true);
        }
    });

        // ── Tienda de skins ──────────────────────────────────────────
    // Lista de skins activas (respaldo para la tienda si Firestore directo falla)
    socket.on('tiendaSkins', async () => {
        try {
            if (!FIREBASE_ECONOMY || !FIREBASE_DB) return socket.emit('tiendaList', []);
            const snap = await FIREBASE_DB.collection('skins').where('activo', '==', true).limit(100).get();
            socket.emit('tiendaList', snap.docs.map(d => {
                const dta = d.data();
                return {
                    id: d.id,
                    nombre: sanitizeNick(String(dta.nombre || 'Skin')),
                    precio: Number(dta.precio || 0),
                    c1: sanitizeHex(dta.c1, '#38bdf8'),
                    c2: sanitizeHex(dta.c2, '#0284c7'),
                    border: sanitizeHex(dta.border, '#bae6fd'),
                    imagenUrl: typeof dta.imagenUrl === 'string' ? dta.imagenUrl.slice(0, 500) : ''
                };
            }));
        } catch (e) {
            socket.emit('tiendaList', []);
        }
    });

    // Compra de skin: valida identidad (token) y cobra server-side
    socket.on('comprarSkin', async (data) => {
        const p = (data && typeof data === 'object') ? data : {};
        try {
            await verificarUidEnSala(socket, null, p);
        } catch (e) { /* token inválido: queda sin verificación */ }
        const res = await servidorComprarSkin(socket.verifiedUid, p.skinId);
        socket.emit('skinResult', res);
        if (res.ok) {
            telegramNotify('🛒 <b>Compra de skin</b>\nUID: ' + socket.verifiedUid + '\nSkin: ' + (p.skinId || '?'));
        }
    });

    socket.on('joinRoom', async ({ roomId, password, nick, skin, uid, token }) => {
        const room = rooms[roomId];

        if (!room) {
            return socket.emit('errorMsg', 'La sala especificada no existe.');
        }
        // La contraseña se valida primero (incluso si ya está en la sala)
        if (room.isPrivate && room.password !== password) {
            return socket.emit('errorMsg', 'Contraseña de sala incorrecta.');
        }
        // Ya registrado en esta misma sala: confirmar, y aprovechar para vincular token/uid tardíos
        if (socket.roomId === room.id && room.players[socket.id]) {
            await verificarUidEnSala(socket, room, { uid, token });
            if (FIREBASE_ECONOMY && room.entryFee > 0 && socket.verifiedUid && !room.players[socket.id].pagoEntrada) {
                const cobro = await servidorCobrarEntrada(socket.verifiedUid, room.id, room.entryFee);
                if (cobro.ok) {
                    socket.__entradaCobrada = { entradasId: cobro.entradasId, monto: room.entryFee, salaId: room.id };
                    room.players[socket.id].pagoEntrada = socket.__entradaCobrada;
                }
            }
            return socket.emit('joinedSuccess', { playerId: socket.id, roomId: room.id });
        }
        if (room.gameStarted) {
            return socket.emit('errorMsg', 'La partida ya ha comenzado.');
        }
        // Cupo: no aplicar a quien ya ocupa un lugar en esta sala
        const yaEstaAqui = socket.roomId === room.id;
        if (!yaEstaAqui && Object.keys(room.players).length >= room.maxPlayers) {
            return socket.emit('errorMsg', 'La sala está llena.');
        }

        const ip = socket.handshake?.address || '';
        // Anti multi-cuenta: límite de sockets por IP en salas de pago
        if (room.entryFee > 0 && !yaEstaAqui) {
            let mismaIp = 0;
            for (const p of Object.values(room.players)) {
                if (p.__ip && p.__ip === ip) mismaIp++;
            }
            if (mismaIp >= MAX_SOCKETS_PER_IP) {
                return socket.emit('errorMsg', 'Límite de conexiones desde tu red alcanzado en esta sala.');
            }
        }
        // Un mismo UID verificado no puede ocupar 2 asientos en la misma sala
        if (uid && typeof uid === 'string') {
            const duplicado = Object.values(room.players).some(p => p.uid && p.uid === uid && p.id !== socket.id);
            if (duplicado) {
                return socket.emit('errorMsg', 'Ya tienes una sesión activa en esta sala.');
            }
        }

        // Cambio de sala: salir automáticamente de la sala anterior (con reembolso si aplica)
        if (socket.roomId && rooms[socket.roomId] && socket.roomId !== room.id) {
            await salirDeSala(socket, rooms[socket.roomId]);
        }

        // Verificar identidad (modo economía: ID token de Firebase)
        await verificarUidEnSala(socket, room, { uid, token });

        // Apodo ÚNICO en juego: si el socket trae UID verificado y el apodo que
        // escribió NO coincide con el registrado en su perfil, se usa el del
        // perfil. Así nadie puede suplantar el apodo de otro dentro de la sala
        // (y el ganadorNick del premio siempre es el dueño real).
        // Además se rechaza el nick si OTRO jugador de la sala ya lo usa
        // (comparación insensible a mayúsculas), para que no haya 2 iguales
        // ni siquiera entre invitados sin UID.
        let nickFinal = nick;
        if (socket.verifiedUid && FIREBASE_DB) {
            try {
                const snapPerfil = await FIREBASE_DB.collection('usuarios').doc(socket.verifiedUid).get();
                const apodoReal = snapPerfil.exists ? String((snapPerfil.data() || {}).apodo || '').trim() : '';
                if (apodoReal) nickFinal = apodoReal;
            } catch (e) { /* si falla la lectura, se usa el nick enviado */ }
        }
        const claveNick = String(nickFinal || '').trim().toLowerCase();
        const nickOcupado = Object.values(room.players).some((p) =>
            p.id !== socket.id && String(p.nick || '').trim().toLowerCase() === claveNick);
        if (claveNick && nickOcupado) {
            return socket.emit('errorMsg', 'Ese apodo ya está en uso en esta sala. Cambia tu apodo en Mi Perfil.');
        }

        // Anti-suplantación GLOBAL: un socket sin UID verificado (invitado o
        // navegador sin token) no puede jugar con un apodo que ya pertenece a una
        // cuenta registrada (reserva apodos/{clave}). Así nadie puede hacerse
        // pasar por otro jugador y desviar la conciliación de su premio.
        if (!socket.verifiedUid && FIREBASE_DB && claveNick) {
            try {
                const snapAp = await FIREBASE_DB.collection('apodos').doc(claveNick).get();
                if (snapAp.exists && (snapAp.data() || {}).uid) {
                    return socket.emit('errorMsg', 'Ese apodo pertenece a una cuenta registrada. Inicia sesión con tu cuenta o elige otro apodo.');
                }
            } catch (e) { /* sin colección/reglas: no se bloquea el acceso */ }
        }

        // Cobro de entrada en el SERVIDOR (modo economía) — el cliente ya no decide
        if (room.entryFee > 0 && FIREBASE_ECONOMY && !socket.__entradaCobrada) {
            if (!socket.verifiedUid) {
                return socket.emit('errorMsg', 'Las salas de pago requieren iniciar sesión con cuenta verificada.');
            }
            const cobro = await servidorCobrarEntrada(socket.verifiedUid, room.id, room.entryFee);
            if (!cobro.ok) {
                if (cobro.error === 'SALDO_INSUFICIENTE') {
                    return socket.emit('errorMsg', 'Saldo insuficiente para cubrir la entrada a esta sala.');
                }
                if (cobro.error === 'NO_PROFILE') {
                    return socket.emit('errorMsg', 'No tienes perfil en la wallet. Regístrate antes de jugar en salas de pago.');
                }
                return socket.emit('errorMsg', 'No se pudo cobrar la entrada: ' + String(cobro.error || 'ERROR').slice(0, 120));
            }
            socket.__entradaCobrada = { entradasId: cobro.entradasId, monto: room.entryFee, salaId: room.id };
        }

        socket.join(room.id);
        socket.roomId = room.id;
        // Anticheat de skins: si la skin no es básica ni está en el inventario del jugador → básica
        const skinValidada = await validarSkinCliente(skin, socket.verifiedUid || (typeof uid === 'string' ? uid.slice(0, 128) : null));
        room.addPlayer(socket.id, nickFinal, skinValidada, socket.verifiedUid || (typeof uid === 'string' ? uid.slice(0, 128) : null));
        const nuevoP = room.players[socket.id];
        nuevoP.__ip = ip;
        if (socket.__entradaCobrada) nuevoP.pagoEntrada = socket.__entradaCobrada;

        socket.emit('joinedSuccess', { playerId: socket.id, roomId: room.id });
        emitirSalasPublicas();
    });

    // El cliente vincula su UID/token de Firebase si llegó después del join
    // Acepta {uid, token} (nuevo) o string (legacy).
    socket.on('setUid', async (data) => {
        const room = rooms[socket.roomId];
        if (!room || !room.players[socket.id]) return;

        await verificarUidEnSala(socket, room, data);
        const p = room.players[socket.id];
        if (socket.verifiedUid) p.uid = socket.verifiedUid;

        // Cobro diferido: llegó el token después del join en una sala de pago
        if (FIREBASE_ECONOMY && room.entryFee > 0 && socket.verifiedUid && !p.pagoEntrada) {
            const cobro = await servidorCobrarEntrada(socket.verifiedUid, room.id, room.entryFee);
            if (cobro.ok) {
                socket.__entradaCobrada = { entradasId: cobro.entradasId, monto: room.entryFee, salaId: room.id };
                p.pagoEntrada = socket.__entradaCobrada;
            } else if (cobro.error === 'SALDO_INSUFICIENTE') {
                socket.emit('errorMsg', 'Saldo insuficiente para la entrada. Serás retirado de la sala.');
                room.removePlayer(socket.id);
                socket.leave(room.id);
                delete socket.roomId;
            }
        }
    });

    socket.on('playerInput', (inputData) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        // Anti-spam: descarta inputs más rápidos que el tick del cliente
        const ahora = Date.now();
        if (ahora - (socket.__lastInput || 0) < INPUT_MIN_INTERVAL) return;
        socket.__lastInput = ahora;
        rooms[socket.roomId].handleInput(socket.id, inputData);
    });

    socket.on('playerShoot', (shootData) => {
        if (socket.roomId && rooms[socket.roomId]) {
            rooms[socket.roomId].handleShoot(socket.id, shootData);
        }
    });

    socket.on('playerDash', () => {
        if (socket.roomId && rooms[socket.roomId]) {
            rooms[socket.roomId].handleDash(socket.id);
        }
    });

    socket.on('playerBomb', () => {
        if (socket.roomId && rooms[socket.roomId]) {
            rooms[socket.roomId].handleBomb(socket.id);
        }
    });

    socket.on('switchWeapon', (data) => {
        if (socket.roomId && rooms[socket.roomId]) {
            rooms[socket.roomId].handleSwitchWeapon(socket.id, data);
        }
    });

    socket.on('playerReload', () => {
        if (socket.roomId && rooms[socket.roomId]) {
            rooms[socket.roomId].handleReload(socket.id);
        }
    });

    socket.on('buyShopItem', (itemType) => {
        if (socket.roomId && rooms[socket.roomId]) {
            rooms[socket.roomId].handleBuyItem(socket.id, itemType);
        }
    });

    socket.on('requestRespawn', () => {
        if (socket.roomId && rooms[socket.roomId]) {
            rooms[socket.roomId].handleRespawn(socket.id);
        }
    });

    socket.on('startGame', ({ roomId }) => {
        if (!socket.isAdmin) {
            return socket.emit('errorMsg', 'No tienes permisos de administrador.');
        }
        const room = rooms[roomId];
        if (!room) {
            return socket.emit('errorMsg', 'La sala no existe.');
        }
        if (!room.startGame()) {
            return socket.emit('errorMsg', 'No se puede iniciar la partida (necesita al menos 2 jugadores).');
        }
        io.to(roomId).emit('playSound', 'explosion');
    });

    socket.on('leaveRoom', async () => {
        if (socket.roomId && rooms[socket.roomId]) {
            const room = rooms[socket.roomId];
            await salirDeSala(socket, room);
            socket.leave(socket.roomId);
            delete socket.roomId;
            emitirSalasPublicas();
        }
    });

    socket.on('disconnect', async () => {
        if (socket.roomId && rooms[socket.roomId]) {
            const room = rooms[socket.roomId];
            await salirDeSala(socket, room);
            emitirSalasPublicas();
        }
    });
});

server.listen(3000, () => {
    console.log('Servidor WinOrbs corriendo en http://localhost:3000');
});
