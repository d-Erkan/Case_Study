'use strict';

/**
 * Named steps for multi-call scenarios: a failure message says *which* step of the
 * workflow broke, e.g. `Step 5 "moderator publishes the tutorial" failed: ...`.
 */
function createStepper() {
  let n = 0;
  return async function step(name, fn) {
    n += 1;
    try {
      return await fn();
    } catch (err) {
      if (err && typeof err.message === 'string') err.message = `Step ${n} "${name}" failed:\n${err.message}`;
      throw err;
    }
  };
}

module.exports = { createStepper };
