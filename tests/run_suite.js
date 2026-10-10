'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const suites = Object.freeze({
    unit: [
        'check_scripts.js',
        'check_game_js.js',
        'test_bombas.js',
        'test_bot_ai.js',
        'test_config_tasa.js',
        'test_configuration.js',
        'test_combat_domain.js',
        'test_deploy_config.js',
        'test_game_domain.js',
        'test_game_domain_api.js',
        'test_game_engine_v2.js',
        'test_html_scripts.js',
        'test_identity_domain.js',
        'test_intro.js',
        'test_lobby.js',
        'test_png_sprites.js',
        'test_red.js',
        'test_realtime_metrics.js',
        'test_retiros.js',
        'test_score_domain.js',
        'test_skins.js',
        'test_solo_tickets.js',
        'test_team_mode.js',
        'test_validation.js'
    ],
    integration: [
        'test_application_v2.js',
        'test_application_recovery_v2.js',
        'test_bootstrap_v2.js',
        'test_controlled_integration_v2.js',
        'test_firebase_init.js',
        'test_firestore_repository.js',
        'test_match_coordinator_v2.js',
        'test_match_persistence_v2.js',
        'test_observability_v2.js',
        'test_persistence_v2.js',
        'test_production_adapter_v2.js',
        'test_progression_runtime_integration.js',
        'test_results_domain.js',
        'test_runtime_harness_v2.js',
        'test_runtime_integration_v2.js',
        'test_settlement_v2.js',
        'test_status.js'
    ],
    security: [
        'test_admin_session_security.js',
        'test_administration_v2.js',
        'test_cosmetics_rate_limit.js',
        'test_identity_v2.js',
        'test_notifications_session.js',
        'test_rules_security.js',
        'test_security_config.js',
        'test_server_security_guards.js'
    ],
    contracts: [
        'test_socketio_transport_v2.js',
        'test_transport_validation.js',
        'test_types.js',
        'test_validation.js',
        'test_contracts_v2.js'
    ],
    persistence: [
        'test_application_recovery_v2.js',
        'test_economy_v2.js',
        'test_firebase_init.js',
        'test_firestore_repository.js',
        'test_idempotency.js',
        'test_match_persistence_v2.js',
        'test_persistence_v2.js',
        'test_settlement_v2.js',
        'test_solo_tickets.js'
    ],
    progression: [
        'test_platform_domain.js',
        'test_progression_runtime_integration.js',
        'test_progression_v2.js'
    ],
    runtime: [
        'test_application_v2.js',
        'test_bootstrap_v2.js',
        'test_controlled_integration_v2.js',
        'test_match_coordinator_v2.js',
        'test_production_adapter_v2.js',
        'test_runtime_harness_v2.js',
        'test_runtime_integration_v2.js',
        'test_status.js'
    ]
});

const requestedSuite = process.argv[2];
if (!requestedSuite || (requestedSuite !== 'all' && !suites[requestedSuite])) {
    console.error(
        `Usage: node tests/run_suite.js <${['all', ...Object.keys(suites)].join('|')}>`
    );
    process.exit(2);
}

const files = requestedSuite === 'all'
    ? [...new Set(Object.values(suites).flat())]
    : suites[requestedSuite];
const results = [];

for (const file of files) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, NODE_ENV: 'test' },
        stdio: 'inherit'
    });
    const passed = result.status === 0 && !result.error;
    results.push({ file, passed, status: result.status, signal: result.signal, error: result.error });
    console.log(`${passed ? 'PASS' : 'FAIL'} ${file}`);
}

const failures = results.filter((result) => !result.passed);
console.log(
    `\n${requestedSuite}: ${results.length - failures.length}/${results.length} test scripts passed.`
);
if (failures.length) {
    for (const failure of failures) {
        const reason = failure.error
            ? failure.error.message
            : failure.signal
                ? `terminated by ${failure.signal}`
                : `exit status ${failure.status}`;
        console.error(`  ${failure.file}: ${reason}`);
    }
    process.exitCode = 1;
}
