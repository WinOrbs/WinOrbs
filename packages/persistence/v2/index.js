'use strict';

const REPOSITORY_METHODS = Object.freeze({
    UserRepository: Object.freeze(['getById', 'create', 'update']),
    WalletRepository: Object.freeze(['getByUserId', 'create', 'update']),
    LedgerRepository: Object.freeze(['getById', 'listByMatch', 'append']),
    MatchRepository: Object.freeze(['getById', 'create', 'update', 'claimSettlement']),
    InventoryRepository: Object.freeze(['getByUserId', 'replaceForUser']),
    ProgressionRepository: Object.freeze(['getByUserId', 'replaceForUser']),
    RewardRepository: Object.freeze(['getById', 'create', 'update']),
    PaymentRepository: Object.freeze(['getById', 'create', 'update']),
    AuditRepository: Object.freeze(['append', 'listByAggregate']),
    IdempotencyRepository: Object.freeze(['getByKey', 'claim']),
    OutboxRepository: Object.freeze(['getById', 'enqueue', 'listPending', 'markPublished'])
});

class PersistenceContractError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PersistenceContractError';
    }
}

function assertRepository(repository, name, methods = REPOSITORY_METHODS[name]) {
    if (!methods || !repository || typeof repository !== 'object') {
        throw new PersistenceContractError(`Unknown or missing repository: ${name}`);
    }
    for (const method of methods) {
        if (typeof repository[method] !== 'function') {
            throw new PersistenceContractError(`${name}.${method} must be implemented`);
        }
    }
    return repository;
}

function assertRepositories(repositories) {
    if (!repositories || typeof repositories !== 'object') {
        throw new PersistenceContractError('Persistence repositories are required');
    }
    for (const name of Object.keys(REPOSITORY_METHODS)) {
        assertRepository(repositories[name], name);
    }
    if (typeof repositories.runInTransaction !== 'function') {
        throw new PersistenceContractError('runInTransaction must be implemented');
    }
    return repositories;
}

module.exports = Object.freeze({
    REPOSITORY_METHODS,
    PersistenceContractError,
    assertRepository,
    assertRepositories
});
