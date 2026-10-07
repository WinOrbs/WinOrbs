// Test del recorte de estado RED (Fases 1 y 2 de ancho de banda).
// Comprueba dos cosas que se pueden romper en silencio y costaría caro:
//   1) getState() NO debe filtrar campos internos/sensibles de los jugadores
//      (uid de Firebase, inputs crudos, marcas de anti-spam…).
//   2) getState() SÍ debe seguir entregando todos los campos que game.html
//      usa de verdad: podar de más rompe el juego en el cliente.
// Sigue el patrón de la casa (check/OK-FAIL). Ejecutar: node tests/test_red.js
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const out = [];
let fallos = 0;
function check(nombre, cond) {
    out.push((cond ? 'OK  - ' : 'FAIL - ') + nombre);
    console.log(out[out.length - 1]);
    if (!cond) fallos++;
}

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const socketServer = fs.readFileSync(path.join(__dirname, '..', 'apps/server/realtime/socket_server.js'), 'utf8');
const configDefaults = fs.readFileSync(path.join(__dirname, '..', 'apps/server/config/defaults.js'), 'utf8');
const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'game.html'), 'utf8');

// ── 1) Extraer jugadoresRed() y montarlo como método con `this` controlado ──
// El corte va justo antes de emitirConfig(), el siguiente método de la clase:
// antes el slice llegaba hasta getState() y arrastraba los métodos de roomConfig,
// que al compilarlos dentro de una función suelta rompían el test.
const ini = server.indexOf('    jugadoresRed() {');
const fin = server.indexOf('    emitirConfig(', ini);
assert.ok(ini > 0 && fin > ini, 'No se encontró jugadoresRed() en server.js');
const metodo = server.slice(ini, fin);
// Solo el CUERPO del método: la firma ('jugadoresRed() {') no va dentro de la
// función envoltorio o el Function() no compila.
const cuerpo = metodo.slice(metodo.indexOf('{') + 1, metodo.lastIndexOf('}'));
const jugadoresRed = new Function('return function () {' + cuerpo + '\n}')();

const p = {
    id: 'p1', nick: 'Ana', uid: 'UID_FIREBASE_SECRETO',
    skin: { c1: '#fff', imagenUrl: 'https://x/y.png' },
    x: 1234.56, y: 2345.67, angle: 1.23456,
    hp: 80, maxHp: 100, shield: 20, maxShield: 50,
    charge: 33, bankedScore: 99, eliminations: 4, radius: 22, speed: 5.5,
    inputs: { w: true, a: false, s: false, d: false, angle: 1.2 },
    isDead: false, respawnTimer: 0, canRespawn: false,
    currentWeapon: 1, ammo: 12, maxAmmo: 15, bombs: 2, hasOrbGun: false,
    ammo2: 3, maxAmmo2: 3, isReloading: false, reloadTimer: 0, reloadWeapon: 2,
    isExtracting: false, dashProgress: 100, dashCooldown: 12, isDashing: false,
    lastShotAt: 1712345678901, turboTimer: 0, turboCooldown: 90
};
const R = { players: { p1: p } };
const salida = jugadoresRed.call(R);
const j = salida.p1;

check('devuelve una entrada por jugador', Object.keys(salida).length === 1);
check('conserva la clave del socket (el cliente busca por su playerId)', !!salida.p1);

// ── 2) Campos que NO deben viajar (privados, internos o sensibles) ──
const NO_DEBEN = ['uid', 'inputs', 'lastShotAt', 'speed',
    'dashCooldown', 'turboCooldown', 'reloadWeapon'];
for (const campo of NO_DEBEN) {
    check(`no filtra '${campo}'`, j[campo] === undefined);
}
check('el texto del código no vuelve a poner players: this.players en getState()',
    !/players:\s*this\.players/.test(server.slice(server.indexOf('    getState() {'))));
check('el UID de ejemplo no aparece en la salida',
    !JSON.stringify(salida).includes('UID_FIREBASE_SECRETO'));

// ── 3) Campos que SÍ debe seguir viajando (los usa game.html) ──
const NECESARIOS = ['id', 'nick', 'x', 'y', 'angle', 'radius', 'skin',
    'hp', 'maxHp', 'shield', 'maxShield', 'charge', 'bankedScore', 'eliminations',
    'isDead', 'respawnTimer', 'canRespawn', 'currentWeapon',
    'ammo', 'maxAmmo', 'ammo2', 'maxAmmo2', 'bombs', 'hasOrbGun',
    'isReloading', 'reloadTimer', 'isExtracting', 'dashProgress',
    'isDashing', 'turboTimer'];
const faltan = NECESARIOS.filter(c => j[c] === undefined);
check(`conserva los ${NECESARIOS.length} campos que el cliente usa (faltan: ${faltan.join(', ') || 'ninguno'})`,
    faltan.length === 0);

// ── 4) El modelo interno NO se toca: economy/anti-spam siguen intactos ──
check('no muta el jugador original (uid sigue en el modelo interno)', p.uid === 'UID_FIREBASE_SECRETO');
check('no muta las coordenadas internas (sin redondeo in-place)',
    p.x === 1234.56 && p.y === 2345.67);
check('el recorte produce un objeto nuevo, no una referencia', j !== p);
check('las coordenadas del recorte van redondeadas (menos bytes)',
    j.x === 1235 && j.y === 2346);

// ── 5) La clasificación mantiene puntos y desempata con eliminaciones ──
const iniLeaderboard = server.indexOf('    getLeaderboard() {');
const finLeaderboard = server.indexOf('\n    // ─ Versión RED', iniLeaderboard);
assert.ok(iniLeaderboard > 0 && finLeaderboard > iniLeaderboard, 'No se encontró getLeaderboard()');
const leaderboardBody = server.slice(iniLeaderboard, finLeaderboard);
const getLeaderboard = new Function('return function () {' +
    leaderboardBody.slice(leaderboardBody.indexOf('{') + 1, leaderboardBody.lastIndexOf('}')) +
    '\n}')();
const ranked = getLeaderboard.call({
    players: {
        scoreLeader: { bankedScore: 120, eliminations: 0 },
        tieFewerKills: { bankedScore: 100, eliminations: 1 },
        tieMoreKills: { bankedScore: 100, eliminations: 3 }
    }
});
check('puntos asegurados siguen siendo el criterio principal',
    ranked[0].bankedScore === 120);
check('las eliminaciones resuelven empates de puntos',
    ranked[1].eliminations === 3 && ranked[2].eliminations === 1);

// ── 6) Fase 2: simulación 60 Hz, emisión 30 Hz ──
check('la constante de emisión viene de configuración central',
    /const TICK_EMITIR_CADA = config\.timing\.ticksPerEmission/.test(server) &&
    /ticksPerEmission:\s*2/.test(configDefaults));
check('update() se sigue llamando ANTES de decidir si se emite (simulación a 60 Hz)',
    /this\.update\(\);[\s\S]{0,400}this\.tick\+\+/.test(server));
check('el intervalo reduce estados a 1 Hz fuera de partida y mantiene 30 Hz en juego',
    /const ticksPerEmission = this\.gameStarted \? TICK_EMITIR_CADA : 60;/.test(server) &&
    /this\.tick % ticksPerEmission !== 0\) return;/.test(server));
check('sigue usando volatile (no encola estados atrasados)',
    /volatile\.emit\('gameState'/.test(server));
check('las salas en espera no ejecutan la simulación',
    /if \(this\.gameStarted\) this\.update\(\);/.test(server));
check('Socket.IO conserva la sesión para recuperarse de cortes breves',
    /socketConfig = SOCKET_IO_DEFAULTS/.test(socketServer) &&
    /maxDisconnectionDuration:\s*120_000/.test(configDefaults));
check('una desconexión transitoria conserva el asiento durante la ventana de recuperación',
    /player\.disconnectTimer = setTimeout\(async \(\) => \{[\s\S]*DISCONNECT_GRACE_MS/.test(server));
// La simulación debe seguir a 60 Hz: se mide sobre el bloque de startLoop
// entero (no un rango fijo de caracteres, que se rompe al editar los
// comentarios de dentro). El bloque acaba donde empieza el setInterval del
// timerInterval, que va justo detrás.
const iniLoop = server.indexOf('    startLoop() {');
const finLoop = server.indexOf('        this.timerInterval = setInterval(', iniLoop);
const cuerpoLoop = server.slice(iniLoop, finLoop > 0 ? finLoop : iniLoop + 3000);
check('la simulación sigue a 60 Hz (update dentro de un setInterval de 1000/60)',
    /setInterval\(\(\) => \{[\s\S]*?this\.update\(\);[\s\S]*?\}, 1000 \/ 60\);/.test(cuerpoLoop));
check('la emisión va por debajo de la simulación (30 Hz < 60 Hz)',
    /this\.update\(\);[\s\S]*this\.tick\+\+;[\s\S]*volatile\.emit\('gameState'/.test(cuerpoLoop));
check('TICK_EMITIR_CADA divide 2 → 30 Hz de emisión',
    /TICK_EMITIR_CADA = config\.timing\.ticksPerEmission/.test(server) &&
    /ticksPerEmission:\s*2/.test(configDefaults));

// ── 7) El estado de juego se mantiene a 30 Hz ──
const dibujaCrudo = /ctx\.arc\(p\.x, p\.y/.test(game);
check('el cliente dibuja posiciones del estado, emitido a 30 Hz durante la partida',
    dibujaCrudo && /emisión a 30 Hz/.test(server));

// ── 8) roomConfig: la geometría viaja una vez, no en cada gameState ──
// El mapa NO es estático (muros/obstáculos se destruyen, tiendas se reubican),
// así que lo que se separa es la GEOMETRÍA; el hp sigue en cada gameState.
const cuerpoGetState = server.slice(server.indexOf('    getState() {'));
check('existe el flag de reversión ROOMCONFIG_V2', /const ROOMCONFIG_V2 = (true|false);/.test(server));
check('configEstatica() existe y manda geometría sin hp',
    /configEstatica\(\)\s*\{/.test(server) && !/configEstatica\(\)\s*\{[\s\S]{0,600}?hp:/.test(server));
check('la geometría se manda en el evento roomConfig',
    /emit\('roomConfig'/.test(server));
// El comentario de contexto ocupa 3 líneas, así que la ventana es amplia a
// propósito: lo que importa es que la llamada siga al socket.join().
check('se emite al unirse el jugador (no solo al arrancar la sala)',
    /socket\.join\(room\.id\)[\s\S]{0,400}room\.emitirConfig\(socket\)/.test(server));
check('se re-emite en reset() con la versión subida',
    /this\.configVersion = \(this\.configVersion \|\| 0\) \+ 1;[\s\S]{0,80}?this\.emitirConfig\(\)/.test(server));
check('el cliente puede pedirla si le falta (pedirConfig)',
    /socket\.on\('pedirConfig'/.test(server) && /socket\.emit\('pedirConfig'/.test(game));
// Con el flag activo, getState() NO debe reenviar la geometría como arrays.
const flagActivo = /const ROOMCONFIG_V2 = true;/.test(server);
// Con el flag activo, la rama del return NO debe reenviar los arrays: la
// geometría tiene que entrar solo por ...geo. (La rama de reversión sí los
// lleva a propósito, así que se cuenta aparte.)
const ramaEstado = cuerpoGetState.slice(
    cuerpoGetState.indexOf('const geo ='), cuerpoGetState.indexOf('return {'));
const geomEnRetorno = /obstacles:\s*this\.obstacles,/.test(
    cuerpoGetState.slice(cuerpoGetState.indexOf('return {')));
check('con el flag activo getState() usa el hp indexado, no los arrays completos',
    flagActivo
        ? /const geo = ROOMCONFIG_V2 \? this\.estadoMapa\(\)/.test(ramaEstado) && !geomEnRetorno
        : geomEnRetorno);
check('las tiendas siguen viajando completas en gameState (se reubican)',
    /shopZones:\s*this\.shopZones/.test(cuerpoGetState));
// Cliente: combina geometría + hp, y tiene salida de emergencia.
check('el cliente combina roomConfig con el hp del frame (combinarMapa)',
    /function combinarMapa\(/.test(game) && /obstaculosHp/.test(game) && /murosHp/.test(game));
const iniCombinar = game.indexOf('        function combinarMapa(');
const finCombinar = game.indexOf('\n        // Caché de imágenes', iniCombinar);
assert.ok(iniCombinar > 0 && finCombinar > iniCombinar, 'No se encontró combinarMapa()');
const combinarBody = game.slice(iniCombinar, finCombinar);
const combinarMapa = new Function('return function (geo, hp) {' +
    combinarBody.slice(combinarBody.indexOf('{') + 1, combinarBody.lastIndexOf('}')) +
    '\n}')();
const reconciledMap = combinarMapa([
    { id: 'alive', x: 10, y: 20, w: 30, h: 40, maxHp: 50 },
    { id: 'destroyed', x: 50, y: 60, w: 30, h: 40, maxHp: 50 }
], { alive: 25 });
check('omitir el id de un objeto en el estado vivo lo elimina del render',
    reconciledMap.length === 1 && reconciledMap[0].hp === 25);
check('el cliente dibuja los muros/obstáculos desde la geometría combinada',
    /muros\.forEach\(wl =>/.test(game) && /obstaculos\.forEach\(obs =>/.test(game));
check('si falta roomConfig el render cae a los arrays del gameState (no se rompe)',
    /cfgOk\s*\?.*combinarMapa/.test(game) && /\(gameState\.obstacles \|\| \[\]\)/.test(game));
check('el cliente pide la config como mucho una vez (sin bucle)',
    /configPedida = true/.test(game));
check('el HUD muestra las eliminaciones recibidas en gameState',
    /hud-kills/.test(game) && /eliminations:\s*p\.eliminations/.test(server));
check('el resultado final incluye podio y clasificación con puntuación y kills',
    /id="match-podium"/.test(game) && /id="results-list"/.test(game) &&
    /renderFinalStandings\(ranking\)/.test(game) && /player\.eliminations/.test(game));
const joystickFnStart = game.indexOf('        function actualizarTeclasJoystick(');
const joystickFnEnd = game.indexOf('\n\n        let mouseX', joystickFnStart);
assert.ok(joystickFnStart > 0 && joystickFnEnd > joystickFnStart, 'No se encontró actualizarTeclasJoystick()');
const joystickSource = game.slice(joystickFnStart, joystickFnEnd);
const actualizarTeclasJoystick = new Function('return function (dx, dy, targetKeys) {' +
    joystickSource.slice(joystickSource.indexOf('{') + 1, joystickSource.lastIndexOf('}')) +
    '\n}')();
const joystickKeys = { w: false, a: false, s: false, d: false };
actualizarTeclasJoystick(-30, 0, joystickKeys);
actualizarTeclasJoystick(30, 0, joystickKeys);
check('el joystick cambia directamente de rumbo durante el mismo toque',
    joystickKeys.d && !joystickKeys.a);
actualizarTeclasJoystick(0, 0, joystickKeys);
check('el deadzone deja el joystick neutro sin conservar rumbo previo',
    !joystickKeys.w && !joystickKeys.a && !joystickKeys.s && !joystickKeys.d);
check('Disparar vuelve a la fila inferior derecha y Recargar sigue en otra fila',
    /\.touch-btn\.shoot\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*3;/s.test(game) &&
    /#btn-reload-mobile\s*\{[^}]*grid-row:\s*2;/s.test(game));
const mobileHudStart = game.indexOf('/* HUD tactil:');
const mobileBannersStart = game.indexOf('            .extract-banner,', mobileHudStart);
check('los avisos táctiles usan mayor tipografía que el tamaño anterior',
    mobileBannersStart > mobileHudStart &&
    /font-size:\s*6px\s*!important/.test(game.slice(mobileBannersStart, mobileBannersStart + 900)));
for (const sprite of ['podium-gold.png', 'podium-silver.png', 'podium-bronze.png']) {
    const spritePath = path.join(__dirname, '..', 'public', 'assets', 'game', sprite);
    const png = fs.readFileSync(spritePath);
    check(`sprite ${sprite} existe y contiene PNG válido`,
        png.length > 24 && png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
}
check('el podio monta un sprite según la medalla del puesto',
    /podium-\$\{medal\}\.png/.test(game) && /medal: "silver"/.test(game) &&
    /medal: "gold"/.test(game) && /medal: "bronze"/.test(game));
const airdropRenderStart = game.indexOf('(gameState.airdrops || []).forEach(ad => {');
const airdropRenderEnd = game.indexOf('// Obstáculos destructibles:', airdropRenderStart);
const airdropRender = game.slice(airdropRenderStart, airdropRenderEnd);
check('el airdrop muestra paracaídas con balanceo durante el descenso',
    airdropRender.includes('canopyAlpha') &&
    airdropRender.includes('Math.sin(Date.now() / 430') &&
    airdropRender.includes('ctx.bezierCurveTo') &&
    airdropRender.includes("ctx.globalAlpha = canopyAlpha"));
check('el paracaídas desaparece al aterrizar y la caja usa sprite separado',
    /const canopyAlpha = Math\.max\(0, Math\.min\(1, \(1 - prog\) \* 7\)\)/.test(airdropRender) &&
    /drawSprite\('airdrop', ad\.x, ad\.y - drop/.test(airdropRender) &&
    airdropRender.indexOf('return;') < airdropRender.indexOf('const porCaducar'));

console.log('\n' + (fallos === 0 ? '✔ Todo correcto' : '✖ ' + fallos + ' fallo(s)'));
process.exit(fallos === 0 ? 0 : 1);
