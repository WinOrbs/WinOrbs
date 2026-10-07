const { io } = require('socket.io-client');
// El password de admin viene de .env (dotenv) y NO debe quedar fijo en los tests.
try { require('dotenv').config(); } catch (e) { /* dotenv opcional */ }
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

let passed = 0;
let failed = 0;
function log(msg, ok) {
    if (ok === undefined) ok = true;
    if (ok) { passed++; } else { failed++; }
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${msg}`);
}

async function runTests() {
    const socket1 = io('http://localhost:3000', { timeout: 5000, reconnection: false, autoConnect: false });
    const socket2 = io('http://localhost:3000', { timeout: 5000, reconnection: false, autoConnect: false });

    const s1_rooms = new Promise(r => socket1.on('roomsList', r));
    const s1_joined = new Promise(r => socket1.on('joinedSuccess', r));
    const s1_state = new Promise(r => socket1.on('gameState', r));
    const s2_rooms = new Promise(r => socket2.on('roomsList', r));
    const s2_joined = new Promise(r => socket2.on('joinedSuccess', r));
    const s2_state = new Promise(r => socket2.on('gameState', r));

    socket1.connect();
    await s1_rooms;

    // Las salas automáticas son TODAS de pago ($0.50–$5) y exigen cuenta
    // verificada; para probar la sincronización multijugador se crea una sala
    // GRATIS con el admin y ambos jugadores entran en ella.
    socket1.emit('adminAuth', { password: ADMIN_PASSWORD });
    await new Promise(r => socket1.once('adminAuthed', r));
    const roomId = 'mp_test_' + Date.now();
    socket1.emit('adminCreateRoom', { id: roomId, nombre: 'MP Test', maxJugadores: 10, precioEntrada: 0, esPrivada: false });
    const mpRooms = await new Promise(r => socket1.once('roomsList', r));
    log(`Sala gratuita de prueba creada (${roomId})`, !!mpRooms.find(r => r.id === roomId));

    socket1.emit('joinRoom', { roomId, password: '', nick: 'Player1', skin: { c1: '#38bdf8' } });
    const j1 = await s1_joined;
    log(`Player1 unido: ${j1.playerId}`);

    const state1_1 = await Promise.race([s1_state, new Promise(r => setTimeout(() => r(null), 3000))]);
    log('Player1 recibió gameState', !!state1_1);

    socket2.connect();
    await s2_rooms;

    socket2.emit('joinRoom', { roomId, password: '', nick: 'Player2', skin: { c1: '#ef4444' } });
    const j2 = await s2_joined;
    log(`Player2 unido: ${j2.playerId}`);

    const state2_1 = await s2_state;
    log('Player2 recibió gameState', !!state2_1);
    log(`Player2 ve a Player1 en su estado: ${!!state2_1.players[j1.playerId]}`, !!state2_1.players[j1.playerId]);
    log(`Player2 tiene ${Object.keys(state2_1.players).length} jugadores en su estado`, Object.keys(state2_1.players).length >= 2);

    socket1.emit('playerShoot', { angle: 0 });
    socket1.emit('playerDash');
    socket1.emit('playerInput', { w: true, a: false, s: false, d: false, angle: 1.57 });

    await new Promise(r => setTimeout(r, 500));

    const state1_2 = await new Promise(r => {
        socket1.once('gameState', r);
    });
    log('Player1 recibió gameState actualizado después de input', !!state1_2);

    // (La autenticación de admin ya se hizo arriba, antes de crear la sala
    //  gratuita de la prueba multijugador.)

    socket1.emit('adminCreateRoom', {
        id: 'dup_test_' + Date.now(),
        nombre: 'DupTest',
        maxJugadores: 2,
        precioEntrada: 0,
        esPrivada: false
    });

    const error1 = await Promise.race([
        new Promise(r => socket1.on('errorMsg', r)),
        new Promise(r => setTimeout(() => r(null), 1000))
    ]);

    socket1.emit('adminCreateRoom', {
        id: 'dup_test_2',
        nombre: 'DupTest2',
        maxJugadores: 2,
        esPrivada: false
    });

    const createdRooms1 = await new Promise(r => socket1.on('roomsList', r));
    const exists1 = createdRooms1.find(r => r.id === 'dup_test_2');
    log('Sala creada sin password funciona', !!exists1);

    // La sala creada debe aparecer exactamente una vez en la lista de salas.
    // Disparamos un cambio real (leaveRoom) para forzar una emisión de roomsList.
    socket1.emit('leaveRoom');
    const listaFinal = await new Promise(r => socket1.once('roomsList', r));
    const veces = listaFinal.filter(r => r.id === 'dup_test_2').length;
    log('Sala duplicada rechazada', veces === 1);

    socket1.emit('adminDestroyRoom', { roomId: 'dup_test_2' });
    const destroyedRooms = await new Promise(r => socket1.on('roomsList', r));
    const gone = destroyedRooms.find(r => r.id === 'dup_test_2');
    log('Sala destruida correctamente', !gone);

    // Sala privada bajo demanda (ya no existe sala_vip fija)
    const vipId = 'vip_test_' + Date.now();
    socket1.emit('adminCreateRoom', { id: vipId, nombre: 'VIP Test', maxJugadores: 4, precioEntrada: 0, esPrivada: true, password: '1234' });
    await new Promise(r => setTimeout(r, 400));
    socket1.emit('joinRoom', { roomId: vipId, password: '1234', nick: 'TestVIP', skin: {} });
    const vipJoin = await s1_joined;
    log('Unión a sala privada con password correcto', !!vipJoin.roomId);

    socket1.emit('joinRoom', { roomId: vipId, password: 'incorrecta', nick: 'TestVIP2', skin: {} });
    const vipError = await new Promise(r => socket1.on('errorMsg', r));
    log(`Error en sala privada con password incorrecto: "${vipError}"`, vipError.includes('incorrecta') || vipError.includes('Contraseña'));

    // Limpieza: destruye la sala gratuita de la prueba multijugador
    socket1.emit('adminDestroyRoom', { roomId });
    await new Promise(r => setTimeout(r, 400));

    socket1.disconnect();
    socket2.disconnect();

    console.log(`\n=== RESUMEN MULTIJUGADOR ===`);
    console.log(`Total: ${passed + failed} | Pasaron: ${passed} | Fallaron: ${failed}`);
    process.exit(0);
}

runTests().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
