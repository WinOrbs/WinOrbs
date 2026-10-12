'use strict';

const assert = require('assert');
const http = require('http');
const { createHttpServer } = require('../apps/server/http');
const { createSocketServer } = require('../apps/server/realtime/socket_server');
const { io: createClient } = require('socket.io-client');
const { createConfig } = require('../apps/server/config/env');
const { createStructuredLogger } = require('../apps/server/observability/logger');

function request(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8')
            }));
        });
        req.on('error', reject);
        req.end();
    });
}

async function testMissingReadinessProvider() {
    const { server } = createHttpServer({
        rootDir: process.cwd(),
        isOriginAllowed: () => true,
        getFirebaseRuntime: () => null
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });

    try {
        const { port } = server.address();
        const response = await request(`http://127.0.0.1:${port}/ready`);
        assert.strictEqual(response.statusCode, 503);
        assert.deepStrictEqual(JSON.parse(response.body), { ready: false });
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
}

async function main() {
    await testMissingReadinessProvider();

    const config = createConfig({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://allowed.example',
        TRUST_PROXY: '2'
    });
    let firebaseRuntime = { economy: false, database: null };
    let ready = true;
    let runtimeProviderFails = false;
    const logLines = [];
    const { app, server } = createHttpServer({
        rootDir: process.cwd(),
        isOriginAllowed: config.cors.isOriginAllowed,
        trustProxy: config.server.trustProxy,
        getFirebaseRuntime: () => {
            if (runtimeProviderFails) throw new Error('private token details');
            return firebaseRuntime;
        },
        isReady: () => ready,
        statusProbeTimeoutMs: 50,
        logger: createStructuredLogger({ sink: (line) => logLines.push(line) })
    });
    const socketServer = createSocketServer(server, {
        isOriginAllowed: config.cors.isOriginAllowed,
        socketConfig: config.socketIO,
        logger: createStructuredLogger({ sink: (line) => logLines.push(line) })
    });
    assert.strictEqual(app.get('trust proxy'), 2);

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    let client;
    try {
        let response = await request(`${origin}/ping`, {
            headers: { Origin: 'https://allowed.example' }
        });
        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(JSON.parse(response.body).ok, true);
        assert.strictEqual(response.headers['access-control-allow-origin'], 'https://allowed.example');

        response = await request(`${origin}/ping`, {
            headers: { Origin: 'https://blocked.example' }
        });
        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(response.headers['access-control-allow-origin'], undefined);

        response = await request(`${origin}/ping`);
        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(response.headers['access-control-allow-origin'], undefined);

        response = await request(`${origin}/health`);
        assert.strictEqual(response.statusCode, 200);
        assert.deepStrictEqual(JSON.parse(response.body), { ok: true });

        response = await request(`${origin}/ready`);
        assert.strictEqual(response.statusCode, 200);
        assert.deepStrictEqual(JSON.parse(response.body), { ready: true });
        ready = false;
        response = await request(`${origin}/ready`);
        assert.strictEqual(response.statusCode, 503);
        assert.deepStrictEqual(JSON.parse(response.body), { ready: false });
        ready = true;

        response = await request(`${origin}/status`, {
            headers: { Origin: 'https://allowed.example' }
        });
        assert.strictEqual(response.statusCode, 200);
        assert.deepStrictEqual(JSON.parse(response.body), {
            firebase: false,
            modo: 'DESHABILITADA',
            proyecto: null,
            firestore: {
                ok: false,
                latenciaMs: null,
                error: 'SIN_CLAVE_DE_SERVICIO'
            }
        });

        response = await request(`${origin}/status`, {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://allowed.example',
                'Access-Control-Request-Method': 'GET'
            }
        });
        assert.strictEqual(response.statusCode, 204);
        assert.strictEqual(response.headers['access-control-allow-origin'], 'https://allowed.example');

        firebaseRuntime = {
            economy: true,
            firebaseAdmin: { app: () => ({ options: { projectId: 'project-test' } }) },
            database: {
                collection: () => ({ doc: () => ({ get: async () => ({}) }) })
            }
        };
        response = await request(`${origin}/status`);
        const connectedStatus = JSON.parse(response.body);
        assert.strictEqual(connectedStatus.firebase, true);
        assert.strictEqual(connectedStatus.modo, 'ECONOMIA');
        assert.strictEqual(connectedStatus.proyecto, 'project-test');
        assert.strictEqual(connectedStatus.firestore.ok, true);
        assert.strictEqual(typeof connectedStatus.firestore.latenciaMs, 'number');

        firebaseRuntime.database = {
            collection: () => ({
                doc: () => ({
                    get: async () => {
                        const error = new Error('offline');
                        error.code = 'UNAVAILABLE';
                        throw error;
                    }
                })
            })
        };
        response = await request(`${origin}/status`);
        const disconnectedStatus = JSON.parse(response.body);
        assert.strictEqual(disconnectedStatus.firestore.ok, false);
        assert.strictEqual(disconnectedStatus.firestore.error, 'UNAVAILABLE');

        firebaseRuntime.database = {
            collection: () => ({ doc: () => ({ get: () => new Promise(() => {}) }) })
        };
        response = await request(`${origin}/status`);
        const timedOutStatus = JSON.parse(response.body);
        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(timedOutStatus.firestore.ok, false);
        assert.strictEqual(timedOutStatus.firestore.error, 'DEADLINE_EXCEEDED');

        runtimeProviderFails = true;
        response = await request(`${origin}/status`);
        assert.strictEqual(response.statusCode, 500);
        assert.deepStrictEqual(JSON.parse(response.body), { error: 'INTERNAL_ERROR' });
        assert.strictEqual(logLines.length, 1);
        const errorLog = JSON.parse(logLines[0]);
        assert.deepStrictEqual(errorLog, {
            timestamp: errorLog.timestamp,
            level: 'error',
            event: 'http.request.failed',
            method: 'GET',
            statusCode: 500,
            errorCode: 'HTTP_HANDLER_FAILED'
        });
        assert.strictEqual(Number.isNaN(Date.parse(errorLog.timestamp)), false);
        assert.strictEqual(response.body.includes('private token details'), false);
        assert.strictEqual(logLines.join('').includes('private token details'), false);
        runtimeProviderFails = false;

        let socketConnected;
        const connected = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Socket.IO connection timed out')), 3000);
            socketServer.once('connection', (socket) => {
                socket.emit('transport-ready');
            });
            client = createClient(origin, {
                forceNew: true,
                reconnection: false,
                timeout: 2500,
                transports: ['websocket']
            });
            client.once('connect', () => {
                socketConnected = true;
            });
            client.once('transport-ready', () => {
                clearTimeout(timeout);
                resolve();
            });
            client.once('connect_error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
        await connected;
        assert.strictEqual(socketConnected, true);

        const serverRejection = new Promise((resolve) => {
            socketServer.engine.once('connection_error', resolve);
        });
        let rejectedClient;
        const clientRejection = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Blocked Socket.IO origin was not rejected')), 3000);
            rejectedClient = createClient(origin, {
                forceNew: true,
                reconnection: false,
                timeout: 2500,
                transports: ['websocket'],
                extraHeaders: { origin: 'https://blocked.example' }
            });
            rejectedClient.once('connect_error', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
        await Promise.all([serverRejection, clientRejection]);
        if (rejectedClient) rejectedClient.close();
        assert.strictEqual(logLines.length, 2);
        const socketErrorLog = JSON.parse(logLines[1]);
        assert.strictEqual(socketErrorLog.event, 'socket.connection_rejected');
        assert.strictEqual(socketErrorLog.errorCode, 'SOCKET_HANDSHAKE_REJECTED');
        assert.strictEqual(logLines.join('').includes('blocked.example'), false);

        console.log('OK HTTP status, ping, CORS, and Socket.IO initialization.');
    } finally {
        if (client) client.close();
        await new Promise((resolve) => socketServer.close(resolve));
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
