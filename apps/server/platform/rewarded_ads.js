'use strict';

const AD_UNIT_PATH_PATTERN = /^\/\d{1,20}\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

function rewardedAdsConfig(adUnitPath) {
    const normalizedPath = typeof adUnitPath === 'string' ? adUnitPath.trim() : '';
    const valid = AD_UNIT_PATH_PATTERN.test(normalizedPath);
    return Object.freeze({
        provider: 'google-publisher-tag',
        enabled: valid,
        adUnitPath: valid ? normalizedPath : ''
    });
}

function validPracticeAdStatus(value) {
    return value === 'completed' || value === 'unavailable';
}

module.exports = Object.freeze({ rewardedAdsConfig, validPracticeAdStatus });
