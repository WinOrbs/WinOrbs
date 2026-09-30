// Test del log de retiros: sigue la convención de test_skins.js (extraer el
// bloque de server.js y correrlo en una sandbox con Firestore falso) + test
// del static del logo con el mismo express.static que usa server.js.
const fs = require('fs');
const assert = require('assert');
const express = require('express');
const out = [];
let fallos = 0;
function check(nombre, cond) {
  out.push((cond ? 'OK  - ' : 'FAIL - ') + nombre);
  console.log(out[out.length - 1]);
  if (!cond) fallos++;
}

async function main() {
  // ── 1) Extraer el bloque de retiros de server.js ──
  const server = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  const ini = server.indexOf('// ── Log de retiros recientes para el lobby');
  const fin = server.indexOf("io.on('connection', (socket) => {");
  assert.ok(ini > 0 && fin > ini, 'No se encontró el bloque de retiros en server.js');
  const bloque = server.slice(ini, fin);

  // ── 2) Sandbox con Firestore falso ──
  const RETIROS = [
    { tipo: 'retiro', estado: 'aprobado', usuario: 'Ana', monto: 50, fecha: { toMillis: () => 1000 } },
    { tipo: 'retiro', estado: 'pagado', usuario: 'María', monto: 200, fecha: { toMillis: () => 2000 } },
    { tipo: 'retiro', estado: 'rechazado', usuario: 'Fantasma', monto: 900, fecha: { toMillis: () => 3000 } },
    { tipo: 'deposito', estado: 'aprobado', usuario: 'Banco', monto: 500, fecha: { toMillis: () => 4000 } },
    { tipo: 'retiro', estado: 'pendiente', usuario: 'Leo<script>', monto: 120, fecha: { toMillis: () => 5000 } },
    { tipo: 'premio', estado: 'aprobado', usuario: 'Ganador', monto: 999, fecha: { toMillis: () => 6000 } },
    { tipo: 'retiro', estado: 'pagado', usuario: 'Mini', monto: 3.5, fecha: { toMillis: () => 7000 } }
  ];
  let disparaSnapshot = () => {};
  const emitidos = [];
  const sandbox = {
    FIREBASE_ECONOMY: true,
    FIREBASE_DB: {
      collection: () => ({
        orderBy: () => ({
          limit: () => ({
            get: async () => ({ docs: RETIROS.map((d, i) => ({ id: 'p' + i, data: () => d })) })
          })
        }),
        onSnapshot: (cb) => { disparaSnapshot = cb; return () => {}; }
      })
    },
    io: { emit: (ev, data) => { if (ev === 'retirosList') emitidos.push(data); } },
    console, setTimeout
  };
  // sanitización real de server.js (la necesita normalizarRetiro)
  sandbox.sanitizeNick = function (nick) {
    let n = String(nick || '').replace(/[<>&"'`]/g, '').replace(/[\x00-\x1F]/g, '').trim();
    return Array.from(n).slice(0, 16).join('');
  };
  const cargar = new Function('sandbox', 'with (sandbox) { return (async () => { ' + bloque + ' ; return { refrescar: refrescarRetirosRecientes, cache: () => cacheRetiros }; })(); }');
  const api = await cargar(sandbox);

  // ── 3) Comportamiento esperado ──
  const lista = await api.refrescar();
  check('solo retiros (sin depósitos/premios)', lista.every(r => r.usuario !== 'Banco' && r.usuario !== 'Ganador'));
  check('excluye rechazados', lista.every(r => r.usuario !== 'Fantasma'));
  check('ordenado mayor monto primero', lista[0].usuario === 'María' && lista[1].usuario === 'Leoscript' && lista[2].usuario === 'Ana' && lista[3].usuario === 'Mini');
  check('incluye pendientes y pagados', lista.length === 4);
  check('monto con 2 decimales', lista.find(r => r.usuario === 'Mini').monto === 3.5);
  check('nick sanitizado anti-XSS', !lista.some(r => /[<>]/.test(r.usuario)));
  check('fecha en ms', lista.every(r => typeof r.fecha === 'number' && r.fecha > 0));

  // ── 4) Difusión en vivo con debounce: 3 disparos rápidos → 1 emisión ──
  disparaSnapshot(); disparaSnapshot(); disparaSnapshot();
  await new Promise(r => setTimeout(r, 2200));
  check('broadcast retirosList en vivo (1 emisión con debounce)', emitidos.length === 1 && emitidos[0][0].usuario === 'María');
  check('cache actualizado para nuevas conexiones', api.cache()[0].usuario === 'María');

  // ── 5) Static del logo: mismo express.static que server.js (raíz /public) ──
  const app = express();
  app.use(express.static(require('path').join(__dirname, '..', 'public')));
  const srv = app.listen(0, '127.0.0.1', async () => {
    const puerto = srv.address().port;
    const get = (p) => new Promise((res) => {
      require('http').get({ host: '127.0.0.1', port: puerto, path: p }, (r2) => {
        let n = 0; r2.on('data', c => n += c.length);
        r2.on('end', () => res({ code: r2.statusCode, type: r2.headers['content-type'] || '', n }));
      }).on('error', () => res({ code: 0, n: 0 }));
    });
    const nuevo = await get('/assets/logo/logo-shield.png');
    const viejo = await get('/public/assets/logo/logo-shield.png');
    const icono = await get('/index.html');
    check('logo servido en /assets/logo/logo-shield.png (200 png ' + nuevo.n + ' bytes)', nuevo.code === 200 && /png/.test(nuevo.type) && nuevo.n === 855616);
    check('ruta vieja public/assets/... ahora 404 (correcto)', viejo.code === 404);
    check('index.html servido en /index.html', icono.code === 200);
    srv.close();
    const resumen = 'RESULTADO: ' + (fallos ? fallos + ' FALLOS' : 'TODO OK');
    console.log(resumen);
    fs.writeFileSync(require('path').join(__dirname, '..', '.test_retiros_out.log'), out.join('\n') + '\n' + resumen + '\n');
    process.exit(fallos ? 1 : 0);
  });
}

main().catch((e) => {
  out.push('ERROR: ' + (e && e.message));
  fs.writeFileSync(require('path').join(__dirname, '..', '.test_retiros_out.log'), out.join('\n') + '\n');
  process.exit(1);
});
