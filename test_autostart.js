const { io } = require('socket.io-client');

const results = [];
function log(msg, ok = true) { results.push({ msg, ok }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${msg}`); }
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
    const p1 = io('http://localhost:3000', { timeout: 5000, reconnection: false, autoConnect: false });
    const p2 = io('http://localhost:3000', { timeout: 5000, reconnection: false, autoConnect: false });
    const admin = io('http://localhost:3000', { timeout: 5000, reconnection: false, autoConnect: false });

    let roomsList = [];
    let gameStateP1 = null;
    let gameStateP2 = null;
    let p1Joined = null;
    let p2Joined = null;
    let gameStartedEvent = null;
    let playSound = null;

    p1.on('roomsList', d => roomsList = d);
    p1.on('joinedSuccess', d => p1Joined = d);
    p1.on('gameState', s => gameStateP1 = s);
    p1.on('gameStarted', d => gameStartedEvent = d);
    p1.on('playSound', t => playSound = t);
    p1.on('errorMsg', m => log('P1 errorMsg: ' + m, false));

    p2.on('roomsList', d => {});
    p2.on('joinedSuccess', d => p2Joined = d);
    p2.on('gameState', s => gameStateP2 = s);
    p2.on('gameStarted', d => {});

    admin.on('roomsList', d => {});
    admin.on('adminAuthed', d => {});
    admin.on('errorMsg', m => log('Admin errorMsg: ' + m, false));

    // Connect, get rooms
    p1.connect(); p2.connect(); admin.connect();
    await wait(500);
    log(`Salas cargadas: ${roomsList.length}`, roomsList.length >= 3);

    // Create a test room via admin
    admin.emit('adminAuth', { password: 'admin123' });
    await wait(300);

    const roomId = 'auto_test_' + Date.now();
    admin.emit('adminCreateRoom', { id: roomId, nombre: 'Auto', maxJugadores: 6, esPrivada: false });
    await wait(300);

    // P1 joins
    gameStateP1 = null; p1Joined = null; gameStartedEvent = null; playSound = null;
    p1.emit('joinRoom', { roomId, password: '', nick: 'P1', skin: {} });
    await wait(500);
    log(`P1 unido: ${p1Joined ? p1Joined.roomId : null}`, !!p1Joined && p1Joined.roomId === roomId);

    // Check P1 is in waiting state
    await wait(300);
    const p1Waiting = gameStateP1 && !gameStateP1.gameStarted && !gameStateP1.lobbyActive;
    log(`P1 ve "Esperando jugadores" (no countdown): ${p1Waiting}`, p1Waiting);

    // P2 joins - auto-start timer should begin
    gameStateP2 = null; p2Joined = null;
    p2.emit('joinRoom', { roomId, password: '', nick: 'P2', skin: {} });
    await wait(500);
    log(`P2 unido: ${p2Joined ? p2Joined.roomId : null}`, !!p2Joined && p2Joined.roomId === roomId);

    // P2 should also see waiting state initially
    await wait(300);
    const p2Waiting = gameStateP2 && !gameStateP2.gameStarted && !gameStateP2.lobbyActive;
    log(`P2 tambien ve "Esperando jugadores" inicialmente: ${p2Waiting}`, p2Waiting);

    // Wait for auto-start (10 seconds)
    log('Esperando 12 segundos para auto-start...');
    await wait(12000);

    // Check that lobby started automatically
    const p1Lobby = gameStateP1 && gameStateP1.lobbyActive === true;
    const p2Lobby = gameStateP2 && gameStateP2.lobbyActive === true;
    log(`P1 ve lobby activo tras auto-start: ${p1Lobby}`, p1Lobby);
    log(`P2 ve lobby activo tras auto-start: ${p2Lobby}`, p2Lobby);
    log(`gameStarted event recibido: ${!!gameStartedEvent}`, !!gameStartedEvent);
    log(`Sonido de lobby reproducido: ${!!playSound}`, !!playSound);

    // Wait for countdown to finish
    log('Esperando 7 segundos para fin de countdown...');
    await wait(7000);

    const p1GameStarted = gameStateP1 && gameStateP1.gameStarted === true;
    const p2GameStarted = gameStateP2 && gameStateP2.gameStarted === true;
    log(`P1 ve gameStarted=true: ${p1GameStarted}`, p1GameStarted);
    log(`P2 ve gameStarted=true: ${p2GameStarted}`, p2GameStarted);

    // Cleanup
    admin.emit('adminDestroyRoom', { roomId });
    p1.disconnect(); p2.disconnect(); admin.disconnect();

    console.log(`\n=== RESUMEN AUTO-START ===`);
    console.log(`Total: ${results.length} | Pasaron: ${results.filter(r => r.ok).length} | Fallaron: ${results.filter(r => !r.ok).length}`);
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
