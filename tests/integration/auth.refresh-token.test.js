'use strict';

const { api } = require('../../lib/api-client');
const { collections, oid } = require('../../lib/db');
const { signIn, decodeJwt, registerAndSignIn } = require('../../lib/auth');
const { waitFor } = require('../../lib/wait');
const { USERS } = require('../../lib/fixtures');
const config = require('../../lib/config');
const { bugTest, expectKnownBug } = require('../../lib/known-bugs');

describe('POST /api/auth/refreshtoken', () => {
  let refreshTokens;
  let users;
  beforeAll(async () => {
    ({ refreshTokens, users } = await collections());
  });

  describe('valid refresh token', () => {
    test('issues a new access token for the same user that is accepted by protected endpoints', async () => {
      const session = await signIn(USERS.moderator.username);

      const res = await api.auth.refreshToken({ refreshToken: session.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ accessToken: expect.any(String), refreshToken: session.refreshToken });
      const claims = decodeJwt(res.body.accessToken);
      expect(claims.id).toBe(USERS.moderator._id);
      expect(claims.exp - claims.iat).toBe(config.sut.accessTokenTtlSec);

      // The refreshed token carries the user's real privileges (RBAC is looked up server-side).
      expect((await api.boards.mod(res.body.accessToken)).status).toBe(200);
      expect((await api.tutorials.list(res.body.accessToken)).status).toBe(200);
    });

    test('can be used repeatedly until expiry; the stored token is neither rotated nor extended', async () => {
      const session = await signIn(USERS.user.username);
      const before = await refreshTokens.findOne({ token: session.refreshToken });

      const first = await api.auth.refreshToken({ refreshToken: session.refreshToken });
      const second = await api.auth.refreshToken({ refreshToken: session.refreshToken });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const after = await refreshTokens.findOne({ token: session.refreshToken });
      expect(after.expiryDate.getTime()).toBe(before.expiryDate.getTime());
      expect(await refreshTokens.countDocuments({ user: oid(USERS.user._id), token: session.refreshToken })).toBe(1);
    });
  });

  describe('invalid refresh token', () => {
    test('missing token -> 403 "Refresh Token is required!"', async () => {
      const res = await api.auth.refreshToken({});
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'Refresh Token is required!' });
    });

    test('null token -> 403', async () => {
      const res = await api.auth.refreshToken({ refreshToken: null });
      expect(res.status).toBe(403);
    });

    test('unknown token is rejected and no access token is issued', async () => {
      const res = await api.auth.refreshToken({ refreshToken: '00000000-0000-4000-8000-000000000000' });
      expect([403, 404]).toContain(res.status);
      expect(res.body.accessToken).toBeUndefined();
    });

    bugTest('BUG-008', 'unknown token -> 404 "not found" (documented contract)', async () => {
      const res = await api.auth.refreshToken({ refreshToken: '00000000-0000-4000-8000-000000000000' });
      await expectKnownBug('BUG-008', () => expect(res.status).toBe(404));
    });

    test('an access token cannot be used as a refresh token', async () => {
      const session = await signIn(USERS.user.username);
      const res = await api.auth.refreshToken({ refreshToken: session.accessToken });
      expect(res.status).toBe(403);
      expect(res.body.accessToken).toBeUndefined();
    });

    test('expired token -> 403 and the token is deleted from the database', async () => {
      const session = await signIn(USERS.user.username);
      // Time travel: expire the token in the DB instead of waiting 120 s.
      await refreshTokens.updateOne({ token: session.refreshToken }, { $set: { expiryDate: new Date(Date.now() - 1000) } });

      const res = await api.auth.refreshToken({ refreshToken: session.refreshToken });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: 'Refresh token was expired. Please make a new signin request' });
      // Deletion is fire-and-forget on the server side, so poll briefly.
      await waitFor(async () => (await refreshTokens.countDocuments({ token: session.refreshToken })) === 0, {
        timeoutMs: 3000,
        description: 'expired refresh token removal',
      });

      const retry = await api.auth.refreshToken({ refreshToken: session.refreshToken });
      expect(retry.status).toBe(403);
      expect(retry.body.message).toBe('Refresh token is not in database!');
    });
  });

  describe('account lifecycle', () => {
    bugTest('BUG-003', 'refresh token of a deleted account no longer yields access tokens', async () => {
      const account = await registerAndSignIn({ prefix: 'deleted' });
      await users.deleteOne({ username: account.username });

      const res = await api.auth.refreshToken({ refreshToken: account.refreshToken });

      await expectKnownBug('BUG-003', () => {
        expect(res.status).toBe(403);
        expect(res.body.accessToken).toBeUndefined();
      });
    });
  });
});
