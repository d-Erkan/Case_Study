'use strict';

/**
 * Known-bug handling ("precise xfail").
 *
 * Tests always assert the *documented / expected* behaviour. The single assertion
 * that demonstrates a defect is wrapped in `expectKnownBug(id, fn)`:
 *
 *   KNOWN_BUGS=xfail (default)  the failing assertion is recorded as "reproduced" and the
 *                               test stops there as passed; if the assertion unexpectedly
 *                               PASSES, the test fails ("bug seems fixed — update the suite").
 *   KNOWN_BUGS=strict           the assertion runs as a normal expectation -> test goes red.
 *
 * Unlike `test.failing`, every other assertion in the test still behaves normally, so a
 * test cannot silently "pass" because of an unrelated failure (e.g. a setup error).
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const REGISTRY = {
  'BUG-001': 'PUT /api/tutorials/:id reports success but never applies the update',
  'BUG-002': 'POST /api/auth/signin without a password crashes the API process',
  'BUG-003': 'Tokens of a deleted user: RBAC middleware crashes the API; refresh token keeps working',
  'BUG-004': 'GET /api/test/mod rejects admins (documented: moderator or admin)',
  'BUG-005': 'Authentication failures: missing token -> 403 (documented 401); invalid token -> non-JSON 401 + server error',
  'BUG-006': 'Malformed ObjectId in /api/tutorials/:id -> 500 instead of 4xx',
  'BUG-007': 'Unvalidated input -> 500 with stack trace disclosure (signup w/o password, regex title filter)',
  'BUG-008': 'Response contract deviations (201 on create, signup body, 404 for unknown refresh token, pagination)',
  'BUG-009': 'NoSQL operator injection in sign-in username (login without username, username enumeration)',
};

const LEDGER = path.join(config.REPORTS_DIR, 'known-bugs.jsonl');

class KnownBugReproduced extends Error {
  constructor(bugId, cause) {
    super(`[${bugId}] reproduced: ${firstLine(cause?.message)}`);
    this.name = 'KnownBugReproduced';
    this.bugId = bugId;
  }
}

function firstLine(msg = '') {
  // Strip ANSI colour codes from Jest matcher output, keep it short.
  return String(msg).replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter(Boolean).slice(0, 3).join(' | ');
}

function record(bugId, detail) {
  let testName = 'unknown test';
  try {
    testName = expect.getState().currentTestName || testName;
  } catch {
    /* outside Jest */
  }
  fs.mkdirSync(config.REPORTS_DIR, { recursive: true });
  fs.appendFileSync(LEDGER, `${JSON.stringify({ bugId, test: testName, detail })}\n`);
}

async function expectKnownBug(bugId, assertion) {
  if (!REGISTRY[bugId]) throw new Error(`Unregistered bug id "${bugId}" — add it to lib/known-bugs.js`);
  if (config.knownBugsMode === 'strict') {
    await assertion();
    return;
  }
  try {
    await assertion();
  } catch (err) {
    record(bugId, firstLine(err?.message || String(err)));
    throw new KnownBugReproduced(bugId, err);
  }
  throw new Error(
    `[${bugId}] no longer reproduces — the assertion documenting "${REGISTRY[bugId]}" now passes. ` +
      'If the defect was fixed, remove the expectKnownBug() wrapper and update docs/bugs/.',
  );
}

/** `test()` variant for tests containing expectKnownBug(). Title is suffixed with the bug id(s). */
function bugTest(bugIds, title, fn, timeout) {
  const ids = [].concat(bugIds);
  test(`${title} [${ids.join(', ')}]`, async () => {
    try {
      await fn();
    } catch (err) {
      if (err && err.name === 'KnownBugReproduced' && ids.includes(err.bugId)) return;
      throw err;
    }
  }, timeout);
}

module.exports = { expectKnownBug, bugTest, REGISTRY, LEDGER };
