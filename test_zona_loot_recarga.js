// ============================================================================
// test_zona_loot_recarga.js — Verificación de:
//   1. Recarga manual (tecla R / botón móvil): ~2.5 s, SIN auto-recarga,
//      disparo bloqueado mientras recarga, ignora cargador lleno.
//      Cargador de la Pistola Base = 15 balas (PISTOLA_MAX_AMMO).
//   2. Zona segura battle royale: el mapa es zona segura durante casi toda la
//      partida (el círculo arranca cubriendo las esquinas y NO se reduce), y el
//      cierre ocurre sólo en los últimos 40 s (ZONA_CIERRE_T) avisando a falta
//      de 70 s (ZONA_AVISO_T) dónde caerá la zona final (zoneNext).
//      Fases + DPS expuestos y centro MÓVIL (zoneCx/zoneCy).
//   3. Tiendas itinerantes: 3 casetas con cuenta atrás que se reubican al agotar
//      su vida (~15 s) dentro de la zona segura.
//   4. Obstáculos tipados: rocas + coches/motos/barriles explosivos y muros finos.
//   5. Botiquines: siembra inicial (3) y tope de 6 en mapa.
//   6. Botín de airdrop + recarga del Lanza-Orbes: contrato del código fuente
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

    // ── 2. ZONA battle royale: NO se cierra hasta los últimos 40 s ──
    const rInicial = Math.ceil(s1.mapSize / 2 * 1.4142);
    const r0 = s1.zoneRadius;
    log(`Radio inicial de zona = ${r0} (cubre las esquinas del mapa: ${Math.round(s1.mapSize / 2 * Math.SQRT2)})`,
        Math.abs(r0 - rInicial) <= 1);
    await wait(8000);
    const r1 = s1.zoneRadius;
    log(`La zona NO se reduce durante la partida (${Math.round(r0)} → ${Math.round(r1)} px)`,
        Math.abs(r1 - r0) < 1);
    log(`zoneShrinking=false fuera de la ventana de cierre`, s1.zoneShrinking === false);
    log(`Fase y daño de zona expuestos (fase=${s1.zoneFase}, dps=${s1.zoneDps})`, s1.zoneFase === 0 && s1.zoneDps === 4);

    // ── 3. ZONA MÓVIL: el círculo se cierra en un lugar ALEATORIO ──
    log(`gameState expone el centro móvil (zoneCx=${Math.round(s1.zoneCx)}, zoneCy=${Math.round(s1.zoneCy)})`,
        Number.isFinite(s1.zoneCx) && Number.isFinite(s1.zoneCy));
    log('El centro de la zona cae dentro del mapa con margen (nunca pegado al borde)',
        s1.zoneCx >= 400 && s1.zoneCx <= 4600 && s1.zoneCy >= 400 && s1.zoneCy <= 4600);
    log('Sin zona final marcada todavía (zoneNext se revela a falta de ZONA_AVISO_T = 70 s)',
        s1.zoneNext === null || s1.zoneNext === undefined);

    // ── 4. TIENDAS ITINERANTES: 3 casetas con cuenta atrás que se reubican ──
    const tiendas0 = (s1.shopZones || []).map(s => ({ x: s.x, y: s.y, life: s.life, maxLife: s.maxLife }));
    log(`Tiendas itinerantes: ${tiendas0.length} casetas con cuenta atrás (antes 6 fijas)`, tiendas0.length === 3);
    log('Cada tienda lleva su vida y su tope (life/maxLife)',
        tiendas0.every(t => Number.isFinite(t.life) && Number.isFinite(t.maxLife)) &&
        tiendas0.some(t => t.life < t.maxLife));
    // La caseta con desfase 300 salta a los ~5 s; se sondea hasta 25 s (bajo carga
    // el bucle de 60 fps puede tardar más en consumir 300 ticks).
    let salto = false;
    for (let i = 0; i < 125 && !salto; i++) {
        await wait(200);
        salto = (s1.shopZones || []).some((s, j) =>
            tiendas0[j] && Math.hypot(s.x - tiendas0[j].x, s.y - tiendas0[j].y) > 50);
    }
    log('Una tienda SE REUBICA al agotar su vida (~15 s, desfases escalonados)', salto);

    // ── 5. CAMPO DE OBSTÁCULOS: rocas + explosivos tipados ──
    const tipos = {};
    (s1.obstacles || []).forEach(o => {
        const t = o.tipo || 'sin-tipo';
        tipos[t] = (tipos[t] || 0) + 1;
    });
    log(`Obstáculos por tipo (${JSON.stringify(tipos)})`,
        tipos.roca > 0 && tipos.coche > 0 && tipos.moto > 0 && tipos.barril > 0);
    log('Los obstáculos conservan el contrato de colisión (x, y, w, h, hp, maxHp)',
        (s1.obstacles || []).every(o => ['x', 'y', 'w', 'h', 'hp', 'maxHp'].every(k => Number.isFinite(o[k]))));

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
    // ── 6. RECARGA: vaciar el cargador de la Pistola Base (15 balas, cadencia 120 ms).
    // Se dispara 16 veces: las 15 primeras gastan el cargador y la última confirma
    // que con el cargador vacío no se dispara.
    for (let i = 0; i < 16; i++) { p1.emit('playerShoot', { angle: 0 }); await wait(150); }
    const ammoVacio = m().ammo;
    log(`Cargador de 15 balas agotado tras disparar (ammo=${ammoVacio})`, ammoVacio === 0);

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
        completada = m().ammo === 15 && m().isReloading === false;
    }
    log(`Recarga completada: ammo=${m().ammo}/15 e isReloading=${m().isReloading}`,
        m().ammo === 15 && m().isReloading === false);

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

    // ── 11. Contratos de la zona móvil, tiendas itinerantes y obstáculos ──
    // (los cierres a los 40 s y las cadenas de barriles no son esperables en un
    // test corto: se validan por contrato del código fuente + partida manual).
    log('Cargador de la Pistola Base = 15 balas (constante única)',
        src.includes('const PISTOLA_MAX_AMMO = 15;') &&
        /ammo: PISTOLA_MAX_AMMO, maxAmmo: PISTOLA_MAX_AMMO,/.test(src));
    log('La zona se cierra en lugares ALEATORIOS (cadena de centros por fase)',
        /generarCentrosZona\(\)/.test(src) && src.includes('ZONA_CENTRO_PX_S = 200') &&
        src.includes('ZONA_MARGEN_CENTRO = 400') && src.includes('(rPrev - fase.r) * 0.7'));

    // El cierre debe CABER en su ventana: si el tope por segundo fuese menor que lo
    // que pide la interpolación, la zona nunca alcanzaría su radio final.
    const numOf = (re) => Number((src.match(re) || [])[1]);
    const mapSizeSrc = numOf(/const MAP_SIZE = (\d+)/);
    const cierreT = numOf(/ZONA_CIERRE_T = (\d+)/);
    const rIniSrc = Math.ceil(mapSizeSrc / 2 * 1.4142);
    const rFinSrc = numOf(/ZONA_RADIO_FINAL = (\d+)/);
    const capCierre = numOf(/ZONA_CIERRE_PX_S = (\d+)/);
    const capCentro = numOf(/ZONA_CENTRO_PX_S = (\d+)/);
    const fasesSrc = [...src.matchAll(/\{ t: (ZONA_CIERRE_T|\d+),\s+r: (ZONA_RADIO_INICIAL|ZONA_RADIO_FINAL|\d+) \}/g)]
        .map(mm => ({
            t: mm[1] === 'ZONA_CIERRE_T' ? cierreT : Number(mm[1]),
            r: mm[2] === 'ZONA_RADIO_INICIAL' ? rIniSrc : mm[2] === 'ZONA_RADIO_FINAL' ? rFinSrc : Number(mm[2])
        }));
    let picoRadio = 0, picoCentro = 0;
    for (let i = 0; i < fasesSrc.length - 1; i++) {
        const dt = (fasesSrc[i].t - fasesSrc[i + 1].t) || 1;
        picoRadio = Math.max(picoRadio, (fasesSrc[i].r - fasesSrc[i + 1].r) / dt);
        picoCentro = Math.max(picoCentro, 0.7 * (fasesSrc[i].r - fasesSrc[i + 1].r) / dt);
    }
    log(`Ventana de cierre: ${fasesSrc.length} fases, de ${fasesSrc.length ? fasesSrc[0].t : '?'}s a 0, radio final ${rFinSrc}`,
        fasesSrc.length === 5 && fasesSrc[0].t === cierreT && fasesSrc[fasesSrc.length - 1].r === rFinSrc);
    log(`El tope de cierre (${capCierre} px/s) cubre el pico de la interpolación (${Math.ceil(picoRadio)} px/s)`,
        capCierre >= picoRadio);
    log(`El tope de deriva del centro (${capCentro} px/s) cubre su pico (${Math.ceil(picoCentro)} px/s)`,
        capCentro >= picoCentro);
    log('Cierre battle royale: sólo en los últimos 40 s y con aviso de la zona final a falta de 70 s',
        src.includes('ZONA_CIERRE_T = 40') && src.includes('ZONA_AVISO_T = 70') &&
        src.includes('ZONA_RADIO_FINAL = 280') &&
        src.includes('this.gameTime === ZONA_AVISO_T') &&
        src.includes('this.gameTime === ZONA_CIERRE_T') &&
        src.includes('NUEVA ZONA MARCADA EN EL MAPA') &&
        src.includes('¡LA ZONA EMPIEZA A CERRARSE!') &&
        /zoneNext = \{ x: fin\.x, y: fin\.y, radius: ZONA_RADIO_FINAL \}/.test(src) &&
        /\{ t: ZONA_CIERRE_T, r: ZONA_RADIO_INICIAL \}/.test(src) &&
        !src.includes('ZONA_ALERTA_FINAL_T'));
    log('El daño fuera de zona usa el centro MÓVIL (no MAP_SIZE/2)',
        src.includes('Math.hypot(p.x - this.zoneCx, p.y - this.zoneCy)') &&
        !src.includes('Math.hypot(p.x - MAP_SIZE / 2, p.y - MAP_SIZE / 2)'));
    log('getState expone zoneCx / zoneCy / zoneNext',
        src.includes('zoneCx: this.zoneCx') && src.includes('zoneCy: this.zoneCy') &&
        src.includes('zoneNext: this.zoneNext'));
    log('Tiendas itinerantes: 3 casetas con vida (~15 s) que se reubican al agotarse',
        src.includes('const TIENDA_NUM = 3') && src.includes('TIENDA_VIDA_TICKS = 900') &&
        src.includes('TIENDA_DESFASES = [900, 600, 300]') &&
        /moverTienda\(i\) \{/.test(src) && /if \(t\.life <= 0\) this\.moverTienda\(i\);/.test(src));
    log('Las tiendas se sortean dentro de la zona segura (y resetForLobby las regenera)',
        /this\.shopZones = this\.generarTiendas\(\);/.test(src) &&
        src.includes('zona - TIENDA_RADIO - 60'));
    log('Obstáculos tipados con hp por tipo (roca/coche/moto/barril)',
        src.includes("{ tipo: 'coche',  n: 6,  ancho: [70, 70],  alto: [44, 44] }") &&
        src.includes("coche:  { radio: 150, dano: 45, hp: 36 }") &&
        src.includes("barril: { radio: 130, dano: 40, hp: 12 }"));
    log('Balas: dañan coche/moto/barril (−6) pero atraviesan las rocas',
        /obs\.hp <= 0 \|\| !obs\.tipo \|\| obs\.tipo === 'roca'\) continue;/.test(src) &&
        src.includes('this.explotarObstaculo(obs, b.ownerId)'));
    log('Barriles con reacción en cadena por cola (sin recursión)',
        src.includes('this.explosionChain = []') &&
        /this\.explosionChain\.push\(\{ obs: o, ownerId, ticks: BARRIL_CADENA_TICKS \}\)/.test(src) &&
        /explosionChain\.splice\(i, 1\);\s*\n\s*this\.explotarObstaculo\(e\.obs, e\.ownerId\);/.test(src));
    log('Coche suelta 2 orbes ×10 y la moto da turbo al que la revienta',
        src.includes('COCHE_ORBES = 2') && src.includes('COCHE_ORBE_VAL = 10') &&
        src.includes('MOTO_TURBO_TICKS = 120') && src.includes('p.turboTimer = MOTO_TURBO_TICKS'));
    log('explodeBomb hace estallar los explosivos alcanzados (rocas siguen en silencio)',
        /if \(obs\.tipo && obs\.tipo !== 'roca'\) destruidos\.push\(obs\);/.test(src));
    log('Muros finos de 3 balas (14 px, hp 15) con esquema simétrico',
        /hp: 15, maxHp: 15, tipo: 'fino'/.test(src) && src.includes("const vertical = Math.random() < 0.5;"));
    log('Cliente: obstáculos por tipo, anillo de tienda y marcador de zona final',
        fs.readFileSync(path.join(__dirname, 'public', 'game.html'), 'utf8')
            .match(/coche: \{ src: 'assets\/game\/car\.png' \}/) !== null &&
        fs.readFileSync(path.join(__dirname, 'public', 'game.html'), 'utf8').includes('ZONA FINAL') &&
        fs.readFileSync(path.join(__dirname, 'public', 'game.html'), 'utf8').includes('sz.life / sz.maxLife'));
}

run().catch(e => { console.error(e); process.exit(1); });
