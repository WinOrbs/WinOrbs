'use strict';

const { createConfig } = require('./env');

const config = createConfig(process.env);

module.exports = Object.freeze({
    ...config,
    corsRaw: config.cors.origins,
    corsAllowAll: config.cors.allowAll,
    isOriginAllowed: config.cors.isOriginAllowed,
    createConfig
});
