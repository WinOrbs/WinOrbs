// Test de autostart con contador de espera de 30 s + victoria por abandono
const { io } = require('socket.io-client');
// El password de admin viene de .env (dotenv) y NO debe quedar fijo en los tests.
try { require('dotenv').config(); } catch (e) { /* dotenv opcional */ }
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const URL = 'http://localhost:3000';
const ROOM = 'autostart_t';

const results = [];
function log(msg, ok = true) { results.push({ msg, ok }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${msg}`); }
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function mkSocket() {
    return io(URL, { timeout: 5000, reconnection: false, autoConnect: false });
}

async function run() {
    const admin = mkSocket();
    const p1 = mkSocket();
    const p2 = mkSocket();
    const p3 = mkSocket();

    let roomsList = [];
    let s1 = null, s2 = null, s3 = null;
    let solo1 = null;
    let gameOverData = null;

    admin.on('roomsList', d => roomsList = d);
    p1.on('gameState', s => s1 = s);
    p2.on('gameState', s => s2 = s);
    p3.on('gameState', s => s3 = s);
    p1.on('soloWarning', d => solo1 = d);
    p1.on('gameOver', d => gameOverData = d);

    admin.connect();
    await wait(400);
    admin.emit('adminAuth', { password: ADMIN_PASSWORD });
    await wait(300);

    // Sala limpia de prueba
    admin.emit('adminDestroyRoom', { roomId: ROOM });
    await wait(200);
    admin.emit('adminCreateRoom', { id: ROOM, nombre: 'Autostart', maxJugadores: 4, esPrivada: false, precioEntrada: 2.00 });
    await wait(300);
    log(`Sala de prueba creada (${ROOM})`, roomsList.some(r => r.id === ROOM));

    p1.connect(); p2.connect(); p3.connect();
    await wait(200);
    p1.emit('joinRoom', { roomId: ROOM, password: '', nick: 'P1', skin: {} });
    await wait(300);
    p2.emit('joinRoom', { roomId: ROOM, password: '', nick: 'P2', skin: {} });
    await wait(1500);

    // 1) El contador arranca a 30 al cubrir el cupo mínimo (2)
    log(`Contador de espera activo con 2 jugadores (waitingTimer=${s1 && s1.waitingTimer})`,
        s1 && typeof s1.waitingTimer === 'number' && s1.waitingTimer > 25 && s1.waitingTimer <= 30);

    // 2) Con cada inscrito nuevo, el contador se reinicia a 30
    const antes = s1 ? s1.waitingTimer : null;
    await wait(4000); // deja que baje un poco
    p3.emit('joinRoom', { roomId: ROOM, password: '', nick: 'P3', skin: {} });
    await wait(1500);
    const despues = s1 ? s1.waitingTimer : null;
    log(`Reinicio a 30 con el 3.er inscrito (antes=${antes}, después=${despues})`,
        typeof antes === 'number' && typeof despues === 'number' && antes < despues);

    // 3) Arranque manual del admin (sin esperar los 30 s)
    let started = false;
    p1.on('gameStarted', () => started = true);
    admin.emit('startGame', { roomId: ROOM });
    await wait(7000); // countdown 5 s + margen
    log(`Partida iniciada vía admin (gameStarted=${s1 && s1.gameStarted})`, started && s1 && s1.gameStarted);

    // 4) Abandono: quedan P2 y P3 → luego solo P1 → gameOver{abandono:true}
    let soloWarningVisto = false;
    p1.on('soloWarning', d => { if (d && typeof d.segundos === 'number') soloWarningVisto = true; });
    p2.disconnect();
    p3.disconnect();
    await wait(2500);
    log(`Banner "SOLO EN LA SALA" visible (soloWarning=${JSON.stringify(solo1)})`,
        soloWarningVisto && s1 && s1.gameStarted);

    // Bote ESTÁTICO visible en partida: no baja aunque quede un solo jugador
    const feeSala = (gameOverData && gameOverData.entryFee) || 2;
    log(`Bote estático en gameState (pozoTotal=${s1 && s1.pozoTotal})`,
        s1 && s1.gameStarted && Math.abs((s1.pozoTotal || 0) - 3 * 2) < 0.005);

    const t0 = Date.now();
    while (!gameOverData && Date.now() - t0 < 16000) await wait(300);
    log(`gameOver por abandono (abandono=${gameOverData && gameOverData.abandono}, lb=${gameOverData && gameOverData.leaderboard && gameOverData.leaderboard.length})`,
        !!gameOverData && gameOverData.abandono === true &&
        gameOverData.leaderboard && gameOverData.leaderboard.length === 1 &&
        gameOverData.leaderboard[0].nick === 'P1');

    log(`Premio neto correcto (premioNeto=${gameOverData && gameOverData.premioNeto})`,
        !!gameOverData && gameOverData.entryFee > 0 &&
        Math.abs(gameOverData.premioNeto - +(3 * gameOverData.entryFee * 0.8).toFixed(2)) < 0.005); // bote estático de 3 inscritos

    // Limpieza
    admin.emit('adminDestroyRoom', { roomId: ROOM });
    await wait(300);
    [admin, p1].forEach(s => s.disconnect());

    const fallos = results.filter(r => !r.ok);
    console.log(`\n=== AUTOSTART: ${results.length - fallos.length}/${results.length} pruebas OK ===`);
    process.exit(fallos.length ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
