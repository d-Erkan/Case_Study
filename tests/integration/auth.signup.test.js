'use strict';

const bcrypt = require('bcryptjs');
const { api } = require('../../lib/api-client');
const { collections, roleNamesOf } = require('../../lib/db');
const { uniqueCredentials } = require('../../lib/auth');
const { USERS } = require('../../lib/fixtures');
const { bugTest, expectKnownBug } = require('../../lib/known-bugs');

describe('POST /api/auth/signup', () => {
  let users;
  beforeAll(async () => {
    ({ users } = await collections());
  });

  describe('successful registration', () => {
    test('without roles: persists the user with the default "user" role and a bcrypt-hashed password', async () => {
      const creds = uniqueCredentials('signup');

      const res = await api.auth.signup(creds);

      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
      expect(res.body).toEqual({ message: 'User was registered successfully!' });

      const doc = await users.findOne({ username: creds.username });
      expect(doc).not.toBeNull();
      expect(doc.email).toBe(creds.email);
      expect(await roleNamesOf(doc)).toEqual(['user']);
      // Never stored in clear text; must verify with bcrypt.
      expect(doc.password).not.toBe(creds.password);
      expect(doc.password).toMatch(/^\$2[aby]\$\d{2}\$/);
      expect(bcrypt.compareSync(creds.password, doc.password)).toBe(true);
    });

    test.each([
      [['moderator']],
      [['admin']],
      [['user', 'moderator', 'admin']],
    ])('with roles %j: persists exactly those roles', async (roles) => {
      const creds = uniqueCredentials('signup');

      const res = await api.auth.signup({ ...creds, roles });

      expect(res.status).toBeLessThan(300);
      const doc = await users.findOne({ username: creds.username });
      expect(await roleNamesOf(doc)).toEqual([...roles].sort());
    });

    test('the new account can immediately sign in', async () => {
      const creds = uniqueCredentials('signup');
      await api.auth.signup(creds);

      const res = await api.auth.signin({ username: creds.username, password: creds.password });

      expect(res.status).toBe(200);
      expect(res.body.roles).toEqual(['ROLE_USER']);
    });

    bugTest('BUG-008', 'responds 201 Created with the created user object (documented contract)', async () => {
      const creds = uniqueCredentials('signup');

      const res = await api.auth.signup({ ...creds, roles: ['moderator'] });

      await expectKnownBug('BUG-008', () => {
        expect(res.status).toBe(201);
        expect(res.body).toEqual(
          expect.objectContaining({ id: expect.any(String), username: creds.username, email: creds.email }),
        );
      });
    });
  });

  describe('validation', () => {
    test('duplicate username -> 400 and no second account is created', async () => {
      const existing = USERS.user;
      const res = await api.auth.signup({ username: existing.username, email: 'other@example.test', password: 'x1234567' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Failed! Username is already in use!');
      expect(await users.countDocuments({ username: existing.username })).toBe(1);
      expect(await users.countDocuments({ email: 'other@example.test' })).toBe(0);
    });

    test('duplicate email -> 400 and no account is created', async () => {
      const creds = uniqueCredentials('dupmail');
      const res = await api.auth.signup({ ...creds, email: USERS.admin.email });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Failed! Email is already in use!');
      expect(await users.countDocuments({ email: USERS.admin.email })).toBe(1);
      expect(await users.findOne({ username: creds.username })).toBeNull();
    });

    test('duplicate username check is case-sensitive (documents current behaviour)', async () => {
      // Not a documented requirement; recorded so a change in behaviour is noticed.
      const creds = uniqueCredentials('case');
      const res = await api.auth.signup({ ...creds, username: USERS.user.username.toUpperCase() });
      expect(res.status).toBeLessThan(300);
      await users.deleteOne({ username: USERS.user.username.toUpperCase() });
    });

    test.each([['superadmin'], ['ADMIN'], ['']])('unknown role %j -> 400 and no account is created', async (role) => {
      const creds = uniqueCredentials('badrole');

      const res = await api.auth.signup({ ...creds, roles: ['user', role] });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(`Failed! Role ${role} does not exist!`);
      expect(await users.findOne({ username: creds.username })).toBeNull();
    });

    test('missing password: no account is persisted', async () => {
      const creds = uniqueCredentials('nopw');
      await api.auth.signup({ username: creds.username, email: creds.email });
      expect(await users.findOne({ username: creds.username })).toBeNull();
    });

    bugTest('BUG-007', 'missing password -> 400 with a JSON error, without leaking internals', async () => {
      const creds = uniqueCredentials('nopw');

      const res = await api.auth.signup({ username: creds.username, email: creds.email });

      await expectKnownBug('BUG-007', () => {
        expect(res.status).toBe(400);
        expect(res.contentType).toMatch(/application\/json/);
        expect(res.text).not.toMatch(/at .*\.js:\d+/); // no stack trace
      });
    });
  });
});
