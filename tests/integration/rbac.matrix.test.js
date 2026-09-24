'use strict';

/**
 * Role-based access control matrix, generated from the permission tables in the
 * SUT's README. Every (endpoint x persona) cell is a test:
 *   allowed -> 2xx
 *   denied  -> 403 with the middleware's message, and for write endpoints the
 *              tutorials collection is verified to be byte-for-byte unchanged.
 * Anonymous callers must never succeed on protected endpoints (status-code
 * contract for that case is covered in auth.token-validation.test.js).
 */

const { api } = require('../../lib/api-client');
const { collections } = require('../../lib/db');
const { tokenFor } = require('../../lib/auth');
const { resetTutorials } = require('../../lib/seed');
const { TUTORIALS } = require('../../lib/fixtures');
const { bugTest, expectKnownBug } = require('../../lib/known-bugs');

const TARGET = TUTORIALS[0]._id;
const ALL = ['anonymous', 'user', 'moderator', 'admin', 'superuser'];
const AUTHENTICATED = ['user', 'moderator', 'admin', 'superuser'];
const MOD_OR_ADMIN = ['moderator', 'admin', 'superuser'];
const ADMIN = ['admin', 'superuser'];

const ENDPOINTS = [
  { name: 'GET /api/test/all', call: (t) => api.boards.all(t), allowed: ALL },
  { name: 'GET /api/test/user', call: (t) => api.boards.user(t), allowed: AUTHENTICATED },
  {
    name: 'GET /api/test/mod',
    call: (t) => api.boards.mod(t),
    allowed: MOD_OR_ADMIN, // README: "Required Role: moderator or admin"
    denyMessage: 'Require Moderator Role!',
    knownBugs: { admin: 'BUG-004' },
  },
  { name: 'GET /api/test/admin', call: (t) => api.boards.admin(t), allowed: ADMIN, denyMessage: 'Require Admin Role!' },
  { name: 'GET /api/tutorials', call: (t) => api.tutorials.list(t), allowed: AUTHENTICATED },
  { name: 'GET /api/tutorials/published', call: (t) => api.tutorials.published(t), allowed: AUTHENTICATED },
  { name: 'GET /api/tutorials/:id', call: (t) => api.tutorials.get(t, TARGET), allowed: AUTHENTICATED },
  {
    name: 'POST /api/tutorials',
    call: (t) => api.tutorials.create(t, { title: 'RBAC probe', description: 'x', published: true }),
    allowed: MOD_OR_ADMIN,
    denyMessage: 'Require Moderator or Admin Role!',
    write: true,
  },
  {
    name: 'PUT /api/tutorials/:id',
    call: (t) => api.tutorials.update(t, TARGET, { title: 'RBAC probe' }),
    allowed: MOD_OR_ADMIN,
    denyMessage: 'Require Moderator or Admin Role!',
    write: true,
  },
  {
    name: 'DELETE /api/tutorials/:id',
    call: (t) => api.tutorials.remove(t, TARGET),
    allowed: ADMIN,
    denyMessage: 'Require Admin Role!',
    write: true,
  },
  {
    name: 'DELETE /api/tutorials',
    call: (t) => api.tutorials.removeAll(t),
    allowed: ADMIN,
    denyMessage: 'Require Admin Role!',
    write: true,
  },
];

const token = (persona) => (persona === 'anonymous' ? Promise.resolve(undefined) : tokenFor(persona));

describe('RBAC matrix', () => {
  let tutorials;
  const snapshot = () => tutorials.find({}).sort({ _id: 1 }).toArray();

  beforeAll(async () => {
    ({ tutorials } = await collections());
  });
  beforeEach(resetTutorials);

  describe.each(ENDPOINTS)('$name', (ep) => {
    for (const persona of ALL) {
      const allowed = ep.allowed.includes(persona);
      const bugId = ep.knownBugs?.[persona];
      const title = `${persona} is ${allowed ? 'ALLOWED' : 'DENIED'}`;

      if (bugId) {
        bugTest(bugId, title, async () => {
          const res = await ep.call(await token(persona));
          await expectKnownBug(bugId, () => expect(res.status).toBe(200));
        });
        continue;
      }

      test(title, async () => {
        const before = ep.write ? await snapshot() : undefined;
        const res = await ep.call(await token(persona));

        if (allowed) {
          expect(res.status).toBeGreaterThanOrEqual(200);
          expect(res.status).toBeLessThan(300);
          return;
        }

        if (persona === 'anonymous') {
          expect([401, 403]).toContain(res.status);
        } else {
          expect(res.status).toBe(403);
          expect(res.body).toEqual({ message: ep.denyMessage });
        }
        if (ep.write) expect(await snapshot()).toEqual(before);
      });
    }
  });
});
