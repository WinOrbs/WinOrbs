// Diagnóstico del reloj: cuenta cuántos gameState LLEGAN por segundo sin hacer
// nada (cero stringify). Si esto da mucho menos que la cadencia configurada,
// el problema no es la emisión sino que el event loop del servidor no llega a
// los 60 ticks/s (máquina saturada) — y con volatile se descartan los atrasos.
// Uso: node tools/medir_reloj.js [url]
const { io } = require('socket.io-client');
try { require('dotenv').config(); } catch (e) { }
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const s = io(BASE, { transports: ['websocket'], reconnection: false, timeout: 8000 });
const sala = 'reloj_' + Date.now();
let listo = false, n = 0, t0 = 0;
s.on('connect', () => {
    s.emit('adminAuth', { password: process.env.ADMIN_PASSWORD || '' });
    s.once('adminAuthed', () => {
        s.emit('adminCreateRoom', { id: sala, nombre: 'R', maxJugadores: 10, precioEntrada: 0, esPrivada: false });
        setTimeout(() => s.emit('joinRoom', { roomId: sala, password: '', nick: 'R', skin: {} }), 400);
        // startGame exige 2 jugadores: entra un segundo cliente
        const s2 = io(BASE, { transports: ['websocket'], reconnection: false, timeout: 8000 });
        s2.on('serverConfig', () => s2.emit('joinRoom', { roomId: sala, password: '', nick: 'R2', skin: {} }));
        setTimeout(() => s.emit('startGame', { roomId: sala }), 3000);
    });
});
s.on('gameStarted', () => { if (!listo) setTimeout(() => { listo = true; n = 0; t0 = Date.now(); }, 1000); });
s.on('gameState', () => { if (listo) n++; });
setTimeout(() => {
    const seg = (Date.now() - t0) / 1000;
    console.log('gameState/s reales: ' + (n / seg).toFixed(1) + ' Hz   (esperado 30 con TICK_EMITIR_CADA=2)');
    s.disconnect(); process.exit(0);
}, 15000);
