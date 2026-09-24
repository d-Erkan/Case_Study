'use strict';

const { api } = require('../../lib/api-client');
const { collections, oid } = require('../../lib/db');
const { tokenFor } = require('../../lib/auth');
const { resetTutorials } = require('../../lib/seed');
const { TUTORIALS } = require('../../lib/fixtures');
const { bugTest, expectKnownBug } = require('../../lib/known-bugs');

describe('POST /api/tutorials', () => {
  let tutorials;
  beforeAll(async () => {
    ({ tutorials } = await collections());
  });
  beforeEach(resetTutorials);

  test.each(['moderator', 'admin'])('%s creates a tutorial; response and database agree', async (persona) => {
    const input = { title: `Created by ${persona}`, description: 'Integration test', published: true };
    const t0 = Date.now();

    const res = await api.tutorials.create(await tokenFor(persona), input);

    expect(res.status).toBeLessThan(300);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      ...input,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(res.body).not.toHaveProperty('_id');
    expect(res.body).not.toHaveProperty('__v');

    const doc = await tutorials.findOne({ _id: oid(res.body.id) });
    expect(doc).toMatchObject(input);
    expect(doc.createdAt.toISOString()).toBe(res.body.createdAt);
    expect(doc.updatedAt.getTime()).toBe(doc.createdAt.getTime());
    expect(doc.createdAt.getTime()).toBeGreaterThanOrEqual(t0 - 2000);
    expect(doc.createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 2000);
    expect(await tutorials.countDocuments()).toBe(TUTORIALS.length + 1);
  });

  test('"published" defaults to false when omitted', async () => {
    const res = await api.tutorials.create(await tokenFor('moderator'), { title: 'Draft only' });

    expect(res.body.published).toBe(false);
    const doc = await tutorials.findOne({ _id: oid(res.body.id) });
    expect(doc.published).toBe(false);
    expect(doc).not.toHaveProperty('description');
  });

  test('unknown fields and client-supplied ids/timestamps are not persisted', async () => {
    const forcedId = '66bdddddddddddddddddddd1';
    const res = await api.tutorials.create(await tokenFor('moderator'), {
      title: 'Mass assignment probe',
      _id: forcedId,
      id: forcedId,
      createdAt: '2000-01-01T00:00:00.000Z',
      isAdmin: true,
    });

    expect(res.status).toBeLessThan(300);
    expect(res.body.id).not.toBe(forcedId);
    const doc = await tutorials.findOne({ _id: oid(res.body.id) });
    expect(doc).not.toHaveProperty('isAdmin');
    expect(doc.createdAt.getFullYear()).toBeGreaterThan(2000);
    expect(await tutorials.findOne({ _id: oid(forcedId) })).toBeNull();
  });

  test.each([
    ['missing title', { description: 'no title' }],
    ['empty title', { title: '', description: 'empty title' }],
    ['empty body', {}],
  ])('%s -> 400 and nothing is persisted', async (_, body) => {
    const res = await api.tutorials.create(await tokenFor('admin'), body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Content can not be empty!' });
    expect(await tutorials.countDocuments()).toBe(TUTORIALS.length);
  });

  test('duplicate titles are allowed (no uniqueness constraint) — documents current behaviour', async () => {
    const token = await tokenFor('moderator');
    const res = await api.tutorials.create(token, { title: TUTORIALS[0].title });
    expect(res.status).toBeLessThan(300);
    expect(await tutorials.countDocuments({ title: TUTORIALS[0].title })).toBe(2);
  });

  bugTest('BUG-008', 'responds 201 Created (documented contract)', async () => {
    const res = await api.tutorials.create(await tokenFor('moderator'), { title: 'Status code probe' });
    expect(res.body.id).toBeDefined();
    await expectKnownBug('BUG-008', () => expect(res.status).toBe(201));
  });
});
