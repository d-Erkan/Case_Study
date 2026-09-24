# Design notes: tools, architecture and decisions

## 1. Tool choices

| Need | Choice | Why | Alternatives considered |
|---|---|---|---|
| Test runner | **Jest 30** | It's the standard for Node, needs no config for plain JS, has `describe.each`/`test.each` for the RBAC matrix, `globalSetup` for the baseline, projects to separate integration from E2E, and a custom sequencer and reporter API. | Mocha+Chai (more wiring), Vitest (nicer for TS/ESM, no real benefit here), Postman/Newman (weak at database assertions and code reuse), Playwright API testing (strong, but a browser-oriented runner for a pure API). |
| HTTP client | **Node's built-in `fetch`**, behind a thin wrapper (`lib/api-client.js`) | No dependency. The wrapper never throws on non-2xx and always exposes status, headers, raw text and parsed JSON, so tests can assert HTML error pages, `text/plain` bodies and dropped connections (all of which the SUT produces). | `supertest` needs the app in-process (we test the real container); `axios` throws on 4xx/5xx by default. |
| DB verification and seeding | **Official `mongodb` driver** | It checks state independently of the SUT's own Mongoose models, so a bug in the app's data layer can't hide itself. | Reusing the SUT's Mongoose models would couple the tests to the code under test. |
| Password hashing for seeding | **`bcryptjs`** (the same algorithm and cost 8 as the SUT) | Seeded users are indistinguishable from API-registered ones. | Seeding through `/signup`: slower, and it makes the baseline depend on the endpoints under test. |
| Token crafting | **`jsonwebtoken`** | Only for expired, foreign-secret or unsigned tokens (see §5). | |
| Environment orchestration | **Node script** (`scripts/env.js`) wrapping `git` and `docker compose` | Cross-platform (works on Windows without WSL), with a single command. | Makefile or bash (not native on Windows). |

## 2. Architecture

```
scripts/env.js ──► clone SUT @ pinned SHA ──► docker compose (SUT's own file) up --wait ──► readiness probe
scripts/test-setup.js ─┐
tests/global-setup.js ─┴► lib/seed.js  establishBaseline():
                              1. refuse non-local DBs      4. seed fixed users + tutorials (lib/fixtures.js)
                              2. wait for API + Mongo      5. sign in each persona via API, verify, save tokens
                              3. converge roles            6. verify collection counts
tests/**         ──► lib/api-client.js (HTTP)  +  lib/db.js (MongoDB)  +  lib/auth.js (tokens)
                     lib/known-bugs.js (bug-aware assertions)  lib/step.js (named E2E steps)
```

* `lib/` holds the reusable test framework. `tests/` holds only scenarios. The Test Setup Script and Jest's
  `globalSetup` call the **same** `establishBaseline()`, so manual and automated runs start from identical state.
* Everything configurable lives in `lib/config.js` and is overridable through env vars (`.env.example`). Defaults
  match the SUT's compose file, so a fresh clone needs no configuration.

## 3. Test data management

* **Deterministic baseline:** 4 personas (`user`, `moderator`, `admin`, `superuser` holding all three roles) and 5 tutorials
  with **fixed ObjectIds and timestamps**. Read tests compare responses field by field against
  `lib/fixtures.js`, not against "whatever is in the database".
* **Idempotent reset:** `deleteMany` + `insertMany` rather than dropping collections, so indexes and collection metadata
  survive. Running it N times always gives the same state; this was verified by running the script twice in a row and
  by repeated full runs.
* **Roles are converged, not recreated.** The SUT inserts roles only when the collection is empty at start-up and
  has no unique index. Dropping roles would break sign-up until the app restarts. The script waits for the app's
  own bootstrap (so it never races it), inserts anything missing and deletes duplicates.
* **Per-test isolation:** files that mutate tutorials call `resetTutorials()` in `beforeEach` (under 20 ms).
  Tests that register accounts use collision-free generated usernames (`uniqueCredentials()`), so user
  creation never needs a reset between tests. The next run's global reset cleans them up.
* **Safety guard:** the reset refuses to run against a non-local MongoDB host unless `ALLOW_REMOTE_RESET=1`.
* **Serial execution plus a run lock:** every test shares one stateful API and database, so the suite runs with
  `maxWorkers: 1`. A second concurrent `npm test` fails fast instead of wiping the first run's data. I hit exactly
  this failure mode during development.

## 4. Verifying real state, not just responses

Every write test checks MongoDB directly:
* creates: the document exists with the right fields; `createdAt == updatedAt`; no mass-assigned fields such as `isAdmin` or a client `_id`.
* updates: the fields changed, the others are intact, `updatedAt` moved, and no other document was touched.
* deletes: exactly one document is gone, the others are byte-for-byte unchanged, and it has disappeared from every read endpoint.
* **denied writes** (RBAC): a snapshot of the whole `tutorials` collection before and after must be identical.
* auth: the password is stored as a bcrypt hash; the refresh token is persisted, linked to the user, with a 120 s expiry; failed sign-ins persist nothing; expired refresh tokens are purged.

This is what exposes BUG-001. The endpoint's status code and body are correct, and only a read-after-write shows the loss.

## 5. Authentication handling

* **60-second access tokens.** A token minted once in the setup script can't survive a multi-minute run.
  `lib/auth.js#tokenFor(persona)` reuses the setup script's tokens (from `.state/session.json`) while they are
  under 40 s old and signs in again transparently after that.
* **Time travel instead of sleeping.** Refresh-token expiry is simulated by moving `expiryDate` into the past in
  MongoDB. Access-token expiry is tested with a token **crafted with the SUT's hard-coded secret**
  (white-box knowledge, configurable through `SUT_JWT_SECRET`). To show the behaviour without shortcuts, a real-time
  variant waits the full 60 s (`RUN_SLOW=1`).
* Tampered and foreign-signed tokens are built without the secret (payload swapped, signature kept; different key; `alg: none`).

## 6. Known-bug strategy ("precise xfail")

Tests always assert the **documented or expected** behaviour. Only the single assertion that demonstrates a defect
is wrapped in `expectKnownBug('BUG-00x', () => ...)`:

| Mode | Behaviour | Use |
|---|---|---|
| `KNOWN_BUGS=xfail` (default, `npm test`) | The bug assertion fails, so it's recorded and the test stops as passed. If the assertion *passes*, the test fails with "BUG-00x no longer reproduces". | CI stays green while the bugs are open. New regressions still go red, and the end-of-run summary lists every reproduced bug. |
| `KNOWN_BUGS=strict` (`npm run test:strict`) | The wrapper is transparent and bug assertions fail normally. | Shows the defects; used to verify a fix. |

I chose this over `test.failing` on purpose. With `test.failing`, any error (including an unrelated setup failure)
would count as the "expected" failure. Here every other assertion in the test behaves normally.

## 7. Destructive tests

BUG-002 and BUG-003 kill the Node process. Those tests:
* live in one file, `resilience.crash.test.js`, which the custom sequencer always runs **last**;
* treat a dropped connection as a distinct outcome (`attempt()` returns `{ connectionError }`);
* wait for full API and database readiness after every test (the SUT's compose restarts the container);
* can be excluded with `SKIP_DESTRUCTIVE=1` (`npm run test:safe`).

## 8. Coverage

155 tests (151 integration, 4 E2E). One real-time test is skipped by default.

| Area | File | Tests | Highlights |
|---|---|---|---|
| Sign-up | `auth.signup.test.js` | 14 | default and explicit roles persisted, bcrypt at rest, duplicate username/email, unknown roles, missing password |
| Sign-in | `auth.signin.test.js` | 10 | payload contract, JWT claims and TTL, refresh token persisted with TTL, wrong/unknown credentials, NoSQL injection |
| Refresh | `auth.refresh-token.test.js` | 9 | refresh flow, no rotation, missing/unknown/expired tokens, purge on expiry, deleted account |
| Token validation | `auth.token-validation.test.js` | 15 | missing, garbage, tampered, foreign-secret, `alg:none` and expired tokens; deleted account; header name |
| RBAC | `rbac.matrix.test.js` | 55 | 11 endpoints × 5 personas (anonymous, user, moderator, admin, multi-role), plus a DB snapshot on denied writes |
| Create | `tutorials.create.test.js` | 9 | persisted state, defaults, mass assignment, validation, status contract |
| Read | `tutorials.read.test.js` | 17 | exact fixture comparison, title search (case, partial, regex metacharacters), published filter, 404/malformed ids, pagination |
| Update | `tutorials.update.test.js` | 11 | **BUG-001**: full and partial updates, timestamps, read-after-write, isolation, 404, malformed id, empty body |
| Delete | `tutorials.delete.test.js` | 8 | single/bulk delete with exact counts, idempotency, isolation from other collections |
| Resilience | `resilience.crash.test.js` | 3 | process crashes (BUG-002/003) and recovery |
| E2E | `tests/e2e/*` | 4 | publishing workflow, session lifecycle (plus the real-time variant), multi-role collaboration |

## 9. Assumptions

* **The SUT README is the specification.** Where code and README disagree, the README wins (for example 201 vs 200, and "moderator or admin" on `/api/test/mod`).
* "Missing token → 401": the README lists 401 for these endpoints and never lists 403 for a missing token.
* Malformed ids should return 4xx. The README lists 404 for `/:id` endpoints and never lists 500.
* Pagination convention: bezkoder's own `?page=&size=` (the SUT is derived from bezkoder's projects).
* Deleting a user directly in MongoDB stands in for an admin action. The SUT has no delete-user endpoint.
* The SUT's hard-coded JWT secret may be used by the tests. It's public in the repository and is only used to create expired or forged tokens.
