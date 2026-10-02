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
const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'game.html'), 'utf8');

// ── 1) Extraer jugadoresRed() y montarlo como método con `this` controlado ──
const ini = server.indexOf('    jugadoresRed() {');
const fin = server.indexOf('    getState() {');
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
    charge: 33, bankedScore: 99, radius: 22, speed: 5.5,
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
    'hp', 'maxHp', 'shield', 'maxShield', 'charge', 'bankedScore',
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

// ── 5) Fase 2: simulación 60 Hz, emisión 30 Hz ──
check('la constante de emisión existe', /const TICK_EMITIR_CADA = \d+;/.test(server));
check('update() se sigue llamando ANTES de decidir si se emite (simulación a 60 Hz)',
    /this\.update\(\);[\s\S]{0,400}this\.tick\+\+/.test(server));
check('la emisión se salta los ticks que no tocan turno',
    /this\.tick % TICK_EMITIR_CADA !== 0\) return;/.test(server));
check('sigue usando volatile (no encola estados atrasados)',
    /volatile\.emit\('gameState'/.test(server));
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
check('TICK_EMITIR_CADA divide 2 → 30 Hz de emisión', /TICK_EMITIR_CADA = 2;/.test(server));

// ── 6) El cliente no interpola: la nota de riesgo está documentada ──
const dibujaCrudo = /ctx\.arc\(p\.x, p\.y/.test(game);
check('el cliente dibuja p.x/p.y sin interpolar (riesgo 30 Hz asumido a conciencia)',
    dibujaCrudo && /NO interpola posiciones/.test(server));

console.log('\n' + (fallos === 0 ? '✔ Todo correcto' : '✖ ' + fallos + ' fallo(s)'));
process.exit(fallos === 0 ? 0 : 1);
