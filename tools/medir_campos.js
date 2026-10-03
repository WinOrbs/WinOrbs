// Desglose por campo de un gameState real, para saber QUÉ pesa de verdad.
// No es el ancho de banda: solo el reparto del tamaño. Uso:
//   node tools/medir_campos.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const iniConst = server.indexOf('const MAP_SIZE');
const finConst = server.indexOf('class GameRoom');
const iniRoom = server.indexOf('class GameRoom');
const finRoom = server.indexOf('// Salas iniciales');

const sandbox = {
    console, Math, Date, JSON, Object, Array, isFinite, setTimeout, setInterval, clearInterval,
    process: { env: {}, argv: [] },
    TICK_EMITIR_CADA: 2,
    ROOMCONFIG_V2: true
};
const ctx = vm.createContext(sandbox);
vm.runInContext(server.slice(iniConst, finConst), ctx, { filename: 'constantes' });
vm.runInContext(server.slice(iniRoom, finRoom), ctx, { filename: 'GameRoom' });
vm.runInContext(`
    globalThis.io = { to: () => ({ emit: () => {}, volatile: { emit: () => {} } }), sockets: { sockets: new Map() } };
    globalThis.r = new GameRoom('T', 't', 6, 0, false, '');
    r.addPlayer('a', 'Ana', {}, null);
    r.addPlayer('b', 'Beto', {}, null);
    r.gameStarted = true;
    r.gameTime = 200;
`, ctx);

const R = ctx.r;
const st = R.getState();
const total = JSON.stringify(st).length;

console.log('Mapa: ' + R.obstacles.length + ' obstaculos, ' + R.walls.length + ' muros, ' + R.shopZones.length + ' tiendas');
console.log('TOTAL gameState: ' + total + ' B');
console.log('');
Object.keys(st).map(k => [k, JSON.stringify(st[k]).length])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .forEach(r => console.log(String(r[1]).padStart(7) + ' B  (' + Math.round(r[1] / total * 100) + '%)  ' + r[0]));

const cfg = R.configEstatica();
const hpFrame = JSON.stringify(st.obstaculosHp).length + JSON.stringify(st.murosHp).length;
console.log('');
console.log('roomConfig (una vez):  ' + JSON.stringify(cfg).length + ' B');
console.log('hp por frame:          ' + hpFrame + ' B');
console.log('geometria por frame:   ~' + (JSON.stringify(R.obstacles).length + JSON.stringify(R.walls).length) + ' B  (lo que roomConfig evita repetir)');
console.log('AHORRO por frame:      ~' + (JSON.stringify(R.obstacles).length + JSON.stringify(R.walls).length - hpFrame) + ' B');