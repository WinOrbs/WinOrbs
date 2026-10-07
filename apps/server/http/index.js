'use strict';

const express = require('express');
const http = require('http');
const { SERVER_DEFAULTS } = require('../config/defaults');

function createStatusHandler({ getFirebaseRuntime, now = () => Date.now() } = {}) {
    if (typeof getFirebaseRuntime !== 'function') {
        throw new TypeError('A Firebase runtime provider is required');
    }

    return async function statusHandler(req, res) {
        const runtime = getFirebaseRuntime();
        const firebaseAdmin = runtime?.firebaseAdmin || null;
        const database = runtime?.database || null;
        const economy = runtime?.economy === true;
        const status = {
            firebase: economy,
            modo: economy ? 'ECONOMIA' : 'DESHABILITADA',
            proyecto: null,
            firestore: { ok: false, latenciaMs: null, error: null }
        };

        try {
            status.proyecto = (firebaseAdmin && firebaseAdmin.app().options.projectId) || null;
        } catch (error) {
            // Firebase Admin may be unavailable or not initialized.
        }

        try {
            if (!economy || !database) {
                status.firestore.error = 'SIN_CLAVE_DE_SERVICIO';
            } else {
                const startedAt = now();
                await database.collection('diagnostico').doc('ping').get();
                status.firestore.ok = true;
                status.firestore.latenciaMs = now() - startedAt;
            }
        } catch (error) {
            status.firestore.error = String(error.code || error.message || 'ERROR').slice(0, 200);
        }
        res.json(status);
    };
}

function createHttpServer({
    rootDir,
    isOriginAllowed,
    trustProxy = SERVER_DEFAULTS.trustProxy,
    getFirebaseRuntime
} = {}) {
    if (typeof rootDir !== 'string' || !rootDir) {
        throw new TypeError('A server root directory is required');
    }
    if (typeof isOriginAllowed !== 'function') {
        throw new TypeError('An origin policy is required');
    }

    const app = express();
    app.set('trust proxy', trustProxy);
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (origin && isOriginAllowed(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    });

    app.use(express.static(rootDir + '/public'));
    app.get('/sw.js', (req, res) => res.sendFile(rootDir + '/sw.js'));
    app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));
    app.get('/status', createStatusHandler({ getFirebaseRuntime }));

    return Object.freeze({ app, server: http.createServer(app) });
}

module.exports = Object.freeze({ createHttpServer, createStatusHandler });
