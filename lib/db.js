'use strict';

/**
 * Direct MongoDB access used for (a) seeding a deterministic baseline and
 * (b) verifying persisted state independently of the API's own responses.
 *
 * Collection names are the ones Mongoose derives from the SUT's models:
 *   User -> users, Role -> roles, RefreshToken -> refreshtokens, tutorial -> tutorials
 */

const { MongoClient, ObjectId } = require('mongodb');
const { mongoUri, mongoDb } = require('./config');

let client;

async function getDb() {
  if (!client) {
    client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5_000 });
    await client.connect();
  }
  return client.db(mongoDb);
}

async function collections() {
  const db = await getDb();
  return {
    users: db.collection('users'),
    roles: db.collection('roles'),
    refreshTokens: db.collection('refreshtokens'),
    tutorials: db.collection('tutorials'),
  };
}

async function closeDb() {
  if (client) {
    await client.close();
    client = undefined;
  }
}

const oid = (hex) => new ObjectId(hex);

/** Role names of a user document, resolved through the roles collection. */
async function roleNamesOf(userDoc) {
  const { roles } = await collections();
  const docs = await roles.find({ _id: { $in: userDoc.roles || [] } }).toArray();
  return docs.map((r) => r.name).sort();
}

module.exports = { getDb, collections, closeDb, oid, ObjectId, roleNamesOf };
