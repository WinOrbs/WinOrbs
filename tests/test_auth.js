const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

const results = [];
let serverProcess;
let sockets = [];

function log(message, passed) {
    results.push({ message, passed });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${message}`);
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEvent(socket, eventName, predicate = () => true, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off(eventName, onEvent);
            reject(new Error(`Timed out waiting for ${eventName}`));
        }, timeoutMs);

        function onEvent(value) {
            if (!predicate(value)) return;
            clearTimeout(timeout);
            socket.off(eventName, onEvent);
            resolve(value);
        }

        socket.on(eventName, onEvent);
    });
}

async function connectSocket(port) {
    const socket = io(`http://127.0.0.1:${port}`, {
        timeout: 5000,
        reconnection: false,
        autoConnect: false
    });
    sockets.push(socket);
    const initialRooms = waitForEvent(socket, 'roomsList', Array.isArray);
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 5000);
        socket.once('connect', () => {
            clearTimeout(timeout);
            resolve(socket);
        });
        socket.once('connect_error', (error) => {
            clearTimeout(timeout);
            reject(new Error(`Socket connection failed: ${error.message}`));
        });
        socket.connect();
    });
    return { socket, initialRooms };
}

async function findAvailablePort() {
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', resolve);
    });
    const { port } = probe.address();
    await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
    return port;
}

function ping(port) {
    return new Promise((resolve) => {
        const request = http.get({ host: '127.0.0.1', port, path: '/ping', timeout: 500 }, (response) => {
            response.resume();
            resolve(response.statusCode === 200);
        });
        request.on('error', () => resolve(false));
        request.on('timeout', () => request.destroy());
    });
}

async function waitForServer(port) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (serverProcess.exitCode !== null) throw new Error('Test server exited before becoming ready');
        if (await ping(port)) return;
        await wait(100);
    }
    throw new Error('Test server did not become ready');
}

async function stopServer() {
    for (const socket of sockets) socket.disconnect();
    sockets = [];
    if (!serverProcess || serverProcess.exitCode !== null) return;

    const exited = new Promise((resolve) => serverProcess.once('exit', resolve));
    serverProcess.kill('SIGTERM');
    const graceful = await Promise.race([
        exited.then(() => true),
        wait(3000).then(() => false)
    ]);
    if (!graceful && serverProcess.exitCode === null) {
        serverProcess.kill('SIGKILL');
        await exited;
    }
}

async function run() {
    const port = await findAvailablePort();
    const adminPassword = crypto.randomBytes(32).toString('hex');
    const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'winorbs-auth-test-'));
    serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        cwd: workingDirectory,
        env: {
            PATH: process.env.PATH || '',
            HOME: os.tmpdir(),
            NODE_ENV: 'test',
            PORT: String(port),
            ADMIN_PASSWORD: adminPassword,
            FIREBASE_SERVICE_ACCOUNT: '{}'
        },
        stdio: 'ignore'
    });

    try {
        await waitForServer(port);

        const { socket, initialRooms } = await connectSocket(port);
        const rooms = await initialRooms;
        log('Servidor de prueba aislado y salas disponibles', rooms.length >= 3);

        const fixedRooms = rooms.filter((room) =>
            ['sala_1', 'sala_2', 'sala_3', 'sala_vip'].includes(room.id)
        );
        log('No se crean las salas fijas retiradas', fixedRooms.length === 0);

        const unauthenticatedCreate = waitForEvent(
            socket,
            'errorMsg',
            (message) => typeof message === 'string' && message.includes('permisos')
        );
        socket.emit('adminCreateRoom', {
            id: `unauth_${Date.now()}`,
            nombre: 'Test',
            maxJugadores: 2,
            precioEntrada: 0,
            esPrivada: false
        });
        await unauthenticatedCreate;
        log('Crear sala sin autenticar se rechaza', true);

        const publicRoom = rooms.find((room) => !room.esPrivada);
        if (publicRoom) {
            const unauthenticatedDestroy = waitForEvent(
                socket,
                'errorMsg',
                (message) => typeof message === 'string' && message.includes('permisos')
            );
            socket.emit('adminDestroyRoom', { roomId: publicRoom.id });
            await unauthenticatedDestroy;
            log('Eliminar sala sin autenticar se rechaza', true);
        } else {
            log('Existe una sala pública para comprobar el rechazo de eliminación', false);
        }

        const deniedAuth = waitForEvent(socket, 'adminAuthed', (value) => value === false);
        socket.emit('adminAuth', { password: 'invalid-test-password' });
        await deniedAuth;
        log('Contraseña incorrecta se rechaza', true);

        const acceptedAuth = waitForEvent(socket, 'adminAuthed', (value) => value === true);
        socket.emit('adminAuth', { password: adminPassword });
        await acceptedAuth;
        log('Autenticación administrativa con secreto efímero', true);

        const roomId = `auth_test_${Date.now()}`;
        const createdRoom = waitForEvent(
            socket,
            'roomsList',
            (updatedRooms) => updatedRooms.some((room) => room.id === roomId)
        );
        socket.emit('adminCreateRoom', {
            id: roomId,
            nombre: 'Sala de prueba',
            maxJugadores: 4,
            precioEntrada: 0,
            esPrivada: false
        });
        await createdRoom;
        log('Crear sala autenticado funciona', true);

        const deletedRoom = waitForEvent(
            socket,
            'roomsList',
            (updatedRooms) => !updatedRooms.some((room) => room.id === roomId)
        );
        socket.emit('adminDestroyRoom', { roomId });
        await deletedRoom;
        log('La sala temporal se elimina al terminar la prueba', true);
    } finally {
        await stopServer();
        fs.rmSync(workingDirectory, { recursive: true, force: true });
    }

    const passed = results.filter((result) => result.passed).length;
    const failed = results.length - passed;
    console.log(`\n=== RESUMEN ===\nTotal: ${results.length} | Pasaron: ${passed} | Fallaron: ${failed}`);
    if (failed > 0) process.exitCode = 1;
}

run().catch(async (error) => {
    console.error(`Authentication integration test failed: ${error.message}`);
    await stopServer();
    process.exitCode = 1;
});
