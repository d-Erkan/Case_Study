'use strict';

const { api } = require('../../lib/api-client');
const { collections, oid } = require('../../lib/db');
const { tokenFor } = require('../../lib/auth');
const { resetTutorials } = require('../../lib/seed');
const { TUTORIALS, NON_EXISTENT_ID } = require('../../lib/fixtures');
const { bugTest, expectKnownBug } = require('../../lib/known-bugs');

describe('Tutorial delete endpoints', () => {
  let tutorials;
  beforeAll(async () => {
    ({ tutorials } = await collections());
  });
  beforeEach(resetTutorials);

  describe('DELETE /api/tutorials/:id', () => {
    test('admin deletes exactly one tutorial; the rest are untouched', async () => {
      const target = TUTORIALS[2];
      const othersBefore = await tutorials.find({ _id: { $ne: oid(target._id) } }).sort({ _id: 1 }).toArray();

      const res = await api.tutorials.remove(await tokenFor('admin'), target._id);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Tutorial was deleted successfully!' });
      expect(await tutorials.findOne({ _id: oid(target._id) })).toBeNull();
      expect(await tutorials.find({}).sort({ _id: 1 }).toArray()).toEqual(othersBefore);
    });

    test('deleted tutorial is gone from every read endpoint', async () => {
      const target = TUTORIALS.find((t) => t.published);
      const admin = await tokenFor('admin');
      await api.tutorials.remove(admin, target._id);

      const reader = await tokenFor('user');
      expect((await api.tutorials.get(reader, target._id)).status).toBe(404);
      expect((await api.tutorials.list(reader)).body.map((t) => t.id)).not.toContain(target._id);
      expect((await api.tutorials.published(reader)).body.map((t) => t.id)).not.toContain(target._id);
    });

    test('deleting twice -> second call 404 (idempotent outcome, no side effects)', async () => {
      const admin = await tokenFor('admin');
      await api.tutorials.remove(admin, TUTORIALS[0]._id);

      const res = await api.tutorials.remove(admin, TUTORIALS[0]._id);

      expect(res.status).toBe(404);
      expect(await tutorials.countDocuments()).toBe(TUTORIALS.length - 1);
    });

    test('valid but unknown id -> 404, nothing deleted', async () => {
      const res = await api.tutorials.remove(await tokenFor('admin'), NON_EXISTENT_ID);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe(`Cannot delete Tutorial with id=${NON_EXISTENT_ID}. Maybe Tutorial was not found!`);
      expect(await tutorials.countDocuments()).toBe(TUTORIALS.length);
    });

    bugTest('BUG-006', 'malformed id -> 4xx client error, not 500', async () => {
      const res = await api.tutorials.remove(await tokenFor('admin'), 'not-an-object-id');
      expect(await tutorials.countDocuments()).toBe(TUTORIALS.length);
      await expectKnownBug('BUG-006', () => expect([400, 404]).toContain(res.status));
    });
  });

  describe('DELETE /api/tutorials', () => {
    test('admin deletes all tutorials; response reports the exact count', async () => {
      const res = await api.tutorials.removeAll(await tokenFor('admin'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: `${TUTORIALS.length} Tutorials were deleted successfully!` });
      expect(await tutorials.countDocuments()).toBe(0);
    });

    test('on an empty collection it succeeds and reports 0', async () => {
      const admin = await tokenFor('admin');
      await api.tutorials.removeAll(admin);

      const res = await api.tutorials.removeAll(admin);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: '0 Tutorials were deleted successfully!' });
    });

    test('only tutorials are affected (users, roles and refresh tokens untouched)', async () => {
      const { users, roles, refreshTokens } = await collections();
      const counts = async () => [await users.countDocuments(), await roles.countDocuments(), await refreshTokens.countDocuments()];
      const admin = await tokenFor('admin'); // may create a refresh token, so sign in first
      const before = await counts();

      await api.tutorials.removeAll(admin);

      expect(await counts()).toEqual(before);
    });
  });
});
