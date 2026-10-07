'use strict';

function loadEnvironment() {
    try {
        return require('dotenv').config();
    } catch (error) {
        return undefined;
    }
}

module.exports = Object.freeze({ loadEnvironment });
