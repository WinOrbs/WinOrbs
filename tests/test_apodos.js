// Pruebas de salas iniciales + apodos ÚNICOS (auto-limpiante).
//
//  1) Las 3 salas FIJAS iniciales (sala_1 / sala_2 / sala_vip) ya NO existen:
//     solo quedan las automáticas por tier + las que cree el admin.
//  2) Un socket SIN UID verificado no puede entrar con un apodo reservado a una
//     cuenta registrada (anti-suplantación) y SÍ puede intentarlo con otro.
//
// La reserva de prueba se crea y se borra dentro del mismo script, con una clave
// imposible de colisionar con un apodo real. No escribe nada en partidas/pagos.
// Uso: node tests/test_apodos.js   (con el servidor corriendo en localhost:3000)
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const SA_PATH = path.join(__dirname, '..', 'serviceAccountKey.json');
let db = null;
if (fs.existsSync(SA_PATH)) {
  const admin = require('firebase-admin');
  const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id || undefined });
  db = admin.firestore();
}

// OJO: los IDs de documento que empiezan y acaban por '__' son RESERVADOS por
// Firestore, así que la clave de prueba no puede tener ese formato.
const CLAVE = 'probe-apodo-reservado-zz';
const results = [];
const log = (m, ok) => { results.push(ok); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${m}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const socket = io('http://localhost:3000', { timeout: 5000, reconnection: false });
  const state = { roomsList: [], errores: [] };
  socket.on('roomsList', (d) => { state.roomsList = d || []; });
  socket.on('errorMsg', (m) => { state.errores.push(m); });
  socket.on('joinedSuccess', () => { state.errores.push('__JOIN_OK__'); });

  await wait(700);

  // ─ 1) Salas fijas eliminadas ──────────────────────────────────────────
  const ids = state.roomsList.map((r) => r.id);
  const fijas = ids.filter((id) => ['sala_1', 'sala_2', 'sala_3', 'sala_vip'].includes(id));
  console.log('   salas actuales:', ids.join(', ') || '(ninguna)');
  log(`Sin salas fijas iniciales (encontradas: ${fijas.join(', ') || 'ninguna'})`, fijas.length === 0 && ids.length > 0);

  if (!db) {
    console.log('\n   (sin serviceAccountKey.json: se omite la prueba de apodos reservados)');
    socket.disconnect();
    await wait(200);
    return resumen();
  }

  // Sala de PAGO para las pruebas de apodo: un socket sin verificar es rechazado
  // por "requiere iniciar sesión" ANTES de escribir nada (cero efectos laterales).
  const salaPago = state.roomsList.find((r) => !r.esPrivada && Number(r.precioEntrada || 0) > 0);
  const sala = salaPago || state.roomsList.find((r) => !r.esPrivada);
  if (!sala) { log('Hay una sala pública para probar los apodos', false); socket.disconnect(); return resumen(); }
  console.log('   sala de prueba:', JSON.stringify(sala));

  // ── 2a) Apodo NO reservado: la regla de suplantación no lo bloquea ────
  state.errores = [];
  socket.emit('joinRoom', { roomId: sala.id, nick: '__apodo_libre_probe__', skin: 'basic' });
  await wait(800);
  const bloqueadoLibre = state.errores.some((m) => String(m).includes('pertenece a una cuenta registrada'));
  log(`Apodo libre NO se bloquea por suplantación (respuesta: ${state.errores[0] || 'sin respuesta'})`,
      !bloqueadoLibre && state.errores.length > 0);

  // ─ 2b) Apodo reservado a una cuenta registrada: SÍ se bloquea ─────────
  await db.collection('apodos').doc(CLAVE).set({ uid: '__probe_uid__', apodo: CLAVE });
  try {
    state.errores = [];
    socket.emit('joinRoom', { roomId: sala.id, nick: CLAVE, skin: 'basic' });
    await wait(900);
    const bloqueado = state.errores.some((m) => String(m).includes('pertenece a una cuenta registrada'));
    log(`Apodo reservado a una cuenta registrada se bloquea (respuesta: ${state.errores[0] || 'sin respuesta'})`, bloqueado);
  } finally {
    // Limpieza SIEMPRE: no se deja basura en la base de datos
    await db.collection('apodos').doc(CLAVE).delete();
    console.log('   reserva de prueba borrada:', CLAVE);
  }

  socket.disconnect();
  await wait(200);
  resumen();
}

function resumen() {
  const ok = results.filter(Boolean).length;
  console.log(`\n=== RESUMEN === Total: ${results.length} | Pasaron: ${ok} | Fallaron: ${results.length - ok}`);
  process.exit(results.length - ok === 0 ? 0 : 1);
}

run().catch((e) => { console.error('ERROR:', e); process.exit(1); });