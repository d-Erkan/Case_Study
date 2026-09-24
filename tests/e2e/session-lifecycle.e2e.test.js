'use strict';

/**
 * E2E-2  Session lifecycle of a newly registered user
 *
 *   register -> sign in -> use protected API -> refresh access token -> keep working
 *   -> refresh token expires -> refresh rejected (and purged) -> sign in again.
 *
 * Refresh-token expiry is simulated by moving `expiryDate` into the past in MongoDB
 * (instead of waiting 120 s). A real-time variant of access-token expiry runs with RUN_SLOW=1.
 */

const { api } = require('../../lib/api-client');
const { collections, oid } = require('../../lib/db');
const { uniqueCredentials, decodeJwt } = require('../../lib/auth');
const { sleep, waitFor } = require('../../lib/wait');
const { createStepper } = require('../../lib/step');
const config = require('../../lib/config');

describe('E2E: session lifecycle', () => {
  test('register -> sign in -> refresh -> refresh-token expiry -> re-authenticate', async () => {
    const step = createStepper();
    const { users, refreshTokens } = await collections();
    const creds = uniqueCredentials('e2e_session');

    const userId = await step('register', async () => {
      const res = await api.auth.signup(creds);
      expect(res.status).toBeLessThan(300);
      const doc = await users.findOne({ username: creds.username });
      expect(doc).not.toBeNull();
      return doc._id.toHexString();
    });

    const session = await step('sign in: tokens issued and refresh token persisted', async () => {
      const res = await api.auth.signin({ username: creds.username, password: creds.password });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(userId);
      expect(decodeJwt(res.body.accessToken).id).toBe(userId);
      expect(await refreshTokens.countDocuments({ user: oid(userId) })).toBe(1);
      return res.body;
    });

    await step('use the protected API with the access token', async () => {
      expect((await api.boards.user(session.accessToken)).status).toBe(200);
      expect((await api.tutorials.list(session.accessToken)).status).toBe(200);
      expect((await api.boards.mod(session.accessToken)).status).toBe(403);
    });

    const refreshed = await step('refresh the access token', async () => {
      const res = await api.auth.refreshToken({ refreshToken: session.refreshToken });
      expect(res.status).toBe(200);
      expect(decodeJwt(res.body.accessToken).id).toBe(userId);
      return res.body;
    });

    await step('keep working with the refreshed token', async () => {
      expect((await api.tutorials.published(refreshed.accessToken)).status).toBe(200);
    });

    await step('refresh token expires (simulated) -> refresh rejected and purged from DB', async () => {
      await refreshTokens.updateOne({ token: session.refreshToken }, { $set: { expiryDate: new Date(Date.now() - 1) } });
      const res = await api.auth.refreshToken({ refreshToken: session.refreshToken });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/expired/i);
      await waitFor(async () => (await refreshTokens.countDocuments({ token: session.refreshToken })) === 0, {
        timeoutMs: 3000,
        description: 'purge of the expired refresh token',
      });
    });

    await step('sign in again -> fresh, different refresh token that works', async () => {
      const res = await api.auth.signin({ username: creds.username, password: creds.password });
      expect(res.status).toBe(200);
      expect(res.body.refreshToken).not.toBe(session.refreshToken);
      expect((await api.auth.refreshToken({ refreshToken: res.body.refreshToken })).status).toBe(200);
    });
  });

  (config.runSlow ? test : test.skip)(
    'REAL TIME: access token expires after 60 s and is renewed via refresh token (RUN_SLOW=1)',
    async () => {
      const step = createStepper();
      const creds = uniqueCredentials('e2e_slow');
      await api.auth.signup(creds);
      const session = (await api.auth.signin({ username: creds.username, password: creds.password })).body;

      await step('token works initially', async () => expect((await api.boards.user(session.accessToken)).status).toBe(200));

      await step('after 60 s the token is rejected as expired', async () => {
        await sleep((config.sut.accessTokenTtlSec + 2) * 1000);
        const res = await api.boards.user(session.accessToken);
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ message: 'Unauthorized! Access Token was expired!' });
      });

      await step('refresh token (still valid, 120 s TTL) yields a working access token', async () => {
        const res = await api.auth.refreshToken({ refreshToken: session.refreshToken });
        expect(res.status).toBe(200);
        expect((await api.boards.user(res.body.accessToken)).status).toBe(200);
      });
    },
    120_000,
  );
});
