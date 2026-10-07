'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initializeFirebase } = require('../apps/server/infrastructure/firebase');

const saValido = {
    type: 'service_account',
    project_id: 'proyecto-test',
    private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
    client_email: 'algo@proyecto-test.iam.gserviceaccount.com'
};

function makeAdmin() {
    const calls = { initializeApp: [], cert: [], applicationDefault: 0, listener: null };
    const database = {
        collection: (collectionName) => ({
            doc: (documentId) => ({
                onSnapshot: (callback) => { calls.listener = { collectionName, documentId, callback }; }
            })
        })
    };
    return {
        calls,
        database,
        initializeApp: (config) => { calls.initializeApp.push(config); },
        credential: {
            cert: (serviceAccount) => {
                calls.cert.push(serviceAccount);
                return { type: 'certificate' };
            },
            applicationDefault: () => {
                calls.applicationDefault++;
                return { type: 'application-default' };
            }
        },
        firestore: () => database
    };
}

function makeProgression() {
    return {
        DEFAULT_LEVEL_CURVE: { version: 'test' },
        DEFAULT_VISUAL_REWARDS: [{ id: 'default' }],
        MAX_LEVEL: 100,
        createProgressionRuntime: ({ firestore }) => ({ firestore }),
        missionConfig: () => [{ id: 'test-mission' }],
        sanitizeVisualRewards: (rewards) => rewards || [{ id: 'default' }]
    };
}

function run(env, baseDir, {
    fsModule = fs,
    admin = makeAdmin(),
    io,
    logs = [],
    onRewardsChanged
} = {}) {
    const runtime = initializeFirebase({
        baseDir,
        io: io || { emit: (...args) => logs.push(['emit', ...args]) },
        progression: makeProgression(),
        env,
        fsModule,
        adminModule: admin,
        onRewardsChanged,
        logger: {
            log: (...args) => logs.push(['log', ...args]),
            warn: (...args) => logs.push(['warn', ...args]),
            error: (...args) => logs.push(['error', ...args])
        }
    });
    return { runtime, admin, logs };
}

function assertEconomyEnabled(result, expectedAccount) {
    assert.strictEqual(result.runtime.economy, true);
    assert.strictEqual(result.runtime.database, result.admin.database);
    assert.strictEqual(result.admin.calls.initializeApp.length, 1);
    if (expectedAccount) {
        assert.strictEqual(result.admin.calls.cert.length, 1);
        assert.strictEqual(result.admin.calls.cert[0].project_id, 'proyecto-test');
    }
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'winorbs-firebase-'));
try {
    fs.writeFileSync(
        path.join(temporaryDirectory, 'serviceAccountKey.json'),
        JSON.stringify(saValido)
    );

    let result = run({}, temporaryDirectory);
    assertEconomyEnabled(result, true);
    assert.strictEqual(result.admin.calls.listener.collectionName, 'configuracion');
    assert.strictEqual(result.admin.calls.listener.documentId, 'progresion');

    result = run(
        { FIREBASE_SERVICE_ACCOUNT: path.join(temporaryDirectory, 'serviceAccountKey.json') },
        path.join(temporaryDirectory, 'missing')
    );
    assertEconomyEnabled(result, true);

    result = run(
        { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(saValido) },
        path.join(temporaryDirectory, 'missing')
    );
    assertEconomyEnabled(result, true);

    result = run(
        { FIREBASE_SERVICE_ACCOUNT: '"' + JSON.stringify(saValido) + '"' },
        path.join(temporaryDirectory, 'missing')
    );
    assertEconomyEnabled(result, true);

    result = run(
        { FIREBASE_SERVICE_ACCOUNT_B64: Buffer.from(JSON.stringify(saValido)).toString('base64') },
        path.join(temporaryDirectory, 'missing')
    );
    assertEconomyEnabled(result, true);

    result = run(
        { GOOGLE_APPLICATION_CREDENTIALS: '/x.json' },
        temporaryDirectory
    );
    assertEconomyEnabled(result, false);
    assert.strictEqual(result.admin.calls.applicationDefault, 1);
    assert.strictEqual(result.admin.calls.cert.length, 0);

    result = run({}, path.join(temporaryDirectory, 'missing'));
    assert.strictEqual(result.runtime.economy, false);
    assert.strictEqual(result.runtime.database, null);

    const secretDirectoryFs = {
        ...fs,
        existsSync: (filePath) => filePath === '/etc/secrets',
        readdirSync: (directory) => {
            if (directory === '/etc/secrets') return ['other.json', 'serviceaccountkey.json'];
            throw new Error('not found');
        },
        readFileSync: (filePath) => {
            if (filePath === '/etc/secrets/serviceaccountkey.json') return JSON.stringify(saValido);
            throw new Error('not found');
        }
    };
    result = run({}, path.join(temporaryDirectory, 'missing'), { fsModule: secretDirectoryFs });
    assertEconomyEnabled(result, true);

    const corruptFileFs = {
        ...fs,
        existsSync: (filePath) =>
            filePath === '/etc/secrets/serviceAccountKey.json' || filePath === '/etc/secrets',
        readFileSync: (filePath) => {
            if (filePath === '/etc/secrets/serviceAccountKey.json') return '{ invalid';
            throw new Error('not found');
        }
    };
    result = run({}, path.join(temporaryDirectory, 'missing'), { fsModule: corruptFileFs });
    assert.strictEqual(result.runtime.economy, false);

    const emitted = [];
    const rewardUpdates = [];
    result = run(
        { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(saValido) },
        temporaryDirectory,
        {
            io: { emit: (...args) => emitted.push(args) },
            onRewardsChanged: (rewards) => rewardUpdates.push(rewards)
        }
    );
    result.admin.calls.listener.callback({
        exists: true,
        data: () => ({ recompensas: [{ id: 'configured' }] })
    });
    assert.deepStrictEqual(emitted[0][0], 'progressionConfigUpdated');
    assert.deepStrictEqual(emitted[0][1].visualRewards, [{ id: 'configured' }]);
    assert.deepStrictEqual(rewardUpdates, [[{ id: 'configured' }]]);

    console.log('OK Firebase initialization: credential sources, disabled mode, and progression config listener.');
} finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
