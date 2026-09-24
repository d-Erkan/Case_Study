'use strict';

/**
 * DESTRUCTIVE: these requests currently crash the API process (uncaught exceptions
 * thrown inside Mongoose callbacks). The container comes back only because the SUT's
 * docker-compose.yml sets `restart: unless-stopped`; every test therefore waits for
 * full readiness afterwards. Runs last (tests/sequencer.js); skip with SKIP_DESTRUCTIVE=1.
 */

const { api } = require('../../lib/api-client');
const { collections } = require('../../lib/db');
const { tokenFor, registerAndSignIn } = require('../../lib/auth');
const { waitForApiReady } = require('../../lib/wait');
const { USERS } = require('../../lib/fixtures');
const config = require('../../lib/config');
const { bugTest, expectKnownBug } = require('../../lib/known-bugs');

/** Perform a request and classify the outcome: an HTTP response, or a dropped connection. */
async function attempt(requestFn) {
  try {
    return { res: await requestFn() };
  } catch (err) {
    return { connectionError: err.cause?.code || err.cause?.message || err.message };
  }
}

const describeDestructive = config.skipDestructive ? describe.skip : describe;

describeDestructive('Resilience: malformed input must not take the API down', () => {
  afterEach(async () => {
    await waitForApiReady({ timeoutMs: 60_000 });
  });

  bugTest('BUG-002', 'POST /api/auth/signin without "password" -> 4xx, process keeps running', async () => {
    const outcome = await attempt(() => api.auth.signin({ username: USERS.user.username }));

    await expectKnownBug('BUG-002', () => {
      expect(outcome.connectionError).toBeUndefined();
      expect([400, 401]).toContain(outcome.res.status);
    });
  });

  bugTest('BUG-003', 'deleted moderator\'s still-valid token on POST /api/tutorials -> 401/403, process keeps running', async () => {
    const { users, tutorials } = await collections();
    const account = await registerAndSignIn({ roles: ['moderator'], prefix: 'fired_mod' });
    await users.deleteOne({ username: account.username });
    const countBefore = await tutorials.countDocuments();

    const outcome = await attempt(() => api.tutorials.create(account.accessToken, { title: 'written by a deleted account' }));

    await waitForApiReady({ timeoutMs: 60_000 });
    expect(await tutorials.countDocuments()).toBe(countBefore);
    await expectKnownBug('BUG-003', () => {
      expect(outcome.connectionError).toBeUndefined();
      expect([401, 403]).toContain(outcome.res.status);
    });
  });

  test('after recovery the API is fully functional and the baseline is intact', async () => {
    const { roles } = await collections();
    expect((await roles.distinct('name')).sort()).toEqual(['admin', 'moderator', 'user']);
    expect((await api.boards.admin(await tokenFor('admin'))).status).toBe(200);
  });
});
