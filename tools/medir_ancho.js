// Prueba directa del canal de juego: crea una sala GRATIS con el admin (las
// automáticas son todas de pago y exigen cuenta verificada), entra con 2
// jugadores y mide cuántos gameState llegan por segundo y de qué tamaño.
// Sirve para validar el recorte (Fase 1a) y la cadencia (Fase 2) con números.
// Uso: node tools/medir_ancho.js [http://127.0.0.1:3000]
try { require('dotenv').config(); } catch (e) { /* dotenv opcional */ }
const { io } = require('socket.io-client');

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const SEGUNDOS = 8;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const s = io(BASE, { transports: ['websocket'], reconnection: false, timeout: 8000 });
const sala = 'medir_' + Date.now();
let playerId = null, listo = false, jugador2Dentro = false;
let estados = 0, bytes = 0, primero = null;

s.on('connect', () => {
    s.emit('adminAuth', { password: ADMIN_PASSWORD });
    s.once('adminAuthed', () => {
        s.emit('adminCreateRoom', {
            id: sala, nombre: 'Medidor', maxJugadores: 10,
            precioEntrada: 0, esPrivada: false
        });
        setTimeout(() => {
            s.emit('joinRoom', { roomId: sala, password: '', nick: 'Medidor', skin: { c1: '#38bdf8' } });
            // 2º cliente para que la sala tenga más de un jugador en pantalla
            const s2 = io(BASE, { transports: ['websocket'], reconnection: false, timeout: 8000 });
            s2.on('serverConfig', () => s2.emit('joinRoom',
                { roomId: sala, password: '', nick: 'Medidor2', skin: { c1: '#f00' } }));
            s2.on('joinedSuccess', () => { jugador2Dentro = true; });
        }, 500);
    });
});

s.on('joinedSuccess', (d) => { playerId = d.playerId; });
s.on('errorMsg', (m) => { console.log('errorMsg: ' + m); });

// Medición sobre ventana REAL: cuenta estados y tiempo desde que arrancó la
// partida. Dividir por un SEGUNDOS fijo falsea la frecuencia si la ventana no
// cuadra con el arranque.
let tIni = 0, muestras = 0, bytesMuestra = 0;
s.on('gameStarted', () => {
    if (listo) return;
    setTimeout(() => { listo = true; tIni = Date.now(); estados = 0; muestras = 0; bytesMuestra = 0; }, 1000);
});

// startGame exige 2 jugadores: el admin lo dispara en cuanto ambos han entrado
let arrancado = false;
setTimeout(() => {
    if (!arrancado && jugador2Dentro) {
        arrancado = true;
        s.emit('startGame', { roomId: sala });
    }
}, 3000);

s.on('gameState', (st) => {
    if (!primero) primero = st;
    if (!listo) return;                 // la sala en lobby no emite: no cuenta
    estados++;
    // IMPORTANTE: solo se mide el tamaño en una MUESTRA (1 de cada 10). Hacer
    // JSON.stringify de ~9 KB en cada frame bloquea el event loop de ESTE
    // cliente, y como la emisión es volatile el servidor descarta los frames
    // que no llegan a tiempo: la frecuencia medida se hundía a ~13 Hz y era un
    // artefacto del medidor, no del servidor.
    if (++muestras % 10 === 0) bytesMuestra += Buffer.byteLength(JSON.stringify(st));
});
const muestrasTotales = () => Math.max(1, Math.floor(estados / 10));

setTimeout(() => {
    const seg = Math.max(0.001, (Date.now() - tIni) / 1000);
    const nMues = muestrasTotales();
    const tamMedio = bytesMuestra / nMues;
    console.log('Sala:               ' + sala);
    console.log('gameState recibidos:' + estados + '  (ventana real de ' + seg.toFixed(1) + ' s)');
    console.log('Frecuencia:         ' + (estados / seg).toFixed(1) + ' Hz');
    console.log('Tamaño medio:       ' + (tamMedio / 1024).toFixed(2) + ' KB   (muestra de ' + nMues + ' frames)');
    console.log('Ancho de banda:     ' + (tamMedio * (estados / seg) / 1024).toFixed(1) + ' KB/s por cliente');
    console.log('Equivalencia:       ' + (tamMedio * (estados / seg) / 1024 * 8 / 1024).toFixed(3) + ' Mbps por cliente');
    if (primero && playerId) {
        const yo = primero.players[playerId];
        console.log('--- comprobaciones del recorte ---');
        console.log('jugadores en el estado:      ' + Object.keys(primero.players).length);
        console.log('campos del jugador:          ' + Object.keys(yo || {}).length);
        console.log('¿viaja uid?                  ' + (yo && yo.uid !== undefined ? 'SÍ (mal)' : 'no'));
        console.log('¿viajan inputs?              ' + (yo && yo.inputs !== undefined ? 'SÍ (mal)' : 'no'));
        console.log('¿viaja lastShotAt?           ' + (yo && yo.lastShotAt !== undefined ? 'SÍ (mal)' : 'no'));
        console.log('¿llega maxHp/maxShield?      ' + (yo && yo.maxHp && yo.maxShield ? 'sí' : 'NO (mal)'));
        console.log('¿llega skin/nick/x/y?        ' + (yo && yo.skin && yo.nick && yo.x !== undefined ? 'sí' : 'NO (mal)'));
        console.log('¿llega ammo/bombs/angle?     ' + (yo && yo.ammo !== undefined && yo.bombs !== undefined && yo.angle !== undefined ? 'sí' : 'NO (mal)'));
    }
    s.disconnect();
    process.exit(0);
}, (SEGUNDOS + 6) * 1000);
