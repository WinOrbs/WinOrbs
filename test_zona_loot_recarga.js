// ============================================================================
// test_zona_loot_recarga.js — Verificación de:
//   1. Recarga manual (tecla R / botón móvil): ~2.5 s, SIN auto-recarga,
//      disparo bloqueado mientras recarga, ignora cargador lleno.
//   2. Zona segura progresiva: radio inicial 3600, cierre toda la partida,
//      fases + DPS expuestos en gameState.
//   3. Botiquines: siembra inicial (3) y tope de 6 en mapa.
//   4. Botín de airdrop + recarga del Lanza-Orbes: contrato del código fuente
//      (el botín real depende de posición/tiempo, no es determinista por red).
//
// Uso: 1) node server.js   2) node test_zona_loot_recarga.js
// ============================================================================
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');
try { require('dotenv').config(); } catch (e) { /* dotenv opcional */ }
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const URL = 'http://localhost:3000';
const ROOM = 'rzl_' + Date.now();

// Estado de juego de P1: variable de MÓDULO para que run() y parte2() compartan
// la MISMA referencia (se reasigna con cada gameState entrante).
let s1 = null;

const results = [];
function log(msg, ok = true) { results.push({ msg, ok }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${msg}`); }
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function mkSocket() { return io(URL, { timeout: 5000, reconnection: false, autoConnect: false }); }

async function run() {
    const admin = mkSocket();
    const p1 = mkSocket();
    const p2 = mkSocket();

    let roomsList = [];
    let started = false;
    admin.on('roomsList', d => roomsList = d);
    p1.on('gameState', s => s1 = s);
    p1.on('gameStarted', () => started = true);
    // Trazas de errores del servidor (rechazos de join/auth/crear sala)
    [admin, p1, p2].forEach(s => s.on('errorMsg', msg =>
        console.log(`  [errorMsg] ${msg}`)));
    [admin, p1, p2].forEach(s => s.on('connect_error', err =>
        console.log(`  [connect_error] ${err && err.message}`)));

    admin.connect();
    await wait(400);
    admin.emit('adminAuth', { password: ADMIN_PASSWORD });
    await wait(300);

    // Sala GRATIS de prueba (las automáticas exigen cuenta verificada)
    admin.emit('adminCreateRoom', { id: ROOM, nombre: 'Zona/Loot/Recarga', maxJugadores: 4, esPrivada: false, precioEntrada: 0 });
    await wait(900); // margen para el broadcast de roomsList
    log(`Sala gratuita de prueba creada (${ROOM})`, roomsList.some(r => r.id === ROOM));

    p1.connect(); p2.connect();
    await wait(200);
    // nick vacío: sanitizeNick los llama 'Mercenario' y, al ser clave vacía,
    // joinRoom OMITE la lectura de apodos/{nick} en Firestore (el SDK usa gRPC,
    // que puede quedarse colgado sin salida a internet y bloquearía el join).
    p1.emit('joinRoom', { roomId: ROOM, password: '', nick: '', skin: {} });
    p2.emit('joinRoom', { roomId: ROOM, password: '', nick: '', skin: {} });
    await wait(1500);

    // Arranque manual (sin esperar el contador de espera de 30 s)
    admin.emit('startGame', { roomId: ROOM });
    await wait(6500); // countdown 5 s + margen
    log(`Partida iniciada (gameStarted=${s1 && s1.gameStarted})`, started && s1 && s1.gameStarted);

    const meId = p1.id;
    const m = () => (s1 && s1.players && s1.players[meId]) || null;
    log('Estado del jugador P1 disponible', !!m());

    // Si el gameState nunca llegó (servidor caído / sala no creada), salir limpio
    if (!s1 || !s1.gameStarted) {
        log('gameState NO recibido o partida no iniciada: no se puede continuar', false);
        admin.emit('adminDestroyRoom', { roomId: ROOM });
        await wait(300);
        [admin, p1, p2].forEach(s => s.disconnect());
        const fallos = results.filter(r => !r.ok);
        console.log(`\n=== ZONA/LOOT/RECARGA: ${results.length - fallos.length}/${results.length} pruebas OK ===`);
        process.exit(1);
    }

    // ── 1. BOTIQUINES: siembra inicial ──
    const kits0 = (s1.healthKits || []).length;
    log(`Botiquines sembrados al iniciar la partida (${kits0} >= 3)`, kits0 >= 3);

    // ── 2. ZONA: radio inicial y cierre progresivo ──
    const r0 = s1.zoneRadius;
    log(`Radio inicial de zona = ${r0} (3600 cubre las esquinas del mapa)`, r0 > 3500 && r0 <= 3600);
    await wait(8000);
    const r1 = s1.zoneRadius;
    log(`La zona SE REDUCE con el tiempo (${Math.round(r0)} → ${Math.round(r1)} px)`, r1 < r0 - 80);
    log(`zoneShrinking=true durante el cierre`, s1.zoneShrinking === true);
    log(`Fase y daño de zona expuestos (fase=${s1.zoneFase}, dps=${s1.zoneDps})`, s1.zoneFase === 0 && s1.zoneDps === 4);

    // ── FIN PARTE 1 ──
    await parte2(p1, admin, m);

    // Limpieza
    admin.emit('adminDestroyRoom', { roomId: ROOM });
    await wait(300);
    [admin, p1, p2].forEach(s => s.disconnect());

    const fallos = results.filter(r => !r.ok);
    console.log(`\n=== ZONA/LOOT/RECARGA: ${results.length - fallos.length}/${results.length} pruebas OK ===`);
    process.exit(fallos.length ? 1 : 0);
}

async function parte2(p1, admin, m) {
    // ── 3. RECARGA: disparar hasta vaciar el cargador (cadencia 120 ms) ──
    for (let i = 0; i < 8; i++) { p1.emit('playerShoot', { angle: 0 }); await wait(150); }
    const ammoVacio = m().ammo;
    log(`Cargador agotado tras disparar (ammo=${ammoVacio})`, ammoVacio === 0);

    // SIN auto-recarga: 1.2 s después el cargador sigue a 0 y no recarga solo
    await wait(1200);
    log(`SIN auto-recarga: ammo=${m().ammo} e isReloading=${m().isReloading}`,
        m().ammo === 0 && m().isReloading === false);

    // Recarga manual → isReloading true y disparo bloqueado
    p1.emit('playerReload');
    await wait(250);
    log(`Recarga iniciada con R (isReloading=${m().isReloading})`, m().isReloading === true);
    p1.emit('playerShoot', { angle: 0 });
    await wait(150);
    log(`Disparo bloqueado mientras recarga (ammo=${m().ammo})`, m().ammo === 0);

    // La recarga son 150 ticks del bucle de ~60 fps; bajo carga el reloj real
    // puede alargarse, así que se SONDEA hasta 10 s en vez de esperar fijo.
    let completada = false;
    for (let i = 0; i < 50 && !completada; i++) {
        await wait(200);
        completada = m().ammo === 7 && m().isReloading === false;
    }
    log(`Recarga completada: ammo=${m().ammo}/7 e isReloading=${m().isReloading}`,
        m().ammo === 7 && m().isReloading === false);

    // Con el cargador lleno, R no arranca otra recarga
    p1.emit('playerReload');
    await wait(300);
    log(`Recarga con cargador lleno ignorada (isReloading=${m().isReloading})`, m().isReloading === false);

    // ── 4. ARMA 2 sin Lanza-Orbes: bloqueada ──
    p1.emit('switchWeapon', 2);
    await wait(250);
    log(`Arma 2 bloqueada sin Lanza-Orbes (currentWeapon=${m().currentWeapon})`, m().currentWeapon === 1);

    // ── 5. Reposición: tope de botiquines en el mapa ──
    log(`Tope de botiquines respetado (${(s1.healthKits || []).length} <= 6)`, (s1.healthKits || []).length <= 6);

    // ── 6. Contrato del botín de airdrop y del Lanza-Orbes (código fuente) ──
    // El botín real depende de la posición del jugador y del airdrop (cae cada
    // 45 s + alcance de bala ~990 px): no es determinista por red, así que se
    // verifica el contrato del servidor en el código fuente.
    const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    log('openAirdrop suelta 5 orbes ×25 SIEMPRE',
        /for \(let i = 0; i < 5; i\+\+\)/.test(src) && /val: 25,/.test(src));
    log('Botín: botiquín 65% y Lanza-Orbes 35%',
        src.includes('KIT_LOOT_PROB = 0.65') && src.includes('ORBGUN_LOOT_PROB = 0.35'));
    log('openAirdrop puede soltar el Lanza-Orbes (droppedOrbGuns.push)',
        /droppedOrbGuns\.push\(/.test(src));
    log('Recarga del Lanza-Orbes cuesta 25 gemas NO aseguradas AL COMPLETAR',
        src.includes('RECARGA_ORBES_COSTE = 25') && /p\.charge -= RECARGA_ORBES_COSTE/.test(src));
    log('Recarga temporizada de 150 ticks (~2.5 s)',
        src.includes('RELOAD_TICKS = 150') && src.includes('p.reloadTimer = RELOAD_TICKS'));
    log('Recoger Lanza-Orbes del suelo da arma 2 con cargador lleno',
        /droppedOrbGuns\[i\][\s\S]{0,400}p\.ammo2 = p\.maxAmmo2;/.test(src));
    log('getState expone droppedOrbGuns / zoneFase / zoneDps',
        src.includes('droppedOrbGuns: this.droppedOrbGuns') &&
        src.includes('zoneFase: this.zoneFase') &&
        src.includes('zoneDps: this.zoneDps'));
    log('Botiquines reposicionados con spawnPoint (evita muros/obstáculos)',
        /generateHealthKit\(\)[\s\S]{0,300}this\.spawnPoint\(\)/.test(src));
    log('Daño de zona por fase en HP/s (no 1 HP/tick)',
        /p\.hp -= \(this\.zoneDps \|\| ZONA_DPS\[0\]\) \/ 60;/.test(src));
}

run().catch(e => { console.error(e); process.exit(1); });
