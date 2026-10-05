'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    MATCH_PERMISSIONS,
    createIdentityService
} = require('../packages/identity/v2');
const { createMatchCoordinator } = require('../packages/match-coordinator/v2');
const { createMatchPersistence } = require('../packages/match-persistence/v2');
const { createObservabilityService } = require('../packages/observability/v2');
const { createEconomyService } = require('../packages/economy/v2');
const { createSettlementService } = require('../packages/settlement/v2');
const { createApplicationBoundary } = require('../packages/application/v2');
const { createApplicationRecoveryBoundary } = require('../packages/application-recovery/v2');
const { createWinOrbsV2 } = require('../packages/bootstrap/v2');

function makePersistence() {
    const repos = {
        UserRepository: {
            getById: async () => null,
            create: async () => null,
            update: async () => null
        },
        WalletRepository: {
            getByUserId: async () => null,
            create: async () => null,
            update: async () => null
        },
        LedgerRepository: {
            getById: async () => null,
            listByMatch: async () => [],
            append: async () => null
        },
        MatchRepository: {
            getById: async () => null,
            create: async () => null,
            update: async () => null,
            claimSettlement: async () => null
        },
        InventoryRepository: {
            getByUserId: async () => null,
            replaceForUser: async () => null
        },
        ProgressionRepository: {
            getByUserId: async () => null,
            replaceForUser: async () => null
        },
        RewardRepository: {
            getById: async () => null,
            create: async () => null,
            update: async () => null
        },
        PaymentRepository: {
            getById: async () => null,
            create: async () => null,
            update: async () => null
        },
        AuditRepository: {
            append: async () => null,
            listByAggregate: async () => []
        },
        IdempotencyRepository: {
            getByKey: async () => null,
            claim: async () => null
        },
        OutboxRepository: {
            getById: async () => null,
            enqueue: async () => null,
            listPending: async () => [],
            markPublished: async () => null
        }
    };
    repos.runInTransaction = async (callback) => callback({
        ...repos,
        transaction: { }
    });
    return repos;
}

function makeIdentity() {
    return createIdentityService({
        authenticate: async (credential) => ({
            ok: true,
            userId: credential || 'player-1',
            provider: 'bootstrap',
            sessionId: 'session-1',
            expiresAt: 10_000_000
        }),
        resolveAuthorization: async () => ({
            roles: ['player'],
            permissions: MATCH_PERMISSIONS
        }),
        validateSession: async () => true,
        verifySystemOperation: async () => true,
        clock: () => 1_000
    });
}

function makeValidOptions(extra = {}) {
    const clock = () => 1_000;
    const persistence = makePersistence();
    const identity = makeIdentity();
    const matchId = 'match-boot';
    const coordinator = createMatchCoordinator({
        matchId,
        clock,
        rulesVersion: 'v2',
        durationMs: 10_000,
        zone: { center: { x: 0, y: 0 }, radius: 50 },
        bankZone: { center: { x: 0, y: 0 }, radius: 10 }
    });
    const observabilitySink = { write: async () => {} };
    const observability = createObservabilityService({
        sink: observabilitySink,
        clock
    });
    const matchPersistence = createMatchPersistence({ persistence, clock });
    const applicationRecovery = createApplicationRecoveryBoundary({
        identity,
        recoveryService: matchPersistence
    });
    const application = createApplicationBoundary({
        identity,
        coordinator,
        matchId
    });
    const economy = createEconomyService({
        persistence,
        policies: {
            v1: {
                version: 'v1',
                mode: 'PAID',
                currency: 'USD',
                stakeMinor: 100,
                houseFeeBps: 500,
                houseAccountId: 'house-account',
                escrowAccountId: 'escrow-account',
                allowNegativeBalance: false,
                processingLeaseMs: 60000
            }
        },
        clock
    });
    const settlement = createSettlementService({
        economy,
        persistence,
        authorizeSystem: async () => true,
        clock
    });
    return {
        clock,
        matchId,
        persistence,
        identity,
        observability,
        observabilitySink,
        coordinator,
        matchCoordinator: coordinator,
        matchPersistence,
        application,
        applicationRecovery,
        economy,
        settlement,
        authorizeSystem: async () => true,
        ...extra
    };
}

async function run() {
    const identityFixture = makeIdentity();
    const options = makeValidOptions({ identity: identityFixture });
    const root = createWinOrbsV2(options);
    assert.ok(root.contracts);
    assert.ok(root.gameEngine);
    assert.ok(root.matchCoordinator);
    assert.ok(root.identity);
    assert.ok(root.application);
    assert.ok(root.matchPersistence);
    assert.ok(root.applicationRecovery);
    assert.ok(root.observability);
    assert.ok(root.economy);
    assert.ok(root.settlement);
    assert.strictEqual(root.identity, identityFixture, 'The root should retain the provided identity');
    assert.strictEqual(root.matchCoordinator, options.matchCoordinator, 'The coordinator reference should be retained');
    assert.strictEqual(typeof root.contracts, 'object');

    const rootWithAllLayers = createWinOrbsV2(makeValidOptions({
        io: { use: () => {}, on: () => {}, emit: () => {} }
    }));
    assert.ok(rootWithAllLayers.transport);
    assert.strictEqual(typeof rootWithAllLayers.transport.getAuthenticatedPrincipal, 'function');

    assert.throws(() => createWinOrbsV2({
        clock: () => 1,
        noIdentity: true
    }), /Identity requires a valid Identity service/);

    assert.throws(() => createWinOrbsV2({
        identity: makeIdentity(),
        persistence: null,
        authorizeSystem: async () => true
    }), /Persistence repositories are required/);

    const reusedIdentity = makeIdentity();
    const shared = createWinOrbsV2({ ...makeValidOptions(), identity: reusedIdentity });
    assert.strictEqual(shared.identity, reusedIdentity);

    const customCoordinator = createMatchCoordinator({
        matchId: 'custom-match',
        clock: () => 1,
        rulesVersion: 'v2'
    });
    const configured = createWinOrbsV2({
        ...makeValidOptions(),
        matchCoordinator: customCoordinator
    });
    assert.strictEqual(configured.matchCoordinator, customCoordinator);

    const invalidOptions = { identity: {}, persistence: {} };
    assert.throws(() => createWinOrbsV2(invalidOptions), /requires a valid Identity service/);

    assert.strictEqual(typeof root.matchCoordinator.createMatch, 'function');
    assert.strictEqual(typeof root.application.joinMatch, 'function');
    assert.strictEqual(typeof root.matchPersistence.loadMatch, 'function');
    assert.strictEqual(typeof root.applicationRecovery.recoverMatch, 'function');
    assert.strictEqual(typeof root.observability.logEvent, 'function');
    assert.strictEqual(typeof root.economy.openPaidMatch, 'function');
    assert.strictEqual(typeof root.settlement.settle, 'function');

    const source = fs.readFileSync(path.join(__dirname, '../packages/bootstrap/v2/index.js'), 'utf8');
    for (const forbidden of ['server.js', 'firebase', 'firestore', 'render', 'cloudflare']) {
        assert.strictEqual(source.toLowerCase().includes(forbidden), false, `Forbidden dependency: ${forbidden}`);
    }
    assert.strictEqual(source.includes('console.log'), false);

    const rootJson = JSON.stringify(root);
    assert.strictEqual(rootJson.includes('secret'), false);
    assert.strictEqual(rootJson.includes('token'), false);
    assert.strictEqual(rootJson.includes('credential'), false);
    assert.strictEqual(rootJson.includes('serviceAccount'), false);

    const bootstrapSource = fs.readFileSync(path.join(__dirname, '../packages/bootstrap/v2/index.js'), 'utf8');
    assert.strictEqual(bootstrapSource.includes('packages/bootstrap'), false);

    console.log('OK bootstrap v2: dependency graph is assembled without touching runtime or closed layers.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
