const { io } = require('socket.io-client');
// El password de admin viene de .env (dotenv) y NO debe quedar fijo en los tests.
try { require('dotenv').config(); } catch (e) { /* dotenv opcional */ }
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const results = [];
function log(msg, ok = true) {
    const tag = ok ? 'PASS' : 'FAIL';
    results.push({ msg, ok });
    console.log(`[${tag}] ${msg}`);
}

async function runTests() {
    const socket = io('http://localhost:3000', {
        timeout: 5000,
        reconnection: false,
        autoConnect: false
    });

    const roomsListPromise = new Promise((resolve) => {
        socket.on('roomsList', (data) => resolve(data));
    });
    const joinedPromise = new Promise((resolve) => {
        socket.on('joinedSuccess', (data) => resolve(data));
    });
    const gameStatePromise = new Promise((resolve) => {
        socket.on('gameState', (state) => resolve(state));
    });
    const errorMsgPromise = new Promise((resolve) => {
        socket.on('errorMsg', (msg) => resolve(msg));
    });
    const playSoundPromise = new Promise((resolve) => {
        socket.on('playSound', (type) => resolve(type));
    });

    socket.connect();

    const roomsList = await roomsListPromise;
    log(`Lista de salas recibida: ${roomsList.length} salas`, roomsList.length >= 3);

    const roomToJoin = roomsList.find(r => !r.esPrivada && r.jugadoresConectados < r.maxJugadores);
    if (!roomToJoin) {
        log('No se encontró sala disponible', false);
        socket.disconnect();
        return;
    }

    socket.emit('joinRoom', {
        roomId: roomToJoin.id,
        password: '',
        nick: 'TestPlayer',
        skin: { c1: '#38bdf8', c2: '#0284c7', border: '#bae6fd' }
    });

    const joinedData = await joinedPromise;
    log(`Unido a sala ${joinedData.roomId} como ${joinedData.playerId}`, !!joinedData.roomId);

    const gameState = await gameStatePromise;
    log('gameState recibido del servidor');

    const me = gameState.players[joinedData.playerId];
    const requiredProps = ['angle', 'shield', 'maxShield', 'currentWeapon', 'ammo', 'maxAmmo', 'bombs', 'hasOrbGun', 'isExtracting', 'dashProgress'];
    const missing = requiredProps.filter(prop => me[prop] === undefined);
    log(`Propiedades de jugador completas (faltan: ${missing.length === 0 ? 'ninguna' : missing.join(', ')})`, missing.length === 0);

    const requiredState = ['mapSize', 'shopZones', 'hazardZones', 'speedPads', 'airdrops', 'obstacles', 'healthKits', 'bombs', 'explosions', 'zoneShrinking', 'lobbyActive', 'gameStarted'];
    const missingState = requiredState.filter(prop => gameState[prop] === undefined);
    log(`Estado del juego completo (faltan: ${missingState.length === 0 ? 'ninguna' : missingState.join(', ')})`, missingState.length === 0);

    socket.emit('playerInput', { w: true, a: false, s: false, d: false, angle: 1.57 });
    log('Input del jugador enviado');

    socket.emit('playerShoot', { angle: 0 });
    log('Evento de disparo enviado');

    socket.emit('playerDash');
    log('Evento de dash enviado');

    socket.emit('switchWeapon', 1);
    log('Evento de cambio de arma enviado');

    socket.emit('playerReload');
    log('Evento de recarga enviado');

    socket.emit('playerBomb');
    log('Evento de bomba enviado (sin bombas)');

    socket.emit('buyShopItem', 'medkit');
    log('Evento de compra de tienda enviado');

    socket.emit('requestRespawn');
    log('Evento de respawn enviado');

    socket.emit('adminAuth', { password: ADMIN_PASSWORD });
    const adminAuthed = await new Promise((resolve) => {
        socket.on('adminAuthed', (d) => resolve(d));
    });
    log('Admin autenticado', adminAuthed === true);

    const testRoomId = 'test_sala_' + Date.now();
    socket.emit('adminCreateRoom', {
        id: testRoomId,
        nombre: 'Sala de Prueba',
        maxJugadores: 4,
        precioEntrada: 2.00,
        esPrivada: false,
        password: ''
    });
    log('Creación de sala admin enviada');

    const updatedRooms = await new Promise((resolve) => {
        socket.on('roomsList', (data) => resolve(data));
    });
    const testRoom = updatedRooms.find(r => r.id === testRoomId);
    log(`Sala de prueba creada: ${testRoom ? testRoom.nombre : 'NO ENCONTRADA'}`, !!testRoom);

    socket.emit('adminDestroyRoom', { roomId: testRoomId });
    log('Destrucción de sala admin enviada');

    const finalRooms = await new Promise((resolve) => {
        socket.on('roomsList', (data) => resolve(data));
    });
    const stillExists = finalRooms.find(r => r.id === testRoomId);
    log(`Sala destruida correctamente: ${!stillExists ? 'Sí' : 'No'}`, !stillExists);

    socket.disconnect();

    const total = results.length;
    const passed = results.filter(r => r.ok).length;
    console.log('\n=== RESUMEN DE PRUEBAS ===');
    console.log(`Total: ${total} | Pasaron: ${passed} | Fallaron: ${total - passed}`);
    process.exit(0);
}

runTests().catch((err) => {
    console.error('Error en pruebas:', err);
    process.exit(1);
});
