'use strict';

const express = require('express');
const http = require('http');
const { SERVER_DEFAULTS } = require('../config/defaults');
const { createStructuredLogger } = require('../observability/logger');

function safeFirestoreError(error) {
    const code = error && error.code;
    return typeof code === 'string' && /^[A-Z][A-Z0-9_-]{0,63}$/.test(code)
        ? code
        : 'FIRESTORE_UNAVAILABLE';
}

function createStatusHandler({
    getFirebaseRuntime,
    now = () => Date.now(),
    probeTimeoutMs = 1000
} = {}) {
    if (typeof getFirebaseRuntime !== 'function') {
        throw new TypeError('A Firebase runtime provider is required');
    }
    if (!Number.isSafeInteger(probeTimeoutMs) || probeTimeoutMs < 1) {
        throw new TypeError('A positive Firestore probe timeout is required');
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
                let timeout;
                try {
                    await Promise.race([
                        database.collection('diagnostico').doc('ping').get(),
                        new Promise((resolve, reject) => {
                            timeout = setTimeout(() => {
                                const error = new Error('Firestore probe timed out');
                                error.code = 'DEADLINE_EXCEEDED';
                                reject(error);
                            }, probeTimeoutMs);
                        })
                    ]);
                    status.firestore.ok = true;
                    status.firestore.latenciaMs = now() - startedAt;
                } finally {
                    clearTimeout(timeout);
                }
            }
        } catch (error) {
            status.firestore.error = safeFirestoreError(error);
        }
        res.json(status);
    };
}

function createHttpServer({
    rootDir,
    isOriginAllowed,
    trustProxy = SERVER_DEFAULTS.trustProxy,
    getFirebaseRuntime,
    isReady = () => false,
    statusProbeTimeoutMs = 1000,
    logger = createStructuredLogger()
} = {}) {
    if (typeof rootDir !== 'string' || !rootDir) {
        throw new TypeError('A server root directory is required');
    }
    if (typeof isOriginAllowed !== 'function') {
        throw new TypeError('An origin policy is required');
    }
    if (typeof isReady !== 'function') {
        throw new TypeError('A readiness provider is required');
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
    app.get('/health', (req, res) => res.status(200).json({ ok: true }));
    app.get('/ready', (req, res) => {
        let ready = false;
        try {
            ready = isReady() === true;
        } catch {
            logger.warn('http.readiness.provider_failed', { ready: false });
        }
        return res.status(ready ? 200 : 503).json({ ready });
    });
    app.get('/status', createStatusHandler({
        getFirebaseRuntime,
        probeTimeoutMs: statusProbeTimeoutMs
    }));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        const statusCode = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
            ? error.status
            : 500;
        if (statusCode >= 500) {
            logger.error('http.request.failed', {
                method: req.method,
                statusCode,
                errorCode: 'HTTP_HANDLER_FAILED'
            });
        }
        return res.status(statusCode).json({
            error: statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'
        });
    });

    return Object.freeze({ app, server: http.createServer(app) });
}

module.exports = Object.freeze({ createHttpServer, createStatusHandler });
