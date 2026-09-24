'use strict';

/**
 * PUT /api/tutorials/:id — every write is verified against the database, not just
 * the HTTP response. This is where the intentional defect (BUG-001) lives: the
 * endpoint answers 200 "updated successfully" but persists nothing.
 */

const { api } = require('../../lib/api-client');
const { collections, oid } = require('../../lib/db');
const { tokenFor } = require('../../lib/auth');
const { resetTutorials } = require('../../lib/seed');
const { TUTORIALS, NON_EXISTENT_ID } = require('../../lib/fixtures');
const { bugTest, expectKnownBug } = require('../../lib/known-bugs');

const DRAFT = TUTORIALS.find((t) => !t.published);

describe('PUT /api/tutorials/:id', () => {
  let tutorials;
  const load = (id) => tutorials.findOne({ _id: oid(id) });
  const othersSnapshot = (id) => tutorials.find({ _id: { $ne: oid(id) } }).sort({ _id: 1 }).toArray();

  beforeAll(async () => {
    ({ tutorials } = await collections());
  });
  beforeEach(resetTutorials);

  describe('successful update', () => {
    test.each(['moderator', 'admin'])('%s receives 200 "Tutorial was updated successfully."', async (persona) => {
      const res = await api.tutorials.update(await tokenFor(persona), DRAFT._id, { title: 'Renamed' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Tutorial was updated successfully.' });
    });

    bugTest('BUG-001', 'moderator: title, description and published are persisted', async () => {
      const changes = { title: 'JWT Deep Dive (2nd edition)', description: 'Rewritten', published: true };

      const res = await api.tutorials.update(await tokenFor('moderator'), DRAFT._id, changes);
      expect(res.status).toBe(200);

      const doc = await load(DRAFT._id);
      await expectKnownBug('BUG-001', () => expect(doc).toMatchObject(changes));
    });

    bugTest('BUG-001', 'admin: partial update changes only the supplied field', async () => {
      const res = await api.tutorials.update(await tokenFor('admin'), DRAFT._id, { published: true });
      expect(res.status).toBe(200);

      const doc = await load(DRAFT._id);
      expect(doc.title).toBe(DRAFT.title);
      expect(doc.description).toBe(DRAFT.description);
      await expectKnownBug('BUG-001', () => expect(doc.published).toBe(true));
    });

    bugTest('BUG-001', 'updatedAt advances while createdAt is preserved', async () => {
      await api.tutorials.update(await tokenFor('moderator'), DRAFT._id, { description: 'touch' });

      const doc = await load(DRAFT._id);
      expect(doc.createdAt.getTime()).toBe(DRAFT.createdAt.getTime());
      await expectKnownBug('BUG-001', () => expect(doc.updatedAt.getTime()).toBeGreaterThan(DRAFT.updatedAt.getTime()));
    });

    bugTest('BUG-001', 'the change is visible through the API (GET /:id and /published)', async () => {
      const token = await tokenFor('moderator');
      await api.tutorials.update(token, DRAFT._id, { title: 'Now public', published: true });

      const one = await api.tutorials.get(token, DRAFT._id);
      const published = await api.tutorials.published(token);

      await expectKnownBug('BUG-001', () => {
        expect(one.body).toMatchObject({ title: 'Now public', published: true });
        expect(published.body.map((t) => t.id)).toContain(DRAFT._id);
      });
    });

    test('no other tutorial is modified', async () => {
      const before = await othersSnapshot(DRAFT._id);
      await api.tutorials.update(await tokenFor('admin'), DRAFT._id, { title: 'Only me' });
      expect(await othersSnapshot(DRAFT._id)).toEqual(before);
    });

    bugTest('BUG-008', 'responds with the updated tutorial object (documented contract)', async () => {
      const res = await api.tutorials.update(await tokenFor('moderator'), DRAFT._id, { title: 'Echo me' });
      await expectKnownBug('BUG-008', () => expect(res.body).toMatchObject({ id: DRAFT._id, title: 'Echo me' }));
    });
  });

  describe('invalid requests', () => {
    test('valid but unknown id -> 404 and nothing is created (no upsert)', async () => {
      const res = await api.tutorials.update(await tokenFor('admin'), NON_EXISTENT_ID, { title: 'ghost' });

      expect(res.status).toBe(404);
      expect(res.body.message).toBe(`Cannot update Tutorial with id=${NON_EXISTENT_ID}. Maybe Tutorial was not found!`);
      expect(await load(NON_EXISTENT_ID)).toBeNull();
      expect(await tutorials.countDocuments()).toBe(TUTORIALS.length);
    });

    bugTest('BUG-006', 'malformed id -> 4xx client error, not 500', async () => {
      const res = await api.tutorials.update(await tokenFor('admin'), 'not-an-object-id', { title: 'x' });
      await expectKnownBug('BUG-006', () => expect([400, 404]).toContain(res.status));
    });

    bugTest('BUG-008', 'empty body -> 400 "Data to update can not be empty!"', async () => {
      const before = await load(DRAFT._id);
      const res = await api.tutorials.update(await tokenFor('admin'), DRAFT._id, {});

      expect(await load(DRAFT._id)).toEqual(before);
      await expectKnownBug('BUG-008', () => expect(res.status).toBe(400));
    });
  });
});
