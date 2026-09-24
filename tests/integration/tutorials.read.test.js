'use strict';

/**
 * Read endpoints are asserted against the seeded fixtures (lib/fixtures.js), not
 * against whatever the API happens to return — exact, deterministic comparisons.
 */

const { api } = require('../../lib/api-client');
const { tokenFor } = require('../../lib/auth');
const { resetTutorials } = require('../../lib/seed');
const { TUTORIALS, PUBLISHED_TUTORIALS, NON_EXISTENT_ID, toApiShape } = require('../../lib/fixtures');
const { bugTest, expectKnownBug } = require('../../lib/known-bugs');

const byId = (a, b) => a.id.localeCompare(b.id);

describe('Tutorial read endpoints', () => {
  let token;
  beforeAll(async () => {
    await resetTutorials();
    token = await tokenFor('user');
  });

  describe('GET /api/tutorials', () => {
    test('returns exactly the seeded tutorials (published and drafts) in API shape', async () => {
      const res = await api.tutorials.list(token);

      expect(res.status).toBe(200);
      expect([...res.body].sort(byId)).toEqual(TUTORIALS.map(toApiShape).sort(byId));
    });

    test.each([
      ['node', ['Node.js Basics', 'Advanced Node.js Streams']],
      ['NODE', ['Node.js Basics', 'Advanced Node.js Streams']],
      ['mongo', ['MongoDB Indexing']],
      ['deep dive', ['JWT Deep Dive']],
      ['no-such-title', []],
    ])('?title=%s filters by case-insensitive substring', async (q, expectedTitles) => {
      const res = await api.tutorials.list(token, `?title=${encodeURIComponent(q)}`);

      expect(res.status).toBe(200);
      expect(res.body.map((t) => t.title).sort()).toEqual([...expectedTitles].sort());
    });

    bugTest('BUG-007', '?title containing regex metacharacters is matched literally (not a 500)', async () => {
      const res = await api.tutorials.list(token, `?title=${encodeURIComponent('(Part 1')}`);

      await expectKnownBug('BUG-007', () => {
        expect(res.status).toBe(200);
        expect(res.body.map((t) => t.title)).toEqual(['Express Middleware (Part 1)']);
      });
    });

    bugTest('BUG-008', 'supports pagination (documented: "Array of tutorial objects with pagination support")', async () => {
      // bezkoder's pagination convention: ?page=<n>&size=<n>
      const res = await api.tutorials.list(token, '?page=0&size=2');

      expect(res.status).toBe(200);
      await expectKnownBug('BUG-008', () => expect(res.body).toHaveLength(2));
    });
  });

  describe('GET /api/tutorials/published', () => {
    test('returns only published tutorials', async () => {
      const res = await api.tutorials.published(token);

      expect(res.status).toBe(200);
      expect([...res.body].sort(byId)).toEqual(PUBLISHED_TUTORIALS.map(toApiShape).sort(byId));
      expect(res.body.every((t) => t.published === true)).toBe(true);
    });

    test('route is not shadowed by /:id ("published" is not treated as an id)', async () => {
      const res = await api.tutorials.published(token);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/tutorials/:id', () => {
    test.each(TUTORIALS.map((t) => [t.title, t]))('returns "%s" exactly as seeded', async (_, fixture) => {
      const res = await api.tutorials.get(token, fixture._id);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(toApiShape(fixture));
    });

    test('valid but unknown id -> 404', async () => {
      const res = await api.tutorials.get(token, NON_EXISTENT_ID);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: `Not found Tutorial with id ${NON_EXISTENT_ID}` });
    });

    bugTest('BUG-006', 'malformed id -> 4xx client error, not 500', async () => {
      const res = await api.tutorials.get(token, 'not-an-object-id');

      await expectKnownBug('BUG-006', () => expect([400, 404]).toContain(res.status));
    });
  });
});
