'use strict';

/**
 * E2E-3  Multi-role collaboration on shared content
 *
 *   A content team (admin, moderator, reader) works on the same catalogue: the moderator
 *   authors content, the reader browses and searches it and is blocked from writing,
 *   the moderator is blocked from deleting, and the admin curates (single delete) and
 *   finally clears the catalogue. Every step checks the database, not just HTTP codes.
 */

const { api } = require('../../lib/api-client');
const { collections, oid } = require('../../lib/db');
const { registerAndSignIn } = require('../../lib/auth');
const { resetTutorials } = require('../../lib/seed');
const { createStepper } = require('../../lib/step');
const { TUTORIALS, PUBLISHED_TUTORIALS } = require('../../lib/fixtures');

describe('E2E: multi-role collaboration', () => {
  beforeAll(resetTutorials);

  test('moderator authors, reader browses, admin curates and clears', async () => {
    const step = createStepper();
    const { tutorials } = await collections();
    const snapshot = () => tutorials.find({}).sort({ _id: 1 }).toArray();

    const [admin, moderator, reader] = await step('team members register with their roles and sign in', async () =>
      Promise.all([
        registerAndSignIn({ roles: ['admin'], prefix: 'e2e_admin' }),
        registerAndSignIn({ roles: ['moderator'], prefix: 'e2e_mod' }),
        registerAndSignIn({ roles: ['user'], prefix: 'e2e_user' }),
      ]),
    );

    const [guide, draft] = await step('moderator authors one published guide and one draft', async () => {
      const a = await api.tutorials.create(moderator.accessToken, { title: 'Team Guide: RBAC', description: 'v1', published: true });
      const b = await api.tutorials.create(moderator.accessToken, { title: 'Team Draft: Auditing', description: 'wip' });
      expect(a.status).toBeLessThan(300);
      expect(b.status).toBeLessThan(300);
      expect(await tutorials.countDocuments()).toBe(TUTORIALS.length + 2);
      return [a.body, b.body];
    });

    await step('reader browses: full list, published-only view, title search', async () => {
      const all = await api.tutorials.list(reader.accessToken);
      expect(all.body).toHaveLength(TUTORIALS.length + 2);

      const published = await api.tutorials.published(reader.accessToken);
      expect(published.body.map((t) => t.id).sort()).toEqual([...PUBLISHED_TUTORIALS.map((t) => t._id), guide.id].sort());

      const search = await api.tutorials.list(reader.accessToken, '?title=team');
      expect(search.body.map((t) => t.id).sort()).toEqual([guide.id, draft.id].sort());
    });

    await step('reader is blocked from every write; database unchanged', async () => {
      const before = await snapshot();
      expect((await api.tutorials.create(reader.accessToken, { title: 'sneaky' })).status).toBe(403);
      expect((await api.tutorials.update(reader.accessToken, guide.id, { title: 'defaced' })).status).toBe(403);
      expect((await api.tutorials.remove(reader.accessToken, guide.id)).status).toBe(403);
      expect((await api.tutorials.removeAll(reader.accessToken)).status).toBe(403);
      expect(await snapshot()).toEqual(before);
    });

    await step('moderator is blocked from deleting; database unchanged', async () => {
      const before = await snapshot();
      expect((await api.tutorials.remove(moderator.accessToken, draft.id)).status).toBe(403);
      expect((await api.tutorials.removeAll(moderator.accessToken)).status).toBe(403);
      expect(await snapshot()).toEqual(before);
    });

    await step('admin deletes the abandoned draft only', async () => {
      const res = await api.tutorials.remove(admin.accessToken, draft.id);
      expect(res.status).toBe(200);
      expect(await tutorials.findOne({ _id: oid(draft.id) })).toBeNull();
      expect(await tutorials.findOne({ _id: oid(guide.id) })).not.toBeNull();
      expect((await api.tutorials.get(reader.accessToken, draft.id)).status).toBe(404);
    });

    await step('admin clears the catalogue; count in response matches what was stored', async () => {
      const remaining = await tutorials.countDocuments();
      expect(remaining).toBe(TUTORIALS.length + 1);
      const res = await api.tutorials.removeAll(admin.accessToken);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe(`${remaining} Tutorials were deleted successfully!`);
      expect(await tutorials.countDocuments()).toBe(0);
    });

    await step('everyone now sees an empty catalogue', async () => {
      for (const member of [admin, moderator, reader]) {
        expect((await api.tutorials.list(member.accessToken)).body).toEqual([]);
        expect((await api.tutorials.published(member.accessToken)).body).toEqual([]);
      }
    });
  });
});
