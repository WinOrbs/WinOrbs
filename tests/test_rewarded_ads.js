'use strict';

const assert = require('assert');
const {
    rewardedAdsConfig,
    validPracticeAdStatus
} = require('../apps/server/platform/rewarded_ads');

assert.deepStrictEqual(rewardedAdsConfig('/1234567/games/bot_practice'), {
    provider: 'google-publisher-tag',
    enabled: true,
    adUnitPath: '/1234567/games/bot_practice'
});
for (const invalidPath of [
    '',
    '/network/path',
    '/1234567/../secret',
    '/1234567/unit?param=value',
    'https://example.com/ad'
]) {
    assert.deepStrictEqual(rewardedAdsConfig(invalidPath), {
        provider: 'google-publisher-tag',
        enabled: false,
        adUnitPath: ''
    });
}
assert.strictEqual(validPracticeAdStatus('completed'), true);
assert.strictEqual(validPracticeAdStatus('unavailable'), true);
assert.strictEqual(validPracticeAdStatus('closed'), false);
assert.strictEqual(validPracticeAdStatus(undefined), false);

console.log('OK rewarded ads: safe ad-unit configuration and practice unlock states validate.');
