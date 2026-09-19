const { io } = require('socket.io-client');
// El password de admin viene de .env (dotenv) y NO debe quedar fijo en los tests.
try { require('dotenv').config(); } catch (e) { /* dotenv opcional */ }
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const results = [];
function log(msg, ok = true) {
    results.push({ msg, ok });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${msg}`);
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
    const adminSocket = io('http://localhost:3000', { timeout: 5000, reconnection: false, autoConnect: false });
    const player1 = io('http://localhost:3000', { timeout: 5000, reconnection: false, autoConnect: false });
    const player2 = io('http://localhost:3000', { timeout: 5000, reconnection: false, autoConnect: false });

    let adminAuthed = false;
    let gameStatePlayer1 = null;
    let gameStatePlayer2 = null;
    let p1Joined = null;
    let p2Joined = null;
    let gameStartedEvent = null;
    let p1LeftRoom = false;
    let p2LeftRoom = false;

    adminSocket.on('roomsList', () => { });
    adminSocket.on('adminAuthed', (d) => { adminAuthed = d; });
    adminSocket.on('errorMsg', (m) => console.log('Admin errorMsg:', m));

    player1.on('roomsList', () => { });
    player1.on('joinedSuccess', (d) => { p1Joined = d; });
    player1.on('gameState', (s) => { gameStatePlayer1 = s; });
    player1.on('disconnect', () => { p1LeftRoom = true; });

    player2.on('roomsList', () => { });
    player2.on('joinedSuccess', (d) => { p2Joined = d; });
    player2.on('gameState', (s) => { gameStatePlayer2 = s; });

    adminSocket.connect();
    await wait(300);

    adminSocket.emit('adminAuth', { password: ADMIN_PASSWORD });
    await wait(300);
    log(`Admin autenticado: ${adminAuthed}`, adminAuthed === true);

    // Crear sala para prueba
    const roomId = 'test_manual_' + Date.now();
    adminSocket.emit('adminCreateRoom', { id: roomId, nombre: 'Test Manual', maxJugadores: 6, esPrivada: false });
    await wait(300);

    // Player 1 joins
    player1.connect();
    await wait(300);
    player1.emit('joinRoom', { roomId, password: '', nick: 'P1', skin: {} });
    await wait(300);
    log(`Player1 unido: ${p1Joined ? p1Joined.roomId : null}`, !!p1Joined && p1Joined.roomId === roomId);

    // Verify Player1 sees "Waiting for players" state (no gameStarted, no lobbyActive)
    await wait(200);
    const waitingState = gameStatePlayer1;
    log(`Player1 ve estado "esperando" (gameStarted=false, lobbyActive=false): ${!waitingState.gameStarted && !waitingState.lobbyActive}`,
        !waitingState.gameStarted && !waitingState.lobbyActive);

    // Try to start game with only 1 player (should fail)
    state = null;
    adminSocket.emit('startGame', { roomId });
    const errMsg = await new Promise(r => {
        const t = setTimeout(() => r(null), 500);
        adminSocket.on('errorMsg', (m) => { clearTimeout(t); r(m); });
    });
    log(`Start rechazado con 1 jugador: "${errMsg}"`, errMsg && errMsg.includes('2 jugadores'));

    // Player 2 joins
    player2.connect();
    await wait(300);
    player2.emit('joinRoom', { roomId, password: '', nick: 'P2', skin: {} });
    await wait(300);
    log(`Player2 unido: ${p2Joined ? p2Joined.roomId : null}`, !!p2Joined && p2Joined.roomId === roomId);

    // Verify Player2 does NOT see "Waiting for players" as countdown (should still be waiting, not countdown)
    // Since admin hasn't started yet, Player2 should also see waiting state
    await wait(200);
    const p2waiting = !gameStatePlayer2.gameStarted && !gameStatePlayer2.lobbyActive;
    log(`Player2 tambien ve estado "esperando" (no cuenta regresiva): ${p2waiting}`, p2waiting);

    // Now admin starts the game
    let startGameOk = false;
    adminSocket.emit('startGame', { roomId });

    // Poll hasta ver lobby activo (tolerante a retrasos por carga del servidor)
    async function waitFor(condFn, timeoutMs = 5000, step = 100) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (condFn()) return true;
            await wait(step);
        }
        return condFn();
    }

    const p1Lobby = await waitFor(() => gameStatePlayer1 && gameStatePlayer1.lobbyActive === true);
    const p2Lobby = await waitFor(() => gameStatePlayer2 && gameStatePlayer2.lobbyActive === true);
    log(`Player1 ve lobby activo: ${p1Lobby}`, p1Lobby);
    log(`Player2 ve lobby activo: ${p2Lobby}`, p2Lobby);

    const p1Countdown = await waitFor(() => gameStatePlayer1 && gameStatePlayer1.countdown > 0, 2000);
    log(`Player1 ve cuenta regresiva > 0: ${p1Countdown}`, p1Countdown);

    // Wait for countdown to finish (poll, 5s countdown + buffer)
    await waitFor(() => gameStatePlayer1 && gameStatePlayer1.gameStarted === true, 10000);
    await waitFor(() => gameStatePlayer2 && gameStatePlayer2.gameStarted === true, 5000);

    const p1GameStarted = gameStatePlayer1 && gameStatePlayer1.gameStarted === true;
    const p2GameStarted = gameStatePlayer2 && gameStatePlayer2.gameStarted === true;
    log(`Player1 ve gameStarted=true despues de countdown: ${p1GameStarted}`, p1GameStarted);
    log(`Player2 ve gameStarted=true despues de countdown: ${p2GameStarted}`, p2GameStarted);

    // Test leaveRoom
    player1.emit('leaveRoom');
    await wait(500);
    const p1Gone = !gameStatePlayer2.players[p1Joined.playerId];
    log(`Player1 desaparece de gameState para Player2 tras leaveRoom: ${p1Gone}`, p1Gone);

    // Test startGame sin auth (reject)
    const sock3 = io('http://localhost:3000', { timeout: 5000, reconnection: false });
    await wait(300);
    let noAuthMsg = null;
    sock3.on('errorMsg', (m) => { noAuthMsg = m; });
    sock3.emit('startGame', { roomId });
    await wait(300);
    log(`startGame rechazado sin auth: "${noAuthMsg}"`, noAuthMsg && noAuthMsg.includes('permisos'));
    sock3.disconnect();

    // Cleanup
    adminSocket.emit('adminDestroyRoom', { roomId });
    player2.disconnect();
    adminSocket.disconnect();

    console.log(`\n=== RESUMEN DE PRUEBAS MANUALES ===`);
    console.log(`Total: ${results.length} | Pasaron: ${results.filter(r => r.ok).length} | Fallaron: ${results.filter(r => !r.ok).length}`);
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
