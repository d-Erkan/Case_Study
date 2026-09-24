'use strict';

/**
 * Canonical baseline data. The setup script writes exactly this into MongoDB
 * (with fixed ObjectIds and timestamps), so read-path assertions can compare
 * against known values instead of "whatever happens to be in the DB".
 */

const PASSWORD = 'Qa-Passw0rd!';

/** Seeded accounts ("personas"), keyed by the name tests use to refer to them. */
const USERS = {
  user: {
    _id: '66a000000000000000000001',
    username: 'qa_user',
    email: 'qa_user@example.test',
    roles: ['user'],
  },
  moderator: {
    _id: '66a000000000000000000002',
    username: 'qa_moderator',
    email: 'qa_moderator@example.test',
    roles: ['moderator'],
  },
  admin: {
    _id: '66a000000000000000000003',
    username: 'qa_admin',
    email: 'qa_admin@example.test',
    roles: ['admin'],
  },
  // Mirrors the "roles": ["user","moderator","admin"] example in the SUT docs.
  superuser: {
    _id: '66a000000000000000000004',
    username: 'qa_superuser',
    email: 'qa_superuser@example.test',
    roles: ['user', 'moderator', 'admin'],
  },
};

const BASE_TIME = Date.parse('2024-01-01T00:00:00.000Z');
const at = (minutes) => new Date(BASE_TIME + minutes * 60_000);

/** Seeded tutorials: a deliberate mix of published / draft and searchable titles. */
const TUTORIALS = [
  {
    _id: '66b000000000000000000001',
    title: 'Node.js Basics',
    description: 'Getting started with Node.js',
    published: true,
    createdAt: at(0),
    updatedAt: at(0),
  },
  {
    _id: '66b000000000000000000002',
    title: 'Advanced Node.js Streams',
    description: 'Backpressure and pipelines',
    published: false,
    createdAt: at(1),
    updatedAt: at(1),
  },
  {
    _id: '66b000000000000000000003',
    title: 'MongoDB Indexing',
    description: 'Compound and partial indexes',
    published: true,
    createdAt: at(2),
    updatedAt: at(2),
  },
  {
    _id: '66b000000000000000000004',
    title: 'JWT Deep Dive',
    description: 'Access and refresh token design',
    published: false,
    createdAt: at(3),
    updatedAt: at(3),
  },
  {
    _id: '66b000000000000000000005',
    title: 'Express Middleware (Part 1)',
    description: 'Title with regex metacharacters on purpose',
    published: true,
    createdAt: at(4),
    updatedAt: at(4),
  },
];

const PUBLISHED_TUTORIALS = TUTORIALS.filter((t) => t.published);

/** A syntactically valid ObjectId that is guaranteed not to exist in the baseline. */
const NON_EXISTENT_ID = '66bfffffffffffffffffffff';

/** How the API is expected to serialise a tutorial (toJSON: _id -> id, no __v). */
function toApiShape(t) {
  return {
    id: t._id,
    title: t.title,
    description: t.description,
    published: t.published,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

module.exports = { PASSWORD, USERS, TUTORIALS, PUBLISHED_TUTORIALS, NON_EXISTENT_ID, toApiShape };
