#!/usr/bin/env node
'use strict';

/**
 * Test Setup Script — puts the running SUT into a known baseline state.
 *
 *   node scripts/test-setup.js            full baseline + token generation
 *   node scripts/test-setup.js --no-tokens   baseline only
 *
 * Safe to run any number of times: every run converges on identical data
 * (fixed ObjectIds / timestamps). Exits non-zero if the baseline cannot be verified.
 */

const { establishBaseline } = require('../lib/seed');
const { closeDb } = require('../lib/db');
const { USERS, TUTORIALS, PASSWORD } = require('../lib/fixtures');

async function main() {
  const withTokens = !process.argv.includes('--no-tokens');
  const started = Date.now();
  const log = (m) => console.log(`[test-setup] ${m}`);

  const { summary, session } = await establishBaseline({ withTokens, log });

  log(`Done in ${Date.now() - started} ms. Collection counts: ${JSON.stringify(summary)}`);
  console.log('\nSeeded accounts (password for all: %s)', PASSWORD);
  console.table(
    Object.entries(USERS).map(([persona, u]) => ({ persona, username: u.username, roles: u.roles.join(','), id: u._id })),
  );
  console.log('Seeded tutorials');
  console.table(TUTORIALS.map((t) => ({ id: t._id, title: t.title, published: t.published })));
  if (session) {
    console.log('Access tokens (valid 60 s) are in .state/session.json, e.g.:');
    console.log(`  curl -H "x-access-token: ${session.personas.admin.accessToken.slice(0, 24)}..." http://localhost:8080/api/tutorials`);
  }
}

main()
  .catch((err) => {
    console.error(`[test-setup] FAILED: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
