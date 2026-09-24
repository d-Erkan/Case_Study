'use strict';

/**
 * E2E-1  Editorial publishing workflow
 *
 *   new moderator registers -> signs in -> drafts a tutorial -> a reader cannot see it
 *   among published content -> the moderator edits & publishes it -> the reader now
 *   sees the published version -> an admin retires it -> it is gone for everyone.
 *
 * The draft -> published state transition goes through PUT /api/tutorials/:id, so
 * this realistic journey is blocked by BUG-001 at step 5.
 */

const { api } = require('../../lib/api-client');
const { collections, oid } = require('../../lib/db');
const { registerAndSignIn, tokenFor } = require('../../lib/auth');
const { resetTutorials } = require('../../lib/seed');
const { createStepper } = require('../../lib/step');
const { bugTest, expectKnownBug } = require('../../lib/known-bugs');

describe('E2E: editorial publishing workflow', () => {
  beforeAll(resetTutorials);

  bugTest('BUG-001', 'draft -> edit & publish -> read by reader -> retire by admin', async () => {
    const step = createStepper();
    const { tutorials } = await collections();

    const moderator = await step('a new moderator registers and signs in', async () => {
      const m = await registerAndSignIn({ roles: ['moderator'], prefix: 'e2e_mod' });
      expect(m.roles).toEqual(['ROLE_MODERATOR']);
      return m;
    });

    const reader = await step('a new reader registers (default role) and signs in', async () => {
      const r = await registerAndSignIn({ prefix: 'e2e_reader' });
      expect(r.roles).toEqual(['ROLE_USER']);
      return r;
    });

    const draft = await step('moderator creates a draft', async () => {
      const res = await api.tutorials.create(moderator.accessToken, {
        title: 'E2E: Refresh token rotation',
        description: 'first draft',
      });
      expect(res.status).toBeLessThan(300);
      expect(res.body.published).toBe(false);
      expect(await tutorials.findOne({ _id: oid(res.body.id) })).toMatchObject({ published: false, description: 'first draft' });
      return res.body;
    });

    await step('reader sees the draft in the full list but NOT among published tutorials', async () => {
      const all = await api.tutorials.list(reader.accessToken);
      const published = await api.tutorials.published(reader.accessToken);
      expect(all.body.map((t) => t.id)).toContain(draft.id);
      expect(published.body.map((t) => t.id)).not.toContain(draft.id);
    });

    await step('moderator edits and publishes the draft', async () => {
      const res = await api.tutorials.update(moderator.accessToken, draft.id, {
        description: 'final version',
        published: true,
      });
      expect(res.status).toBe(200);
      const doc = await tutorials.findOne({ _id: oid(draft.id) });
      await expectKnownBug('BUG-001', () => expect(doc).toMatchObject({ description: 'final version', published: true }));
    });

    await step('reader now sees the published, edited version', async () => {
      const published = await api.tutorials.published(reader.accessToken);
      const mine = published.body.find((t) => t.id === draft.id);
      expect(mine).toMatchObject({ description: 'final version', published: true });
      expect(Date.parse(mine.updatedAt)).toBeGreaterThan(Date.parse(mine.createdAt));
    });

    await step('reader cannot retire the tutorial; moderator cannot either', async () => {
      expect((await api.tutorials.remove(reader.accessToken, draft.id)).status).toBe(403);
      expect((await api.tutorials.remove(moderator.accessToken, draft.id)).status).toBe(403);
      expect(await tutorials.findOne({ _id: oid(draft.id) })).not.toBeNull();
    });

    await step('admin retires it; it disappears for the reader', async () => {
      const res = await api.tutorials.remove(await tokenFor('admin'), draft.id);
      expect(res.status).toBe(200);
      expect(await tutorials.findOne({ _id: oid(draft.id) })).toBeNull();
      expect((await api.tutorials.get(reader.accessToken, draft.id)).status).toBe(404);
    });
  });
});
