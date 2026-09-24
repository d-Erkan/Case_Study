'use strict';

const path = require('node:path');
const Sequencer = require('@jest/test-sequencer').default;

/**
 * Deterministic order: integration -> e2e -> destructive (process-crashing) tests last,
 * so a slow recovery from an intentional crash can never cascade into unrelated tests.
 */
const rank = (p) => {
  if (p.includes('resilience')) return 2;
  if (p.includes(`${path.sep}e2e${path.sep}`)) return 1;
  return 0;
};

class OrderedSequencer extends Sequencer {
  sort(tests) {
    return [...tests].sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
  }
}

module.exports = OrderedSequencer;
