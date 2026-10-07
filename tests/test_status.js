'use strict';

const assert = require('assert');
const http = require('http');
const { createHttpServer } = require('../apps/server/http');
const { createSocketServer } = require('../apps/server/realtime/socket_server');
const { io: createClient } = require('socket.io-client');
const { createConfig } = require('../apps/server/config/env');

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

async function main() {
    const config = createConfig({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://allowed.example',
        TRUST_PROXY: '2'
    });
    let firebaseRuntime = { economy: false, database: null };
    const { app, server } = createHttpServer({
        rootDir: process.cwd(),
        isOriginAllowed: config.cors.isOriginAllowed,
        trustProxy: config.server.trustProxy,
        getFirebaseRuntime: () => firebaseRuntime,
    });
    const socketServer = createSocketServer(server, {
        isOriginAllowed: config.cors.isOriginAllowed,
        socketConfig: config.socketIO
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
