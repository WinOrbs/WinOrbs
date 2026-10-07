// Test de las Bombas de Plasma (arma 3): Q equipa · clic lanza hacia el cursor.
// Patrón de la casa (test_retiros/test_firebase_init): extraer los bloques de
// server.js y correrlos en una sandbox. Aquí además los métodos de la clase se
// envuelven como literal de objeto para poder llamarlos con `this` controlado.
// Ejecutar desde la raíz del proyecto:  node test_bombas.js
const fs = require('fs');
const assert = require('assert');
const { validateShoot } = require('../apps/server/transport/command');
const out = [];
let fallos = 0;
function check(nombre, cond) {
  out.push((cond ? 'OK  - ' : 'FAIL - ') + nombre);
  console.log(out[out.length - 1]);
  if (!cond) fallos++;
}

const server = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
const game = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'game.html'), 'utf8');

// ── 1) Extraer métodos de la sala (handleShoot … handleBuyItem) ──
const iniMet = server.indexOf('    handleShoot(socketId, shootData) {');
const finMet = server.indexOf('    handleRespawn(socketId) {');
assert.ok(iniMet > 0 && finMet > iniMet, 'No se encontró el bloque de métodos en server.js');
const bloqueMetodos = server.slice(iniMet, finMet);

// ── 2) Extraer el tick de bombas (movimiento + temporizador) ──
const iniTick = server.indexOf('        for (let i = this.bombs.length - 1; i >= 0; i--) {');
const finTick = server.indexOf('        for (let i = this.explosions.length - 1; i >= 0; i--) {');
assert.ok(iniTick > 0 && finTick > iniTick, 'No se encontró el bloque del tick de bombas');
// El tick vive dentro de un método: `this` pasa a ser R (la sala falsa)
const codigoTick = server.slice(iniTick, finTick).split('this.').join('R.');

// ── 3) Sandbox compartida ──
const sonidos = [];
const avisosDirectos = [];
const io = {
  to: (id) => ({ emit: (ev) => { if (ev === 'playSound') sonidos.push(ev); } }),
  sockets: { sockets: new Map([['p1', { emit: (ev, d) => avisosDirectos.push(String(d)) }]]) }
};
const MAP_SIZE = 5000;
const sandboxBase = {
  io, MAP_SIZE, Date, console, Math, isFinite, validateShoot,
  SHOOT_COOLDOWN: { 1: 120, 2: 400, 3: 500 },
  BOMBA_VEL: 12, BOMBA_FRICCION: 0.95, BOMBA_COOLDOWN_MS: 400,
  ITEM_COSTOS: { medkit: 30, shield: 50, bomb: 40, orbGun: 100 },
  RECARGA_ORBES_COSTE: 25, RELOAD_TICKS: 150
};

function nuevaSala(jugadores) {
  const R = {
    id: 'sala1',
    players: jugadores,
    bullets: [], bombs: [], explosions: [],
    avisos: [],
    explodidas: [],
    // versión falsa (rate-limit fuera de alcance): registra y listo
    avisarSinMunicion(p, texto) { this.avisos.push(texto); },
    // versión falsa del estallido: valida posición desde el tick
    explodeBomb(b) { this.explodidas.push({ x: b.currentX, y: b.currentY }); }
  };
  // Los métodos reales (del prototype) viven en la sala: así `this.lanzarBomba`
  // resuelve dentro de handleShoot/handleBomb tal como en server.js.
  return Object.assign(R, api);
}

// Métodos reales de server.js atados a la sala falsa.
// OJO: se envuelven como CUERPO DE CLASE (los métodos no necesitan comas y
// admiten los comentarios que hay entre ellos) y se toman del prototype.
const Sala = new Function('sandbox', 'with (sandbox) { return class Sala { ' + bloqueMetodos + ' }; }')(sandboxBase);
const api = {};
for (const k of Object.getOwnPropertyNames(Sala.prototype)) {
  if (k !== 'constructor') api[k] = Sala.prototype[k];
}

function jugador(extra) {
  return Object.assign({
    id: 'p1', x: 500, y: 500, radius: 22, angle: 0,
    bombs: 2, isDead: false, isReloading: false, reloadTimer: 0, reloadWeapon: 0,
    currentWeapon: 3, hasOrbGun: false,
    ammo: 10, maxAmmo: 15, ammo2: 0, maxAmmo2: 3,
    charge: 100, bankedScore: 0, lastShotAt: 0, lastBombAt: 0
  }, extra);
}

// ── CASOS ──
(async () => {
  // ── 4) Equipar arma 3 (Q) y whitelist de cambio de arma ──
  let R = nuevaSala({ p1: jugador({}) });
  api.handleSwitchWeapon.call(R, 'p1', 3);
  check('Q → switchWeapon(3) equipa Bombas de Plasma', R.players.p1.currentWeapon === 3);
  api.handleSwitchWeapon.call(R, 'p1', 2);
  check('arma 2 sin Lanza-Orbes sigue bloqueada (regresión)', R.players.p1.currentWeapon === 3);
  api.handleSwitchWeapon.call(R, 'p1', 99);
  check('arma desconocida (99) rechazada por whitelist', R.players.p1.currentWeapon === 3);

  // ── 5) Clic con arma 3: lanza UNA bomba con el ángulo del clic ──
  R.players.p1.angle = 7; // distinto del ángulo del clic: el clic manda
  api.handleShoot.call(R, 'p1', { angle: 0 });
  check('clic con arma 3 consume 1 bomba', R.players.p1.bombs === 1);
  check('se creó exactamente 1 bomba', R.bombs.length === 1);
  const b0 = R.bombs[0];
  check('vx/vy según el ángulo del clic (angle=0 → vx=BOMBA_VEL)', Math.abs(b0.vx - 12) < 1e-9 && Math.abs(b0.vy) < 1e-9);
  check('nace delante del dueño (x0 = x + radio + 12)', Math.abs(b0.currentX - 534) < 1e-9 && Math.abs(b0.currentY - 500) < 1e-9);
  check('timer de mecha 90 ticks (~1.5 s)', b0.timer === 90 && b0.exploded === false);
  check('dueño registrado (ownerId)', b0.ownerId === 'p1');

  // ── 6) Cooldown anti-spam entre lanzamientos ──
  api.handleShoot.call(R, 'p1', { angle: 0 });
  check('2º clic inmediato bloqueado por cooldown (400 ms)', R.bombs.length === 1 && R.players.p1.bombs === 1);

  // ── 7) Sin bombas: aviso y sin lanzamiento ──
  R = nuevaSala({ p1: jugador({ bombs: 0 }) });
  api.handleShoot.call(R, 'p1', { angle: 0 });
  check('clic sin bombas → aviso y ninguna bomba', R.bombs.length === 0 && /Sin bombas/.test(R.avisos.join('|')));

  // ── 8) Botón móvil (playerBomb): usa el apuntado del stick (p.angle) ──
  R = nuevaSala({ p1: jugador({ angle: Math.PI / 2 }) });
  api.handleBomb.call(R, 'p1');
  const bm = R.bombs[0];
  check('playerBomb móvil lanza 1 bomba', R.bombs.length === 1 && R.players.p1.bombs === 1);
  check('ángulo del stick manda (angle=π/2 → vy=BOMBA_VEL)', Math.abs(bm.vy - 12) < 1e-9 && Math.abs(bm.vx) < 1e-9);

  // ── 9) Tick: vuelo con fricción, clamp de bordes y estallido por timer ──
  R = nuevaSala({ p1: jugador({}) });
  R.bombs.push({ ownerId: 'p1', x: 100, y: 100, currentX: 100, currentY: 100, vx: 12, vy: 0, timer: 90, exploded: false });
  const correrTick = new Function('R', 'sandbox', 'with (sandbox) { ' + codigoTick + ' }');
  correrTick(R, sandboxBase);
  const d2 = R.bombs[0].currentX - 100;
  check('el tick MUEVE la bomba (avanza 12 px el 1er tick)', Math.abs(d2 - 12) < 1e-9);
  correrTick(R, sandboxBase);
  const d3 = R.bombs[0].currentX - 112;
  check('la fricción frena la bomba (tick 2 < tick 1)', Math.abs(d3 - 12 * 0.95) < 1e-9);
  // Borde del mapa: queda pegada (clamp) en vez de salirse
  R.bombs.push({ ownerId: 'p1', x: MAP_SIZE - 5, y: 300, currentX: MAP_SIZE - 5, currentY: 300, vx: 12, vy: 0, timer: 90, exploded: false });
  correrTick(R, sandboxBase);
  check('clamp al borde del mapa (no se sale por la derecha)', R.bombs[1].currentX === MAP_SIZE);
  // Mecha: timer 1 → estalla en su posición y desaparece
  R.bombs[0].timer = 1;
  R.bombs[0].currentX = 150; R.bombs[0].currentY = 100;
  R.bombs[0].vx = 0; R.bombs[0].vy = 0;
  correrTick(R, sandboxBase);
  check('timer→0: estalla en currentX/currentY y se retira del array', R.explodidas.length === 1 && R.explodidas[0].x === 150 && R.bombs.length === 1);

  // ── 10) Compra en tienda: coste y tope de 3 ──
  R = nuevaSala({ p1: jugador({ bombs: 1, charge: 100 }) });
  api.handleBuyItem.call(R, 'p1', 'bomb');
  check('compra de bomba: ⚡40 y +1 (1→2)', R.players.p1.charge === 60 && R.players.p1.bombs === 2);
  R.players.p1.bombs = 3; R.players.p1.charge = 100;
  api.handleBuyItem.call(R, 'p1', 'bomb');
  check('tope de 3 bombas respetado', R.players.p1.bombs === 3 && R.players.p1.charge === 60);
  R.players.p1.charge = 0;
  api.handleBuyItem.call(R, 'p1', 'bomb');
  check('sin gemas: aviso directo y sin gasto', R.players.p1.bombs === 3 && avisosDirectos.some(a => /gemas/.test(a)));

  // ── 11) Patrón de fuente del cliente ──
  check("game.html: tecla Q con !e.repeat equipa arma 3", game.includes("'q' && !e.repeat") && game.includes("switchWeapon', 3"));
  check('game.html: HUD actualizado ("Equipar" y "Bombas de Plasma")', game.includes('Bombas de Plasma') && game.includes('Equipar</small>'));
  check('server.js: campo muerto life:180 eliminado de las bombas', !/ownerId: p\.id,[\s\S]{0,400}life: 180/.test(server));

  const resumen = 'RESULTADO: ' + (fallos ? fallos + ' FALLOS' : 'TODO OK');
  console.log(resumen);
  fs.writeFileSync(require('path').join(__dirname, '..', '.test_bombas_out.log'), out.join('\n') + '\n' + resumen + '\n');
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  out.push('ERROR: ' + (e && e.message));
  console.log(out[out.length - 1]);
  fs.writeFileSync(require('path').join(__dirname, '..', '.test_bombas_out.log'), out.join('\n') + '\n');
  process.exit(1);
});
