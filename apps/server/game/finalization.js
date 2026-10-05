'use strict';

async function finalizeAfterProgression(processing, onFailure, finalize) {
    if (processing) {
        try {
            const result = await processing;
            if (!result || result.ok !== true) onFailure(result?.error || 'UNKNOWN_ERROR');
        } catch (error) {
            onFailure(error);
        }
    }
    finalize();
}

module.exports = Object.freeze({ finalizeAfterProgression });
