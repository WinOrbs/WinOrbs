const { io } = require('socket.io-client');
// El password de admin viene de .env (dotenv) y NO debe quedar fijo en los tests.
try { require('dotenv').config(); } catch (e) { /* dotenv opcional */ }
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const socket = io('http://localhost:3000', { timeout: 5000, reconnection: false, autoConnect: false });

const state = {
    roomsList: [],
    errorMsg: null,
    joinedSuccess: null
};

socket.on('roomsList', (data) => { state.roomsList = data; });
socket.on('errorMsg', (msg) => { state.errorMsg = msg; });
socket.on('joinedSuccess', (data) => { state.joinedSuccess = data; });

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
    socket.connect();
    await wait(500);
    console.log(`[${state.roomsList.length >= 3 ? 'PASS' : 'FAIL'}] Salas cargadas: ${state.roomsList.length}`);

    // Las salas automáticas son TODAS de pago: sin cuenta verificada el join
    // debe RECHAZARSE (protección de dinero), no aceptarse en silencio.
    // (El join correcto en sala gratuita se prueba más abajo con la VIP.)
    state.errorMsg = null;
    state.joinedSuccess = null;
    const salaPago = (state.roomsList || []).find((r) => !r.esPrivada && Number(r.precioEntrada) > 0);
    socket.emit('joinRoom', { roomId: salaPago ? salaPago.id : 'p05_1', password: '', nick: 'Edge', skin: {} });
    await wait(300);
    const rechazado = !state.joinedSuccess && /pago/i.test(state.errorMsg || '');
    console.log(`[${rechazado ? 'PASS' : 'FAIL'}] Sala de pago rechazada sin cuenta verificada: "${state.errorMsg}"`);

    // Crear sala para prueba (con auth)
    state.errorMsg = null;
    socket.emit('adminAuth', { password: ADMIN_PASSWORD });
    await wait(300);

    const roomId = 'fixed_id_test';
    socket.emit('adminCreateRoom', { id: roomId, nombre: 'Test', maxJugadores: 2, esPrivada: false });
    await wait(300);
    const exists = state.roomsList.find(r => r.id === roomId);
    console.log(`[${!!exists ? 'PASS' : 'FAIL'}] Sala creada con ID fijo`);

    state.errorMsg = null;
    socket.emit('adminCreateRoom', { id: roomId, nombre: 'Dup', maxJugadores: 2, esPrivada: false });
    await wait(300);
    console.log(`[${state.errorMsg ? 'PASS' : 'FAIL'}] Duplicado rechazado: "${state.errorMsg}"`);

    state.errorMsg = null;
    state.joinedSuccess = null;
    // Sala privada de prueba: se crea bajo demanda (ya no hay sala_vip fija)
    const vipId = 'vip_test_' + Date.now();
    socket.emit('adminCreateRoom', { id: vipId, nombre: 'VIP Test', maxJugadores: 4, precioEntrada: 0, esPrivada: true, password: '1234' });
    await wait(300);
    socket.emit('joinRoom', { roomId: vipId, password: '1234', nick: 'VIP', skin: {} });
    await wait(300);
    console.log(`[${state.joinedSuccess ? 'PASS' : 'FAIL'}] Sala privada con password correcto`);

    state.errorMsg = null;
    state.joinedSuccess = null;
    socket.emit('joinRoom', { roomId: vipId, password: 'WRONG', nick: 'Hacker', skin: {} });
    await wait(300);
    const pass = state.errorMsg && (state.errorMsg.includes('incorrecta') || state.errorMsg.includes('Contraseña'));
    console.log(`[${pass ? 'PASS' : 'FAIL'}] Password incorrecto rechazado: "${state.errorMsg}"`);

    state.roomsList = [];
    socket.emit('adminDestroyRoom', { roomId });
    await wait(300);
    const gone = !state.roomsList.find(r => r.id === roomId);
    console.log(`[${gone ? 'PASS' : 'FAIL'}] Sala destruida correctamente`);

    // Limpieza de la sala privada de prueba
    socket.emit('adminDestroyRoom', { roomId: vipId });
    await wait(300);

    console.log('\n=== PRUEBAS EDGE COMPLETADAS ===');
    socket.disconnect();
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
