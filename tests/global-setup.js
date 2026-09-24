'use strict';

const fs = require('node:fs');
const { establishBaseline } = require('../lib/seed');
const { closeDb } = require('../lib/db');
const { LEDGER } = require('../lib/known-bugs');
const config = require('../lib/config');
const { acquireRunLock } = require('./run-lock');

module.exports = async () => {
  acquireRunLock();
  fs.rmSync(LEDGER, { force: true });
  const log = (m) => process.stdout.write(`  [setup] ${m}\n`);
  process.stdout.write('\n');
  try {
    const { summary } = await establishBaseline({ withTokens: true, log });
    log(`Baseline ready: ${JSON.stringify(summary)} | known-bugs mode: ${config.knownBugsMode}`);
  } catch (err) {
    process.stderr.write(
      `\n  [setup] FAILED: ${err.message}\n  Is the environment running? Try: npm run env:up\n\n`,
    );
    throw err;
  } finally {
    await closeDb();
  }
};
