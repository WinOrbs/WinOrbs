// Test del endpoint GET /status (diagnóstico de Firebase): sigue la convención
// de test_retiros.js / test_firebase_init.js (extraer el bloque de server.js y
// correrlo en una sandbox) + prueba end-to-end con el mismo express que usa
// server.js. Ejecutar desde la raíz del proyecto:  node test_status.js
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
  // ── 1) Extraer el bloque /status de server.js ──
  const server = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  const ini = server.indexOf('// ── Diagnóstico de Firebase (GET /status)');
  const fin = server.indexOf('const MAP_SIZE = 5000;');
  assert.ok(ini > 0 && fin > ini, 'No se encontró el bloque /status en server.js');
  const bloque = server.slice(ini, fin);

  // ── 2) Sandbox ejecutable del handler ──
  // OJO: new Function NO captura el scope local → el handler se guarda como
  // propiedad del sandbox y el bloque lo devuelve vía with(sandbox).
  function montar({ eco, db, admin }) {
    const sandbox = {
      handler: null,
      app: { get: (ruta, h) => { if (ruta === '/status') sandbox.handler = h; } },
      FIREBASE_ECONOMY: eco,
      FIREBASE_DB: db,
      firebaseAdmin: admin,
      Date, Promise, console
    };
    const cargar = new Function('sandbox', 'with (sandbox) { return (function () { ' + bloque + ' ; return handler; })(); }');
    const h = cargar(sandbox);
    assert.ok(typeof h === 'function', 'el handler de /status no quedó registrado');
    // Res falso que captura la respuesta JSON
    return async function llamar() {
      let capturado = null;
      const res = { json: (x) => { capturado = x; } };
      await h({}, res);
      return capturado;
    };
  }

  // ── 3) Caso economía activa: Firestore responde ──
  let llamar = montar({
    eco: true,
    db: { collection: (c) => ({ doc: (d) => ({ get: async () => ({ exists: false }) }) }) },
    admin: { app: () => ({ options: { projectId: 'proyecto-test' } }) }
  });
  let r = await llamar();
  check('economía ON → firebase:true y modo ECONOMIA', r.firebase === true && r.modo === 'ECONOMIA');
  check('proyecto leído de firebaseAdmin.app()', r.proyecto === 'proyecto-test');
  check('firestore.ok:true con latencia medida', r.firestore.ok === true && typeof r.firestore.latenciaMs === 'number' && r.firestore.latenciaMs >= 0);

  // ── 4) Caso sin clave: degradado con motivo claro ──
  llamar = montar({ eco: false, db: null, admin: null });
  r = await llamar();
  check('sin clave → firebase:false y modo DEGRADADO', r.firebase === false && r.modo === 'DEGRADADO');
  check('sin clave → error SIN_CLAVE_DE_SERVICIO', r.firestore.ok === false && r.firestore.error === 'SIN_CLAVE_DE_SERVICIO');
  check('sin app inicializada → proyecto null sin crash', r.proyecto === null);

  // ── 5) Caso Firestore caído: propaga código de error sin explotar ──
  llamar = montar({
    eco: true,
    db: { collection: () => ({ doc: () => ({ get: async () => { const e = new Error('no hay red'); e.code = 'UNAVAILABLE'; throw e; } }) }) },
    admin: { app: () => ({ options: { projectId: 'proyecto-test' } }) }
  });
  r = await llamar();
  check('Firestore caído → ok:false con código UNAVAILABLE', r.firestore.ok === false && /UNAVAILABLE/.test(r.firestore.error));

  // ── 6) Redacción: jamás expone credenciales ──
  const texto = JSON.stringify(r);
  check('respuesta sin private_key ni client_email', !texto.includes('private_key') && !texto.includes('client_email'));

  // ── 7) End-to-end: mismo express que server.js, puerto efímero ──
  const app2 = express();
  const sandbox2 = {
    handler: null,
    app: { get: (ruta, h) => { if (ruta === '/status') sandbox2.handler = h; } },
    FIREBASE_ECONOMY: false, FIREBASE_DB: null, firebaseAdmin: null, Date, Promise, console
  };
  const handler2 = new Function('sandbox', 'with (sandbox) { return (function () { ' + bloque + ' ; return handler; })(); }')(sandbox2);
  app2.get('/status', handler2);
  const srv = app2.listen(0, '127.0.0.1', async () => {
    const puerto = srv.address().port;
    require('http').get({ host: '127.0.0.1', port: puerto, path: '/status' }, (res) => {
      let cuerpo = '';
      res.on('data', (c) => cuerpo += c);
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(cuerpo); } catch (e) { /* se valida abajo */ }
        check('end-to-end: GET /status responde 200 JSON', res.statusCode === 200 && j && j.firestore.error === 'SIN_CLAVE_DE_SERVICIO');
        srv.close();
        const resumen = 'RESULTADO: ' + (fallos ? fallos + ' FALLOS' : 'TODO OK');
        console.log(resumen);
        fs.writeFileSync(require('path').join(__dirname, '..', '.test_status_out.log'), out.join('\n') + '\n' + resumen + '\n');
        process.exit(fallos ? 1 : 0);
      });
    }).on('error', () => {
      check('end-to-end: GET /status responde 200 JSON', false);
      srv.close();
      process.exit(1);
    });
  });
}

main().catch((e) => {
  out.push('ERROR: ' + (e && e.message));
  console.log(out[out.length - 1]);
  fs.writeFileSync(require('path').join(__dirname, '..', '.test_status_out.log'), out.join('\n') + '\n');
  process.exit(1);
});