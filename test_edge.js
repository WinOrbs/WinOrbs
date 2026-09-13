const { io } = require('socket.io-client');

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

    state.errorMsg = null;
    state.joinedSuccess = null;
    socket.emit('joinRoom', { roomId: 'sala_1', password: '', nick: 'Edge', skin: {} });
    await wait(300);
    console.log(`[${state.joinedSuccess ? 'PASS' : 'FAIL'}] Unido a sala_1`);

    // Crear sala para prueba (con auth)
    state.errorMsg = null;
    socket.emit('adminAuth', { password: 'admin123' });
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
    socket.emit('joinRoom', { roomId: 'sala_vip', password: '1234', nick: 'VIP', skin: {} });
    await wait(300);
    console.log(`[${state.joinedSuccess ? 'PASS' : 'FAIL'}] Sala privada con password correcto`);

    state.errorMsg = null;
    state.joinedSuccess = null;
    socket.emit('joinRoom', { roomId: 'sala_vip', password: 'WRONG', nick: 'Hacker', skin: {} });
    await wait(300);
    const pass = state.errorMsg && (state.errorMsg.includes('incorrecta') || state.errorMsg.includes('Contraseña'));
    console.log(`[${pass ? 'PASS' : 'FAIL'}] Password incorrecto rechazado: "${state.errorMsg}"`);

    state.roomsList = [];
    socket.emit('adminDestroyRoom', { roomId });
    await wait(300);
    const gone = !state.roomsList.find(r => r.id === roomId);
    console.log(`[${gone ? 'PASS' : 'FAIL'}] Sala destruida correctamente`);

    console.log('\n=== PRUEBAS EDGE COMPLETADAS ===');
    socket.disconnect();
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
