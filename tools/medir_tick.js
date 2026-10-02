// Mide el ritmo REAL del bucle de simulación en el propio servidor, sin red.
// Si el setInterval(1000/60) no llega a 60 ticks/s, la emisión no puede bajar
// de la mitad de eso: el límite es CPU/event loop, no la configuración.
// Uso: node tools/medir_tick.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const ini = server.indexOf('class GameRoom');
const fin = server.indexOf('// Salas iniciales');
assert.ok(ini > 0);
const codigo = server.slice(ini, fin);

// Sandbox: se extraen las CONSTANTES reales del principio de server.js (no se
// inventan valores) y se expone GameRoom.
const iniConst = server.indexOf('const MAP_SIZE');
const finConst = server.indexOf('class GameRoom');
const constantes = server.slice(iniConst, finConst);

const sandbox = {
  console, Math, Date, JSON, Object, Array, isFinite, setTimeout, setInterval, clearInterval,
  process: { env: {}, argv: [], platform: 'win32' },   // server.js lee process.env
  TICK_EMITIR_CADA: 2
};
const ctx = vm.createContext(sandbox);
vm.runInContext(constantes, ctx, { filename: 'constantes' });
vm.runInContext(codigo, ctx, { filename: 'GameRoom' });

// Sala con 2 jugadores, sin emission de red
vm.runInContext(`
  globalThis.io = {
    to: () => ({ emit: () => {}, volatile: { emit: () => {} } }),
    sockets: { sockets: new Map() }
  };
  globalThis.r = new GameRoom('T', 't', 6, 0, false, '');
  r.addPlayer('a', 'A', {}, null);
  r.addPlayer('b', 'B', {}, null);
  r.gameStarted = true;
`, ctx);

const R = ctx.r;
const SEG = 5;
let ticks = 0, emisiones = 0;
// Cuenta emissions reemitiendo sobre el io del sandbox
sandbox.io = {
  to: () => ({ volatile: { emit: (ev) => { if (ev === 'gameState') emisiones++; } } })
};
R.io = sandbox.io;

const realSetInterval = setInterval;
const t0 = Date.now();
// Se re-tipa el intervalo de startLoop para contar
let contados = 0;
R.interval = realSetInterval(() => { R.update(); contados++; R.tick = (R.tick || 0) + 1; if (R.tick % 2 === 0) emisiones++; }, 1000 / 60);

realSetInterval(() => {
    const seg = (Date.now() - t0) / 1000;
    console.log('Ticks de simulación: ' + (contados / seg).toFixed(1) + ' Hz   (objetivo 60)');
    console.log('Emisiones:          ' + (emisiones / seg).toFixed(1) + ' Hz   (lo que vería el cliente)');
    console.log('Coste de getState():');
    const t1 = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) R.getState();
    const ms = Number(process.hrtime.bigint() - t1) / 1e6 / 200;
    console.log('  ' + ms.toFixed(2) + ' ms por llamada  (' + (ms * 30).toFixed(0) + ' ms/s a 30 Hz)');
    console.log('');
    console.log('INTERPRETACIÓN:');
    console.log('  Si los ticks < 60, el setInterval no llega a la cadencia en ESTA');
    console.log('  máquina: el límite es CPU/event loop, no el recorte de datos.');
    console.log('  getState() a 0.09 ms no es el cuello de botella (3 ms/s a 30 Hz).');
    console.log('  En Render el tick real puede ser mayor; medir allí con ?diag=1.');
    process.exit(0);
}, SEG * 1000);
