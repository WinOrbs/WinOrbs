'use strict';

const express = require('express');
const http = require('http');
const { Resend } = require('resend');
const { SERVER_DEFAULTS } = require('../config/defaults');
const { createStructuredLogger } = require('../observability/logger');
const { createRateLimiter } = require('../platform/rate_limit');

function safeFirestoreError(error) {
    const code = error && error.code;
    return typeof code === 'string' && /^[A-Z][A-Z0-9_-]{0,63}$/.test(code)
        ? code
        : 'FIRESTORE_UNAVAILABLE';
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function safePasswordResetErrorCode(error) {
    const code = error && error.code;
    return typeof code === 'string' && /^[A-Za-z0-9/_-]{1,64}$/.test(code)
        ? code
        : 'RESET_DELIVERY_FAILED';
}

function createPasswordResetHandler({
    getFirebaseRuntime,
    resendClient,
    resendFromEmail,
    logger,
    rateLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 })
} = {}) {
    return async function passwordResetHandler(req, res) {
        const email = typeof req.body?.email === 'string'
            ? req.body.email.trim().toLowerCase()
            : '';
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'INVALID_EMAIL' });
        }
        if (!rateLimiter(req.ip || req.socket.remoteAddress)) {
            return res.status(429).json({ error: 'RATE_LIMITED' });
        }
        if (!resendClient || !resendFromEmail) {
            logger.error('auth.password_reset.not_configured', {
                apiKeyConfigured: Boolean(resendClient),
                senderConfigured: Boolean(resendFromEmail)
            });
            return res.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
        }

        try {
            const firebaseAdmin = getFirebaseRuntime()?.firebaseAdmin;
            const auth = firebaseAdmin && firebaseAdmin.auth();
            if (!auth || typeof auth.generatePasswordResetLink !== 'function') {
                throw new Error('Firebase Admin Auth is unavailable');
            }

            const resetLink = await auth.generatePasswordResetLink(email);
            const safeLink = escapeHtml(resetLink);
            const result = await resendClient.emails.send({
                from: resendFromEmail,
                to: [email],
                subject: 'Recupera tu acceso a WinOrbs',
                html: `
                    <div style="font-family: sans-serif; color: #17202a;">
                        <h2>Restablecer contraseña</h2>
                        <p>Has solicitado restablecer tu contraseña de WinOrbs.</p>
                        <p><a href="${safeLink}">Restablecer contraseña</a></p>
                        <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
                    </div>
                `,
                text: `Restablece tu contraseña de WinOrbs: ${resetLink}\n\nSi no solicitaste este cambio, ignora este correo.`
            });
            if (result?.error || !result?.data?.id) {
                throw result?.error || new Error('Resend did not confirm the email');
            }
        } catch (error) {
            logger.warn('auth.password_reset.delivery_failed', {
                errorCode: safePasswordResetErrorCode(error)
            });
        }

        return res.status(202).json({
            ok: true,
            message: 'Si existe una cuenta con ese correo, recibirá instrucciones para restablecer la contraseña.'
        });
    };
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
    resendApiKey = process.env.RESEND_API_KEY || '',
    resendFromEmail = process.env.RESEND_FROM_EMAIL || 'WinOrbs <onboarding@resend.dev>',
    resendClient,
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
    const passwordResetClient = resendClient || (resendApiKey ? new Resend(resendApiKey) : null);
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

    app.use(express.json({ limit: '10kb' }));
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
    app.post('/api/enviar-correo-recuperacion', createPasswordResetHandler({
        getFirebaseRuntime,
        resendClient: passwordResetClient,
        resendFromEmail,
        logger
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

module.exports = Object.freeze({ createHttpServer, createStatusHandler, createPasswordResetHandler });
