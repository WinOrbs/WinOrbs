'use strict';

const fs = require('fs');
const { FIREBASE_DEFAULTS } = require('../config/defaults');
const { createStructuredLogger } = require('../observability/logger');

function safeErrorCode(error) {
    const code = error && error.code;
    return typeof code === 'string' && /^[A-Z][A-Z0-9_-]{0,63}$/.test(code)
        ? code
        : 'FIREBASE_UNAVAILABLE';
}

function initializeFirebase({
    baseDir,
    io,
    progression,
    firebaseConfig,
    env = process.env,
    fsModule = fs,
    adminModule,
    logger = createStructuredLogger(),
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
    const resolvedFirebaseConfig = firebaseConfig || {
        googleApplicationCredentials: env.GOOGLE_APPLICATION_CREDENTIALS || '',
        serviceAccount: env.FIREBASE_SERVICE_ACCOUNT || '',
        serviceAccountBase64: env.FIREBASE_SERVICE_ACCOUNT_B64 || '',
        serviceAccountFileName: FIREBASE_DEFAULTS.serviceAccountFileName,
        secretDirectory: FIREBASE_DEFAULTS.secretDirectory
    };
    const credentialEnv = {
        GOOGLE_APPLICATION_CREDENTIALS: resolvedFirebaseConfig.googleApplicationCredentials,
        FIREBASE_SERVICE_ACCOUNT: resolvedFirebaseConfig.serviceAccount,
        FIREBASE_SERVICE_ACCOUNT_B64: resolvedFirebaseConfig.serviceAccountBase64
    };

    try {
        firebaseAdmin = adminModule || require('firebase-admin');
        const secretDirectory = resolvedFirebaseConfig.secretDirectory;
        const candidates = [
            credentialEnv.FIREBASE_SERVICE_ACCOUNT,
            baseDir + '/' + resolvedFirebaseConfig.serviceAccountFileName,
            secretDirectory + '/' + resolvedFirebaseConfig.serviceAccountFileName
        ].filter(Boolean);
        let serviceAccount = null;
        if (credentialEnv.GOOGLE_APPLICATION_CREDENTIALS) {
            firebaseAdmin.initializeApp({
                credential: firebaseAdmin.credential.applicationDefault()
            });
            serviceAccount = true;
        } else {
            if (credentialEnv.FIREBASE_SERVICE_ACCOUNT_B64) {
                try {
                    serviceAccount = JSON.parse(
                        Buffer.from(credentialEnv.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')
                    );
                } catch (error) {
                    logger.warn('firebase.credential.invalid', { source: 'base64' });
                }
            } else if (credentialEnv.FIREBASE_SERVICE_ACCOUNT &&
                credentialEnv.FIREBASE_SERVICE_ACCOUNT.trim().startsWith('{')) {
                try {
                    serviceAccount = JSON.parse(credentialEnv.FIREBASE_SERVICE_ACCOUNT);
                } catch (error) {
                    logger.warn('firebase.credential.invalid', { source: 'inline' });
                }
            }
            if (!serviceAccount && credentialEnv.FIREBASE_SERVICE_ACCOUNT) {
                let text = credentialEnv.FIREBASE_SERVICE_ACCOUNT.trim();
                if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
                    text = text.slice(1, -1);
                }
                try {
                    const parsed = JSON.parse(text);
                    if (parsed && typeof parsed === 'object' && parsed.client_email) {
                        serviceAccount = parsed;
                        logger.info('firebase.credential.loaded', { source: 'inline' });
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
                        logger.info('firebase.credential.loaded', { source: 'configured-file' });
                        break;
                    } catch (error) {
                        logger.warn('firebase.credential.unreadable', { source: 'configured-file' });
                    }
                }
            }
            if (!serviceAccount) {
                try {
                    if (fsModule.existsSync(secretDirectory)) {
                        const secretFiles = fsModule.readdirSync(secretDirectory)
                            .filter((file) => file.endsWith('.json'));
                        for (const file of secretFiles) {
                            try {
                                const text = fsModule.readFileSync(secretDirectory + '/' + file, 'utf8');
                                if (text.includes('"private_key"') && text.includes('"client_email"')) {
                                    serviceAccount = JSON.parse(text);
                                    logger.info('firebase.credential.loaded', { source: 'secret-directory' });
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
                logger.error('firebase.progression_listener.failed', {
                    errorCode: safeErrorCode(error)
                });
            });
            logger.info('firebase.economy.enabled');
        } else {
            logger.warn('firebase.economy.disabled');
        }
    } catch (error) {
        logger.error('firebase.initialization.failed', {
            errorCode: safeErrorCode(error)
        });
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
