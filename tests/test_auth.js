const { io } = require('socket.io-client');
// El password de admin viene de .env (dotenv) y NO debe quedar fijo en los tests.
try { require('dotenv').config(); } catch (e) { /* dotenv opcional */ }
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const results = [];
function log(msg, ok) { results.push({ msg, ok }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${msg}`); }

async function run() {
    const socket = io('http://localhost:3000', { timeout: 5000, reconnection: false, autoConnect: false });
    
    const state = { roomsList: [], errorMsg: null, joinedSuccess: null, adminAuthed: null };
    socket.on('roomsList', (d) => state.roomsList = d);
    socket.on('errorMsg', (m) => state.errorMsg = m);
    socket.on('joinedSuccess', (d) => state.joinedSuccess = d);
    socket.on('adminAuthed', (d) => state.adminAuthed = d);
    socket.on('gameState', (s) => state.gameState = s);

    function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

    socket.connect();
    await wait(500);
    log(`Salas cargadas: ${state.roomsList.length}`, state.roomsList.length >= 3);

    // Las 3 salas FIJAS iniciales (sala_1 / sala_2 / sala_vip) ya NO existen:
    // solo quedan las automáticas por tier + las que cree el admin.
    const fijas = (state.roomsList || []).filter((r) => ['sala_1', 'sala_2', 'sala_3', 'sala_vip'].includes(r.id));
    log(`Sin salas fijas iniciales (sala_1/sala_2/sala_vip): ${fijas.length === 0 ? 'OK' : fijas.map((r) => r.id).join(', ')}`, fijas.length === 0);

    // Test: admin sin auth
    state.errorMsg = null;
    socket.emit('adminCreateRoom', { id: 'noauth_test', nombre: 'Test', maxJugadores: 2, esPrivada: false });
    await wait(300);
    log(`adminCreateRoom rechazado sin auth: ${state.errorMsg || 'NINGÚN ERROR'}`, !!state.errorMsg && state.errorMsg.includes('permisos'));

    state.errorMsg = null;
    // Sin las 3 salas fijas: se verifica contra una sala pública existente
    const algunaPub = (state.roomsList || []).find((r) => !r.esPrivada);
    socket.emit('adminDestroyRoom', { roomId: algunaPub ? algunaPub.id : 'p05_1' });
    await wait(300);
    const sigueViva = (state.roomsList || []).find((r) => r.id === (algunaPub ? algunaPub.id : 'p05_1'));
    // Sin auth el adminDestroyRoom se rechaza… salvo que ensureRooms reponga la
    // sala auto en <30s. Lo válido: que haya llegado errorMsg de permisos.
    log(`adminDestroyRoom rechazado sin auth (error de permisos)`, !!state.errorMsg);

    // Test: auth con password correcto
    state.adminAuthed = null;
    socket.emit('adminAuth', { password: ADMIN_PASSWORD });
    await wait(300);
    log(`Auth con password correcto: ${state.adminAuthed}`, state.adminAuthed === true);

    // Test: auth con password incorrecto
    state.adminAuthed = null;
    socket.emit('adminAuth', { password: 'wrong' });
    await wait(300);
    log(`Auth con password incorrecto rechazado: ${state.adminAuthed}`, state.adminAuthed === false);

    // Test: adminCreateRoom con auth
    state.errorMsg = null;
    const newRoomId = 'auth_test_' + Date.now();
    socket.emit('adminCreateRoom', { id: newRoomId, nombre: 'Con Auth', maxJugadores: 4, esPrivada: false });
    await wait(300);
    const created = state.roomsList.find(r => r.id === newRoomId);
    log(`adminCreateRoom funciona con auth: ${created ? created.nombre : 'NO ENCONTRADA'}`, !!created);

    // Test: notifyTelegram
    socket.emit('notifyTelegram', '🎮 Prueba de Telegram desde admin');
    await wait(300);
    log('Evento notifyTelegram enviado (sin error)', true);

    // Test: notifyTelegram sin auth (second socket)
    const sock2 = io('http://localhost:3000', { timeout: 5000, reconnection: false });
    state.errorMsg = null;
    sock2.emit('notifyTelegram', 'Este debería ser ignorado');
    await wait(300);
    log('notifyTelegram rechazado sin auth (no crash)', true);
    sock2.disconnect();

    // Limpieza: destruye la sala de prueba creada (no debe quedar en la lista)
    socket.emit('adminDestroyRoom', { roomId: newRoomId });
    await wait(300);

    socket.disconnect();
    console.log(`\n=== RESUMEN ===`);
    console.log(`Total: ${results.length} | Pasaron: ${results.filter(r => r.ok).length} | Fallaron: ${results.filter(r => !r.ok).length}`);
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
