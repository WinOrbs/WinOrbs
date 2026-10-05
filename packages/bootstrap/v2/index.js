'use strict';

const contracts = require('../../contracts/v2');
const gameEngineModule = require('../../game-engine/v2');
const { createMatchCoordinator } = require('../../match-coordinator/v2');
const { createIdentityService } = require('../../identity/v2');
const { createApplicationBoundary } = require('../../application/v2');
const { createMatchPersistence } = require('../../match-persistence/v2');
const { createApplicationRecoveryBoundary } = require('../../application-recovery/v2');
const { createObservabilityService } = require('../../observability/v2');
const { createEconomyService } = require('../../economy/v2');
const { createSettlementService } = require('../../settlement/v2');
const { createSocketIoTransport } = require('../../transport/socketio/v2');

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasMethod(value, method) {
    return !!value && typeof value[method] === 'function';
}

function defaultEconomyPolicies() {
    return {
        'v1': {
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
    };
}

function ensureIdentityService(identity, context) {
    if (!identity ||
        !hasMethod(identity, 'authenticate') ||
        !hasMethod(identity, 'requirePermission') ||
        !hasMethod(identity, 'consumeSystemOperation')) {
        throw new TypeError(`${context} requires a valid Identity service`);
    }
    return identity;
}

function ensurePersistence(persistence) {
    if (!persistence || !isRecord(persistence) || typeof persistence.runInTransaction !== 'function') {
        throw new TypeError('Persistence repositories are required');
    }
    return persistence;
}

function createWinOrbsV2(options = {}) {
    if (!isRecord(options)) {
        throw new TypeError('Bootstrap options must be an object');
    }

    const clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
    const randomSource = typeof options.randomSource === 'function'
        ? options.randomSource
        : () => Math.random();
    const matchId = typeof options.matchId === 'string' && options.matchId.trim()
        ? options.matchId
        : 'bootstrap-v2-match';

    const identity = options.identity || (
        typeof options.identityFactory === 'function'
            ? options.identityFactory({
                clock,
                randomSource,
                ...options.identityConfig
            })
            : null
    );
    ensureIdentityService(identity, 'Identity');

    const coordinatorOptions = {
        matchId,
        clock,
        rulesVersion: options.rulesVersion || 'v2',
        ...options.coordinatorOptions
    };
    const matchCoordinator = options.matchCoordinator || (
        typeof options.matchCoordinatorFactory === 'function'
            ? options.matchCoordinatorFactory(coordinatorOptions)
            : createMatchCoordinator(coordinatorOptions)
    );
    if (!matchCoordinator ||
        !hasMethod(matchCoordinator, 'createMatch') ||
        !hasMethod(matchCoordinator, 'getSnapshot') ||
        !hasMethod(matchCoordinator, 'submitCommand')) {
        throw new TypeError('Match Coordinator is required');
    }

    const application = options.application || (
        typeof options.applicationFactory === 'function'
            ? options.applicationFactory({ identity, coordinator: matchCoordinator, matchId })
            : createApplicationBoundary({ identity, coordinator: matchCoordinator, matchId })
    );
    if (!application ||
        !hasMethod(application, 'joinMatch') ||
        !hasMethod(application, 'submitGameCommand') ||
        !hasMethod(application, 'getMatchSnapshot')) {
        throw new TypeError('Application Boundary is required');
    }

    const persistence = ensurePersistence(
        options.persistence || (
            typeof options.persistenceFactory === 'function'
                ? options.persistenceFactory({ clock, randomSource })
                : null
        )
    );

    const matchPersistence = options.matchPersistence || (
        typeof options.matchPersistenceFactory === 'function'
            ? options.matchPersistenceFactory({ persistence, clock })
            : createMatchPersistence({ persistence, clock })
    );
    if (!matchPersistence ||
        !hasMethod(matchPersistence, 'createMatch') ||
        !hasMethod(matchPersistence, 'loadMatch') ||
        !hasMethod(matchPersistence, 'recoverMatch')) {
        throw new TypeError('Match Persistence/Recovery is required');
    }

    const applicationRecovery = options.applicationRecovery || (
        typeof options.applicationRecoveryFactory === 'function'
            ? options.applicationRecoveryFactory({ identity, recoveryService: matchPersistence })
            : createApplicationRecoveryBoundary({ identity, recoveryService: matchPersistence })
    );
    if (!applicationRecovery ||
        !hasMethod(applicationRecovery, 'recoverMatch') ||
        !hasMethod(applicationRecovery, 'getMatchSnapshot')) {
        throw new TypeError('Application Recovery Boundary is required');
    }

    const observabilitySink = options.observabilitySink || options.observability || null;
    const observability = options.observability || (
        typeof options.observabilityFactory === 'function'
            ? options.observabilityFactory({ sink: observabilitySink, clock })
            : (observabilitySink && typeof observabilitySink.write === 'function'
                ? createObservabilityService({ sink: observabilitySink.write.bind(observabilitySink), clock })
                : (observabilitySink && typeof observabilitySink === 'function'
                    ? createObservabilityService({ sink: observabilitySink, clock })
                    : null))
    );
    if (!observability ||
        !hasMethod(observability, 'logEvent') ||
        !hasMethod(observability, 'createCorrelationContext')) {
        throw new TypeError('Observability service is required');
    }

    const policies = options.economyPolicies || defaultEconomyPolicies();
    const economy = options.economy || (
        typeof options.economyFactory === 'function'
            ? options.economyFactory({ persistence, policies, clock, idFactory: options.idFactory })
            : createEconomyService({
                persistence,
                policies,
                clock,
                idFactory: options.idFactory || (() => (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
                    ? globalThis.crypto.randomUUID()
                    : `seed-${Math.random().toString(16).slice(2)}`))
            })
    );
    if (!economy ||
        !hasMethod(economy, 'openPaidMatch') ||
        !hasMethod(economy, 'prepareSettlement') ||
        !hasMethod(economy, 'settleMatch')) {
        throw new TypeError('Economy Core is required');
    }

    const authorizeSystem = options.authorizeSystem;
    if (typeof authorizeSystem !== 'function') {
        throw new TypeError('System authorization adapter is required for Settlement');
    }
    const settlement = options.settlement || (
        typeof options.settlementFactory === 'function'
            ? options.settlementFactory({ economy, persistence, authorizeSystem, clock })
            : createSettlementService({ economy, persistence, authorizeSystem, clock })
    );
    if (!settlement ||
        !hasMethod(settlement, 'settle') ||
        !hasMethod(settlement, 'getSettlement') ||
        !hasMethod(settlement, 'retrySettlement')) {
        throw new TypeError('Settlement Service is required');
    }

    const root = {
        contracts,
        gameEngine: options.gameEngine || gameEngineModule,
        matchCoordinator,
        identity,
        application,
        matchPersistence,
        applicationRecovery,
        observability,
        economy,
        settlement,
        transport: undefined
    };

    const transportRequested = options.io || typeof options.transportFactory === 'function' || options.transport;
    if (transportRequested) {
        const io = options.io || (
            typeof options.transportFactory === 'function'
                ? options.transportFactory({ identity, application })
                : options.transport
        );
        if (io && typeof io.use === 'function' && typeof io.on === 'function') {
            root.transport = createSocketIoTransport({ io, identity, application });
        } else if (options.transport && typeof options.transport === 'object') {
            root.transport = options.transport;
        }
    }

    return Object.freeze(root);
}

module.exports = Object.freeze({
    createWinOrbsV2
});
