'use strict';

const { api } = require('../../lib/api-client');
const { collections, oid } = require('../../lib/db');
const { decodeJwt } = require('../../lib/auth');
const { USERS, PASSWORD } = require('../../lib/fixtures');
const config = require('../../lib/config');
const { bugTest, expectKnownBug } = require('../../lib/known-bugs');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('POST /api/auth/signin', () => {
  let refreshTokens;
  beforeAll(async () => {
    ({ refreshTokens } = await collections());
  });

  describe('valid credentials', () => {
    test('returns the documented payload: identity, ROLE_* authorities and both tokens', async () => {
      const u = USERS.moderator;

      const res = await api.auth.signin({ username: u.username, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: u._id,
        username: u.username,
        email: u.email,
        roles: ['ROLE_MODERATOR'],
        accessToken: expect.any(String),
        refreshToken: expect.stringMatching(UUID_V4),
      });
      expect(res.body).not.toHaveProperty('password');
    });

    test('maps every role of a multi-role account to an authority', async () => {
      const res = await api.auth.signin({ username: USERS.superuser.username, password: PASSWORD });
      expect(res.status).toBe(200);
      expect([...res.body.roles].sort()).toEqual(['ROLE_ADMIN', 'ROLE_MODERATOR', 'ROLE_USER']);
    });

    test('access token is a JWT bound to the user id with a 60 s lifetime', async () => {
      const before = Math.floor(Date.now() / 1000);
      const res = await api.auth.signin({ username: USERS.user.username, password: PASSWORD });

      const claims = decodeJwt(res.body.accessToken);
      expect(claims.id).toBe(USERS.user._id);
      expect(claims.exp - claims.iat).toBe(config.sut.accessTokenTtlSec);
      expect(claims.iat).toBeGreaterThanOrEqual(before - 2);
    });

    test('persists the refresh token, linked to the user, expiring after 120 s', async () => {
      const u = USERS.admin;
      const before = Date.now();

      const res = await api.auth.signin({ username: u.username, password: PASSWORD });

      const doc = await refreshTokens.findOne({ token: res.body.refreshToken });
      expect(doc).not.toBeNull();
      expect(doc.user.equals(oid(u._id))).toBe(true);
      const ttlMs = doc.expiryDate.getTime() - before;
      expect(ttlMs).toBeGreaterThan((config.sut.refreshTokenTtlSec - 5) * 1000);
      expect(ttlMs).toBeLessThan((config.sut.refreshTokenTtlSec + 5) * 1000);
    });

    test('every sign-in issues a new, distinct refresh token', async () => {
      const u = USERS.user;
      const countBefore = await refreshTokens.countDocuments({ user: oid(u._id) });

      const a = await api.auth.signin({ username: u.username, password: PASSWORD });
      const b = await api.auth.signin({ username: u.username, password: PASSWORD });

      expect(a.body.refreshToken).not.toBe(b.body.refreshToken);
      expect(await refreshTokens.countDocuments({ user: oid(u._id) })).toBe(countBefore + 2);
    });
  });

  describe('invalid credentials', () => {
    test('wrong password -> 401, null access token, no refresh token persisted', async () => {
      const u = USERS.admin;
      const countBefore = await refreshTokens.countDocuments({ user: oid(u._id) });

      const res = await api.auth.signin({ username: u.username, password: 'wrong-password' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ accessToken: null, message: 'Invalid Password!' });
      expect(await refreshTokens.countDocuments({ user: oid(u._id) })).toBe(countBefore);
    });

    test('unknown username -> 404', async () => {
      const res = await api.auth.signin({ username: 'no_such_user_x', password: PASSWORD });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'User Not found.' });
    });

    test('username lookup is exact (case-sensitive)', async () => {
      const res = await api.auth.signin({ username: USERS.admin.username.toUpperCase(), password: PASSWORD });
      expect(res.status).toBe(404);
    });

    describe('non-string username (NoSQL operator injection)', () => {
      bugTest('BUG-009', '{ $ne: null } as username is rejected instead of matching an arbitrary account', async () => {
        const res = await api.auth.signin({ username: { $ne: null }, password: PASSWORD });

        await expectKnownBug('BUG-009', () => {
          expect(res.status).toBe(400);
          expect(res.body?.accessToken).toBeFalsy();
        });
      });

      bugTest('BUG-009', '$regex usernames give no existence oracle (username enumeration)', async () => {
        const existingPrefix = await api.auth.signin({ username: { $regex: '^qa_adm' }, password: 'wrong' });
        const missingPrefix = await api.auth.signin({ username: { $regex: '^zz_nobody' }, password: 'wrong' });

        await expectKnownBug('BUG-009', () => {
          // A safe implementation rejects the operator outright, so both answers are identical.
          expect(existingPrefix.status).toBe(missingPrefix.status);
          expect(existingPrefix.status).toBe(400);
        });
      });
    });

    // Missing password crashes the process (BUG-002) — covered in resilience.crash.test.js.
  });
});
