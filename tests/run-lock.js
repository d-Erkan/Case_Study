'use strict';

/**
 * All runs share one API + database, and every run starts by resetting it. Two
 * concurrent runs would silently corrupt each other (e.g. one wipes refresh tokens
 * the other is using), so a second run fails fast instead.
 */

const fs = require('node:fs');
const path = require('node:path');
const { STATE_DIR } = require('../lib/config');

const LOCK = path.join(STATE_DIR, 'run.lock');

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function acquireRunLock() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try {
    const { pid } = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    if (pid !== process.pid && isAlive(pid)) {
      throw new Error(`Another test run (pid ${pid}) is using the environment. Wait for it or delete ${LOCK}.`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
  }
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
}

function releaseRunLock() {
  fs.rmSync(LOCK, { force: true });
}

module.exports = { acquireRunLock, releaseRunLock };
