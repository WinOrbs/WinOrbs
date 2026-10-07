'use strict';

const fs = require('fs');

function initializeFirebase({
    baseDir,
    io,
    progression,
    env = process.env,
    fsModule = fs,
    adminModule,
    logger = console,
    onRewardsChanged = () => {}
} = {}) {
    if (typeof baseDir !== 'string' || !baseDir) {
        throw new TypeError('A server base directory is required');
    }
    if (!progression || typeof progression.createProgressionRuntime !== 'function') {
        throw new TypeError('Progression runtime dependencies are required');
    }

    const {
        DEFAULT_LEVEL_CURVE,
        DEFAULT_VISUAL_REWARDS,
        MAX_LEVEL,
        createProgressionRuntime,
        missionConfig,
        sanitizeVisualRewards
    } = progression;

    let firebaseAdmin = null;
    let database = null;
    let economy = false;
    let progressionRuntime = null;
    let progressionRewards = sanitizeVisualRewards(DEFAULT_VISUAL_REWARDS);

    try {
        firebaseAdmin = adminModule || require('firebase-admin');
        const candidates = [
            env.FIREBASE_SERVICE_ACCOUNT,
            baseDir + '/serviceAccountKey.json',
            '/etc/secrets/serviceAccountKey.json'
        ].filter(Boolean);
        let serviceAccount = null;
        if (env.GOOGLE_APPLICATION_CREDENTIALS) {
            firebaseAdmin.initializeApp({
                credential: firebaseAdmin.credential.applicationDefault()
            });
            serviceAccount = true;
        } else {
            if (env.FIREBASE_SERVICE_ACCOUNT_B64) {
                try {
                    serviceAccount = JSON.parse(
                        Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')
                    );
                } catch (error) {
                    logger.warn(
                        '[FIREBASE] FIREBASE_SERVICE_ACCOUNT_B64 presente pero no es Base64/JSON válido:',
                        error.message
                    );
                }
            } else if (env.FIREBASE_SERVICE_ACCOUNT &&
                env.FIREBASE_SERVICE_ACCOUNT.trim().startsWith('{')) {
                try {
                    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
                } catch (error) {
                    logger.warn('[FIREBASE] FIREBASE_SERVICE_ACCOUNT es JSON inválido:', error.message);
                }
            }
            if (!serviceAccount && env.FIREBASE_SERVICE_ACCOUNT) {
                let text = env.FIREBASE_SERVICE_ACCOUNT.trim();
                if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
                    text = text.slice(1, -1);
                }
                try {
                    const parsed = JSON.parse(text);
                    if (parsed && typeof parsed === 'object' && parsed.client_email) {
                        serviceAccount = parsed;
                        logger.log('[FIREBASE] Clave de servicio cargada desde FIREBASE_SERVICE_ACCOUNT (inline).');
                    }
                } catch (error) {
                    // A file path is tried below when the value is not inline JSON.
                }
            }
            if (!serviceAccount) {
                for (const candidate of candidates) {
                    try {
                        if (!fsModule.existsSync(candidate)) continue;
                        serviceAccount = JSON.parse(fsModule.readFileSync(candidate, 'utf8'));
                        logger.log('[FIREBASE] Clave de servicio cargada desde: ' + candidate);
                        break;
                    } catch (error) {
                        logger.warn('[FIREBASE] No se pudo usar la clave en ' + candidate + ':', error.message);
                    }
                }
            }
            if (!serviceAccount) {
                try {
                    if (fsModule.existsSync('/etc/secrets')) {
                        const secretFiles = fsModule.readdirSync('/etc/secrets')
                            .filter((file) => file.endsWith('.json'));
                        for (const file of secretFiles) {
                            try {
                                const text = fsModule.readFileSync('/etc/secrets/' + file, 'utf8');
                                if (text.includes('"private_key"') && text.includes('"client_email"')) {
                                    serviceAccount = JSON.parse(text);
                                    logger.log('[FIREBASE] Clave de servicio detectada en /etc/secrets/' + file);
                                    break;
                                }
                            } catch (error) {
                                // Ignore unreadable files and continue looking for a service account.
                            }
                        }
                    }
                } catch (error) {
                    // The secrets directory may not exist or may not be readable.
                }
            }
            if (serviceAccount && typeof serviceAccount === 'object') {
                firebaseAdmin.initializeApp({
                    credential: firebaseAdmin.credential.cert(serviceAccount),
                    projectId: serviceAccount.project_id || undefined
                });
            }
        }
        if (serviceAccount) {
            database = firebaseAdmin.firestore();
            economy = true;
            progressionRuntime = createProgressionRuntime({ firestore: database });
            database.collection('configuracion').doc('progresion').onSnapshot((snapshot) => {
                if (!snapshot.exists) return;
                progressionRewards = sanitizeVisualRewards((snapshot.data() || {}).recompensas);
                onRewardsChanged(progressionRewards);
                io.emit('progressionConfigUpdated', {
                    visualRewards: progressionRewards,
                    dailyMissions: missionConfig(),
                    maxLevel: MAX_LEVEL,
                    levelCurve: DEFAULT_LEVEL_CURVE
                });
            }, (error) => {
                logger.error('[PROGRESSION] Could not watch visual reward configuration:', error.message);
            });
            logger.log('[FIREBASE] Modo economía SEGURA activado (Admin SDK). El servidor maneja entradas y premios.');
        } else {
            logger.log('[FIREBASE] Sin clave de servicio: ECONOMÍA DESHABILITADA. Entradas y premios no se liquidan hasta configurar Admin SDK; el cliente nunca gestiona dinero.');
            logger.log('[FIREBASE] FIX Render: Firebase Console → Cuentas de servicio → Generar clave privada → en Render crea un Secret File "serviceAccountKey.json" (o la env FIREBASE_SERVICE_ACCOUNT_B64 con el JSON en Base64) y reinicia el servicio. Verifica en GET /status.');
        }
    } catch (error) {
        logger.warn('[FIREBASE] firebase-admin no disponible:', error.message);
    }

    return Object.freeze({
        firebaseAdmin,
        database,
        economy,
        progressionRuntime,
        progressionRewards
    });
}

module.exports = Object.freeze({ initializeFirebase });
