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
    const fs = require('fs');
    const SA_PATH = process.env.FIREBASE_SERVICE_ACCOUNT || (__dirname + '/serviceAccountKey.json');
    let sa = null;
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.applicationDefault() });
        sa = true;
    } else if (fs.existsSync(SA_PATH)) {
        sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(sa),
            projectId: sa.project_id || undefined
        });
    }
    if (sa) {
        FIREBASE_DB = firebaseAdmin.firestore();
        FIREBASE_ECONOMY = true;
        console.log('[FIREBASE] Modo economía SEGURA activado (Admin SDK). El servidor maneja entradas y premios.');
    } else {
        console.log('[FIREBASE] Sin clave de servicio: modo DEGRADADO. Cobro/premio los gestiona el cliente (parches Fase 0).');
    }
} catch (e) {
    console.warn('[FIREBASE] firebase-admin no disponible:', e.message);
}

// Límites de seguridad
const MAX_SOCKETS_PER_IP = 3;          // en salas de pago
const INPUT_MIN_INTERVAL = 8;          // ms entre eventos playerInput
const SHOOT_COOLDOWN = { 1: 120, 2: 400 }; // ms por arma
const ITEM_COSTOS = { medkit: 30, shield: 50, bomb: 40, orbGun: 100 };
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
        // URL de imagen (PNG/JPG/GIF) opcional para skins compradas
        const url = String(skin.imagenUrl || '').trim();
        if (/^https:\/\/[^\s'"<>]{10,500}$/i.test(url)) out.imagenUrl = url;
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
        const nombre = String(skin.nombre || '').replace(/[<>&"'`]/g, '').trim().slice(0, 32);
        if (SKINS_BASICAS[nombre]) return { nombre, ...SKINS_BASICAS[nombre] }; // gratis
        const id = String(skin.id || '').replace(/[^\w-]/g, '').slice(0, 64);
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
        // Idempotencia: si ya pagaste entrada cobrada en esta sala recientemente, no recobrar
        const qs = await FIREBASE_DB.collection('entradas')
            .where('usuarioId', '==', uid)
            .where('salaId', '==', salaId)
            .where('estado', '==', 'cobrada')
            .limit(5).get();
        if (!qs.empty) {
            for (const doc of qs.docs) {
                const f = doc.data().fecha;
                const ts = f && f.toMillis ? f.toMillis() : 0;
                if (Date.now() - ts < 10 * 60 * 1000) {
                    return { ok: true, entradasId: doc.id, yaExistia: true };
                }
            }
        }
        return await FIREBASE_DB.runTransaction(async (t) => {
            const refP = FIREBASE_DB.collection('usuarios').doc(uid);
            const snap = await t.get(refP);
            if (!snap.exists) return { ok: false, error: 'NO_PROFILE' };
            const saldo = Number(snap.data().saldo || 0);
            if (saldo < monto) return { ok: false, error: 'SALDO_INSUFICIENTE' };
            t.update(refP, { saldo: +(saldo - monto).toFixed(2) });
            const refEnt = FIREBASE_DB.collection('entradas').doc();
            t.set(refEnt, {
                usuarioId: uid, salaId: salaId, monto: monto,
                estado: 'cobrada', fecha: firebaseAdmin.firestore.FieldValue.serverTimestamp()
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
            }
        });
    } catch (e) {
        console.warn('[FIREBASE] Reembolso fallido para ' + uid + ':', e.message);
    }
}

async function servidorPagarPremio(room, gameId) {
    if (!FIREBASE_ECONOMY || !FIREBASE_DB || !room || !gameId) return;
    try {
        const lb = room.getLeaderboard();
        const ganador = lb[0];
        if (!ganador || lb.length < 2) return; // partida sin ganador real
        const pozo = +(lb.length * room.entryFee).toFixed(2);
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
        this.bombs = [];
        this.explosions = [];
        this.bankZone = { x: MAP_SIZE / 2, y: MAP_SIZE / 2, radius: 130 };
        this.gameTime = 300;
        this.zoneRadius = MAP_SIZE * 0.7;
        this.zoneShrinking = false;

        this.shopZones = this.generateShopZones();
        this.hazardZones = [];
        this.speedPads = this.generateSpeedPads();
        this.airdrops = [];
        this.obstacles = this.generateObstacles();

        this.airdropTimer = 0;
        this.hazardTimer = 0;
        this.lobbyActive = false;
        this.gameStarted = false;
        this.countdown = 0;
        this.pendingStart = null;
        this.ending = false;

        this.initEnergy();
        this.startLoop();
    }

    generateShopZones() {
        const zones = [];
        const positions = [
            { x: 400, y: 400 },
            { x: MAP_SIZE - 400, y: 400 },
            { x: 400, y: MAP_SIZE - 400 },
            { x: MAP_SIZE - 400, y: MAP_SIZE - 400 },
            { x: MAP_SIZE / 2, y: 400 },
            { x: MAP_SIZE / 2, y: MAP_SIZE - 400 },
        ];
        positions.forEach(pos => {
            zones.push({ x: pos.x, y: pos.y, radius: 80 });
        });
        return zones;
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

    generateObstacles(count = 20) {
        const obs = [];
        for (let i = 0; i < count; i++) {
            obs.push({
                x: Math.random() * (MAP_SIZE - 300) + 150,
                y: Math.random() * (MAP_SIZE - 300) + 150,
                w: 60 + Math.random() * 60,
                h: 60 + Math.random() * 60,
                hp: 30,
                maxHp: 30
            });
        }
        return obs;
    }

    generateHealthKit() {
        this.droppedHealthKits.push({
            id: 'h_' + randID(),
            x: Math.random() * (MAP_SIZE - 200) + 100,
            y: Math.random() * (MAP_SIZE - 200) + 100,
            val: 40
        });
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
        this.players[socketId] = {
            id: socketId,
            nick: sanitizeNick(nick),
            uid: uid || null, // UID de Firebase: necesario para premios
            skin: sanitizeSkin(skin),
            x: Math.random() * (MAP_SIZE - 600) + 300,
            y: Math.random() * (MAP_SIZE - 600) + 300,
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
            ammo: 7, maxAmmo: 7,
            bombs: 0,
            hasOrbGun: false,
            isExtracting: false,
            dashProgress: 100,
            dashCooldown: 0,
            isDashing: false,
            lastShotAt: 0
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

    handleShoot(socketId, shootData) {
        const p = this.players[socketId];
        if (!p || p.isDead) return;

        // Anticheat: cooldown mínimo entre disparos por arma (mata el spam de balas)
        const ahora = Date.now();
        const cooldown = SHOOT_COOLDOWN[p.currentWeapon] || 120;
        if (ahora - (p.lastShotAt || 0) < cooldown) return;
        p.lastShotAt = ahora;

        if (p.currentWeapon === 1) {
            if (p.ammo <= 0) return;
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

    handleReload(socketId) {
        const p = this.players[socketId];
        if (!p || p.isDead || p.currentWeapon !== 1) return;
        p.ammo = p.maxAmmo;
    }

    handleSwitchWeapon(socketId, data) {
        const p = this.players[socketId];
        if (!p || p.isDead) return;

        const weaponNum = typeof data === 'number' ? data : data.weapon;
        if (weaponNum === 2 && !p.hasOrbGun) return;
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
            io.sockets.sockets.get(socketId)?.emit('errorMsg', 'No tienes suficientes gemas.');
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
        p.x = Math.random() * (MAP_SIZE - 600) + 300;
        p.y = Math.random() * (MAP_SIZE - 600) + 300;
        p.currentWeapon = 1;
        p.ammo = p.maxAmmo;
        p.canRespawn = false;
        p.respawnTimer = 0;
    }

    startLoop() {
        this.interval = setInterval(() => {
            this.update();
            io.to(this.id).emit('gameState', this.getState());
        }, 1000 / 60);

        this.timerInterval = setInterval(() => {
            if (this.gameStarted) {
                this.gameTime--;
            } else if (this.lobbyActive && this.countdown > 0) {
                this.countdown--;
                if (this.countdown <= 0) {
                    this.gameStarted = true;
                    this.lobbyActive = false;
                    io.to(this.id).emit('playSound', 'explosion');
                }
            }

            if (this.gameStarted) {
                this.updateZone();

                if (this.gameStarted && this.gameTime <= 0) {
                    this.endGame();
                }
            }

            const now = Date.now();
            const playerCount = Object.keys(this.players).length;
            if (playerCount >= 2 && !this.gameStarted && !this.lobbyActive) {
                if (!this.pendingStart) {
                    this.pendingStart = now;
                } else if (now - this.pendingStart >= 10000) {
                    this.startLobby();
                }
            } else if (playerCount < 2) {
                this.pendingStart = null;
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
        const angle = Math.random() * Math.PI * 2;
        const dist = (MAP_SIZE / 2 - 300) * 0.8;
        this.airdrops.push({
            x: MAP_SIZE / 2 + Math.cos(angle) * dist,
            y: MAP_SIZE / 2 + Math.sin(angle) * dist,
            radius: 50,
            life: 300
        });

        setTimeout(() => {
            for (let i = 0; i < 5; i++) {
                this.droppedEnergy.push({
                    id: 'e_' + randID(),
                    x: this.airdrops[0]?.x + (Math.random() - 0.5) * 200,
                    y: this.airdrops[0]?.y + (Math.random() - 0.5) * 200,
                    val: 25
                });
            }
            this.airdrops.shift();
        }, 8000);
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

    updateZone() {
        if (this.gameTime <= 60 && this.zoneRadius > 150) {
            this.zoneRadius -= 5;
            this.zoneShrinking = true;
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

    endGame() {
        if (this.ending) return;
        this.ending = true;

        const gameId = this.id + '_' + Date.now();
        const leaderboard = this.getLeaderboard();

        // Modo economía: el SERVIDOR paga el pozo (80% ganador, 20% casa) vía Admin SDK
        if (FIREBASE_ECONOMY && FIREBASE_DB) {
            servidorPagarPremio(this, gameId);
        }

        io.to(this.id).emit('gameOver', {
            gameId: gameId,
            entryFee: this.entryFee,
            leaderboard: leaderboard
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
        this.zoneRadius = MAP_SIZE * 0.7;
        this.zoneShrinking = false;
        this.bullets = [];
        this.bombs = [];
        this.explosions = [];
        this.droppedEnergy = [];
        this.droppedHealthKits = [];
        this.airdrops = [];
        this.hazardZones = [];
        this.airdropTimer = 0;
        this.hazardTimer = 0;
        this.obstacles = this.generateObstacles();
        this.ending = false;
        this.initEnergy();
    }

    update() {
        Object.values(this.players).forEach(p => {
            if (p.isDead) {
                p.respawnTimer++;
                if (p.respawnTimer >= 300) {
                    p.canRespawn = true;
                }
                return;
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

            let speed = p.speed;
            if (p.isDashing) speed *= 3;

            p.x = Math.max(p.radius, Math.min(MAP_SIZE - p.radius, p.x + moveX * speed));
            p.y = Math.max(p.radius, Math.min(MAP_SIZE - p.radius, p.y + moveY * speed));

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

            for (let i = this.droppedHealthKits.length - 1; i >= 0; i--) {
                let h = this.droppedHealthKits[i];
                if (Math.hypot(p.x - h.x, p.y - h.y) < p.radius + 10) {
                    p.hp = Math.min(p.maxHp, p.hp + h.val);
                    io.to(this.id).emit('playSound', 'pickup');
                    this.droppedHealthKits.splice(i, 1);
                }
            }

            if (this.gameStarted && this.zoneShrinking) {
                const distToCenter = Math.hypot(p.x - MAP_SIZE / 2, p.y - MAP_SIZE / 2);
                if (distToCenter > this.zoneRadius + p.radius && p.isDead === false) {
                    p.hp -= 1;
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

        for (let i = this.droppedHealthKits.length - 1; i >= 0; i--) {
            this.droppedHealthKits[i].life = (this.droppedHealthKits[i].life || 600) - 1;
            if (this.droppedHealthKits[i].life <= 0) {
                this.droppedHealthKits.splice(i, 1);
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

            if (hit) {
                this.bullets.splice(i, 1);
            }
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

        this.obstacles = this.obstacles.filter(obs => {
            const dist = Math.hypot(obs.x - bomb.currentX, obs.y - bomb.currentY);
            if (dist < 150) {
                obs.hp -= 50;
                return obs.hp > 0;
            }
            return true;
        });
    }

    getSummary() {
        return {
            id: this.id,
            nombre: this.name,
            maxJugadores: this.maxPlayers,
            jugadoresConectados: Object.keys(this.players).length,
            precioEntrada: this.entryFee,
            pozoActual: Object.keys(this.players).length * this.entryFee,
            esPrivada: this.isPrivate
        };
    }

    getLeaderboard() {
        return Object.values(this.players).sort((a, b) => b.bankedScore - a.bankedScore);
    }

    getState() {
        return {
            players: this.players,
            bullets: this.bullets,
            droppedEnergy: this.droppedEnergy,
            healthKits: this.droppedHealthKits,
            bankZone: this.bankZone,
            gameTime: this.gameTime,
            zoneRadius: this.zoneRadius,
            zoneShrinking: this.zoneShrinking,
            mapSize: MAP_SIZE,
            shopZones: this.shopZones,
            hazardZones: this.hazardZones,
            speedPads: this.speedPads,
            airdrops: this.airdrops,
            obstacles: this.obstacles,
            bombs: this.bombs,
            explosions: this.explosions,
            lobbyActive: this.lobbyActive,
            countdown: this.countdown,
            gameStarted: this.gameStarted,
            maxPlayers: this.maxPlayers,
            entryFee: this.entryFee
        };
    }
}

// Inicializar salas por defecto
rooms["sala_1"] = new GameRoom("sala_1", "Arena Principiantes", 6, 1.00, false);
rooms["sala_2"] = new GameRoom("sala_2", "Liga Pro High Roller", 4, 5.00, false);
rooms["sala_vip"] = new GameRoom("sala_vip", "Privada VIP", 4, 10.00, true, "1234");

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
    if (FIREBASE_ECONOMY && !room.gameStarted && p.pagoEntrada) {
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

            // Reembolsar entradas si la partida aún no empezó (modo economía)
            if (FIREBASE_ECONOMY && !room.gameStarted) {
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
        room.addPlayer(socket.id, nick, skinValidada, socket.verifiedUid || (typeof uid === 'string' ? uid.slice(0, 128) : null));
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
