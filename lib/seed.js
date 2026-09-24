'use strict';

/**
 * Baseline management: brings the SUT's database into a known, deterministic state.
 *
 * Idempotent by construction — every run converges on exactly the same data:
 *   - roles: the three SUT roles exist exactly once each (inserted if missing, duplicates removed)
 *   - users / refreshtokens / tutorials: emptied, then re-seeded with fixed ObjectIds
 * Shared by the CLI (scripts/test-setup.js) and Jest's globalSetup.
 */

const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const config = require('./config');
const { collections, oid } = require('./db');
const { api } = require('./api-client');
const { waitFor, waitForApiReady } = require('./wait');
const { USERS, TUTORIALS, PASSWORD } = require('./fixtures');

const SESSION_FILE = path.join(config.STATE_DIR, 'session.json');

/** Refuse to wipe anything that is not obviously a local/disposable database. */
function assertSafeTarget() {
  const host = new URL(config.mongoUri.replace(/^mongodb(\+srv)?:/, 'http:')).hostname;
  const local = ['localhost', '127.0.0.1', '::1', 'mongo', 'host.docker.internal'].includes(host);
  if (!local && !config.allowRemoteReset) {
    throw new Error(
      `Refusing to reset non-local MongoDB host "${host}". Set ALLOW_REMOTE_RESET=1 if this is really a disposable test DB.`,
    );
  }
}

/**
 * The SUT seeds its roles on startup, but only when the collection is empty and
 * without a unique index. We wait for that bootstrap to finish (so we never race it),
 * then converge: insert anything missing, delete duplicates. Returns { name: ObjectId }.
 */
async function ensureRoles({ bootstrapTimeoutMs = 15_000 } = {}) {
  const { roles } = await collections();
  const wanted = config.sut.roles;

  try {
    await waitFor(
      async () => {
        const names = await roles.distinct('name');
        return wanted.every((n) => names.includes(n));
      },
      { timeoutMs: bootstrapTimeoutMs, description: 'SUT role bootstrap' },
    );
  } catch {
    // Bootstrap did not happen (e.g. roles were deleted after the app started) — we fill the gap below.
  }

  const ids = {};
  for (const name of wanted) {
    const docs = await roles.find({ name }).sort({ _id: 1 }).toArray();
    if (docs.length === 0) {
      const { insertedId } = await roles.insertOne({ name, __v: 0 });
      ids[name] = insertedId;
    } else {
      ids[name] = docs[0]._id;
      if (docs.length > 1) {
        await roles.deleteMany({ _id: { $in: docs.slice(1).map((d) => d._id) } });
      }
    }
  }
  // Anything that is not one of the three canonical roles is foreign to the baseline.
  await roles.deleteMany({ name: { $nin: wanted } });
  return ids;
}

function buildUserDocs(roleIds) {
  const hash = bcrypt.hashSync(PASSWORD, config.sut.bcryptRounds);
  return Object.values(USERS).map((u) => ({
    _id: oid(u._id),
    username: u.username,
    email: u.email,
    password: hash,
    roles: u.roles.map((r) => roleIds[r]),
    __v: 0,
  }));
}

function buildTutorialDocs() {
  return TUTORIALS.map((t) => ({ ...t, _id: oid(t._id), __v: 0 }));
}

/** Fast reset of just the tutorials collection — used between tests that mutate it. */
async function resetTutorials() {
  const { tutorials } = await collections();
  await tutorials.deleteMany({});
  await tutorials.insertMany(buildTutorialDocs());
}

/**
 * Authentication prerequisites: sign every persona in through the real API, verify
 * the issued token is accepted and carries the expected roles, and persist the
 * tokens to .state/session.json (consumed by lib/auth.js and handy for manual testing).
 */
async function issueTokens() {
  const session = { generatedAt: new Date().toISOString(), apiBaseUrl: config.apiBaseUrl, personas: {} };

  for (const [persona, u] of Object.entries(USERS)) {
    const res = await api.auth.signin({ username: u.username, password: PASSWORD });
    if (res.status !== 200 || !res.body?.accessToken) {
      throw new Error(`Sign-in for seeded persona "${persona}" failed: HTTP ${res.status} ${res.text}`);
    }
    const expectedRoles = u.roles.map((r) => `ROLE_${r.toUpperCase()}`).sort();
    const actualRoles = [...res.body.roles].sort();
    if (JSON.stringify(expectedRoles) !== JSON.stringify(actualRoles)) {
      throw new Error(`Persona "${persona}" has roles ${actualRoles}, expected ${expectedRoles}`);
    }
    const probe = await api.boards.user(res.body.accessToken);
    if (probe.status !== 200) {
      throw new Error(`Token for persona "${persona}" was rejected by a protected endpoint (HTTP ${probe.status})`);
    }
    session.personas[persona] = {
      id: res.body.id,
      username: u.username,
      roles: res.body.roles,
      accessToken: res.body.accessToken,
      refreshToken: res.body.refreshToken,
      issuedAt: Date.now(),
    };
  }

  fs.mkdirSync(config.STATE_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
  return session;
}

/** Full baseline. */
async function establishBaseline({ withTokens = true, log = () => {} } = {}) {
  assertSafeTarget();

  log(`Waiting for API at ${config.apiBaseUrl} and MongoDB ${config.mongoUri}/${config.mongoDb} ...`);
  await waitForApiReady();

  const roleIds = await ensureRoles();
  log(`Roles converged: ${Object.keys(roleIds).join(', ')}`);

  const { users, refreshTokens, tutorials, roles } = await collections();
  const [u, r, t] = await Promise.all([users.deleteMany({}), refreshTokens.deleteMany({}), tutorials.deleteMany({})]);
  log(`Wiped users=${u.deletedCount} refreshtokens=${r.deletedCount} tutorials=${t.deletedCount}`);

  await users.insertMany(buildUserDocs(roleIds));
  await tutorials.insertMany(buildTutorialDocs());
  log(`Seeded ${Object.keys(USERS).length} users and ${TUTORIALS.length} tutorials`);

  let session;
  if (withTokens) {
    session = await issueTokens();
    log(`Issued & verified tokens for: ${Object.keys(session.personas).join(', ')} -> ${path.relative(config.ROOT, SESSION_FILE)}`);
  }

  const summary = {
    roles: await roles.countDocuments(),
    users: await users.countDocuments(),
    tutorials: await tutorials.countDocuments(),
    refreshTokens: await refreshTokens.countDocuments(),
  };
  const expected = { roles: 3, users: Object.keys(USERS).length, tutorials: TUTORIALS.length };
  for (const [k, v] of Object.entries(expected)) {
    if (summary[k] !== v) throw new Error(`Baseline verification failed: ${k}=${summary[k]}, expected ${v}`);
  }
  return { summary, session };
}

module.exports = { establishBaseline, ensureRoles, resetTutorials, issueTokens, SESSION_FILE };
