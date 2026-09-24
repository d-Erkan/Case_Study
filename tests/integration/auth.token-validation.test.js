'use strict';

/**
 * verifyToken middleware: how protected endpoints treat missing / malformed /
 * tampered / expired / foreign-signed access tokens.
 */

const { api } = require('../../lib/api-client');
const { tokenFor, forgeToken, registerAndSignIn } = require('../../lib/auth');
const { collections } = require('../../lib/db');
const { USERS } = require('../../lib/fixtures');
const { bugTest, expectKnownBug } = require('../../lib/known-bugs');

// A representative protected endpoint per middleware chain.
const PROTECTED = [
  ['GET /api/test/user', (t) => api.boards.user(t)],
  ['GET /api/tutorials', (t) => api.tutorials.list(t)],
  ['POST /api/tutorials', (t) => api.tutorials.create(t, { title: 'should never be created' })],
  ['DELETE /api/tutorials', (t) => api.tutorials.removeAll(t)],
];

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

describe('Access token validation (verifyToken)', () => {
  describe('missing token', () => {
    test.each(PROTECTED)('%s is refused with a JSON error', async (_, call) => {
      const res = await call(undefined);
      expect([401, 403]).toContain(res.status);
      expect(res.body).toEqual({ message: 'No token provided!' });
    });

    test('an empty x-access-token header is treated as a missing token', async () => {
      const res = await api.boards.user('');
      expect(res.body).toEqual({ message: 'No token provided!' });
    });

    bugTest('BUG-005', 'missing token -> 401 Unauthorized (documented contract)', async () => {
      const res = await api.tutorials.list(undefined);
      await expectKnownBug('BUG-005', () => expect(res.status).toBe(401));
    });
  });

  describe('invalid tokens are rejected with 401', () => {
    const cases = {
      'garbage string': async () => 'not-a-jwt',
      'tampered payload (id swapped to admin, signature kept)': async () => {
        const [h, , s] = (await tokenFor('user')).split('.');
        const exp = Math.floor(Date.now() / 1000) + 60;
        return `${h}.${b64url({ id: USERS.admin._id, iat: exp - 60, exp })}.${s}`;
      },
      'signed with a different secret': async () => forgeToken({ id: USERS.admin._id }, { secret: 'attacker-secret', expiresIn: 60 }),
      'unsigned (alg: none)': async () => `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ id: USERS.admin._id })}.`,
    };

    test.each(Object.keys(cases))('%s', async (name) => {
      const token = await cases[name]();
      const res = await api.boards.admin(token);
      expect(res.status).toBe(401);
      expect(res.text).not.toMatch(/Admin Content/);
    });

    test('expired token -> 401 with a specific "expired" message', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expired = forgeToken({ id: USERS.admin._id, iat: now - 120, exp: now - 60 });

      const res = await api.boards.admin(expired);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'Unauthorized! Access Token was expired!' });
    });

    bugTest('BUG-005', 'invalid token -> 401 with a JSON { message } body like every other auth error', async () => {
      const res = await api.boards.user('not-a-jwt');
      expect(res.status).toBe(401);
      await expectKnownBug('BUG-005', () => {
        expect(res.contentType).toMatch(/application\/json/);
        expect(res.body).toEqual({ message: 'Unauthorized!' });
      });
    });
  });

  bugTest('BUG-003', 'access token of a deleted account is rejected (no data served to removed users)', async () => {
    const { users } = await collections();
    const account = await registerAndSignIn({ prefix: 'deleted' });
    await users.deleteOne({ username: account.username });

    // verifyToken-only route: safe to call (RBAC routes crash — see resilience.crash.test.js).
    const res = await api.tutorials.list(account.accessToken);

    await expectKnownBug('BUG-003', () => expect(res.status).toBe(401));
  });

  test('a token forged with the SUT\'s hard-coded secret is accepted (documents SEC-02: secret in source)', async () => {
    // Anyone who can read the public repository can mint tokens for any user id.
    const forged = forgeToken({ id: USERS.admin._id }, { expiresIn: 60 });
    const res = await api.boards.admin(forged);
    expect(res.status).toBe(200);
  });

  test('the token header name is "x-access-token"; "Authorization: Bearer" is not honoured', async () => {
    const token = await tokenFor('user');
    const res = await api.request('GET', '/api/test/user', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
  });
});
