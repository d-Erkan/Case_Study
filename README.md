# JWT + RBAC Tutorials API: Automated Test Suite

An automated integration and end-to-end test suite, with a reproducible environment and a Test Setup Script, for the
[Node.js JWT refresh-token + RBAC Tutorials API](https://github.com/attarchi-meatec/jwt-refresh-token-node-js-mongodb)
(Express, Mongoose, MongoDB).

> This repository contains **only the test layer**. The application under test (SUT) is never copied here. `npm run env:up`
> clones it into a git-ignored `.sut/` folder at a pinned commit and runs it **unmodified** with its own `docker-compose.yml`.

**Results at a glance:** 155 automated tests covering all 13 endpoints and 5 personas. They found **9 defects**,
including the intentional one:

| | Finding | Severity |
|---|---|---|
| **BUG-001** | `PUT /api/tutorials/:id` answers `200 "updated successfully"` but **never writes anything** (the intentional defect) | Critical |
| BUG-002 | `POST /api/auth/signin` without a password **crashes the API process** | Critical |
| BUG-003 | A deleted user's tokens keep working, and role-guarded routes **crash the API** | High |
| BUG-009 | **NoSQL injection** in the sign-in username (log in without a username; username enumeration) | High |
| BUG-004…008 | RBAC spec mismatch on `/api/test/mod`, auth status codes, 500s on bad input with stack-trace leaks, contract drift | Medium–Low |

Full register: [`docs/bugs/`](docs/bugs/README.md). Formal report for the intentional defect:
[`BUG-001`](docs/bugs/BUG-001-put-tutorial-ignores-payload.md).

---

## 1. Quick start

**Prerequisites**

| Tool | Version | Check |
|---|---|---|
| Docker Engine / Docker Desktop with the Compose v2 plugin | Compose ≥ 2.20 | `docker compose version` |
| Node.js | ≥ 20 | `node -v` |
| git | any | `git --version` |

Free host ports **8080** (API) and **27017** (MongoDB). The SUT's compose file publishes both.

```bash
git clone https://github.com/d-Erkan/Case_Study.git && cd Case_Study
npm ci                 # install test dependencies
npm run env:up         # clone SUT @ pinned commit, build and start API + MongoDB, wait until ready
npm test               # seed baseline, run integration + E2E tests (about 10 s)
npm run env:down       # stop everything and delete the DB volume
```

`npm test` always starts by running the Test Setup Script, so no separate step is needed. Expected tail of the output:

```
──────────────────────── Known bugs ────────────────────────
Mode: xfail — 25 assertion(s) reproduced 9 known bug(s). Run "npm run test:strict" to see them fail.
  ✗ reproduced  BUG-001  PUT /api/tutorials/:id reports success but never applies the update  (5 tests)
  ✗ reproduced  BUG-002  POST /api/auth/signin without a password crashes the API process  (1 test)
  ...
Test Suites: 13 passed, 13 total
Tests:       1 skipped, 154 passed, 155 total
```

To **see the defects fail** as normal test failures, run `npm run test:strict` (exactly the 25 bug assertions fail).

## 2. Commands

| Command | What it does |
|---|---|
| `npm run env:up` | Clones the SUT at the pinned commit (if needed), runs `docker compose up --build --wait`, then waits until the API can reach MongoDB. |
| `npm run env:down` | `docker compose down --volumes`: a clean slate. |
| `npm run env:reset` | Down + up. |
| `npm run env:status` / `env:logs` | Container status / the last 200 API log lines. |
| `npm run test:setup` | **Test Setup Script**: resets the database to the baseline, seeds users and tutorials, and issues and verifies tokens. Idempotent. |
| `npm test` | Every test (known bugs in *xfail* mode, so the suite stays green and summarises the bugs). |
| `npm run test:strict` | Same, but known-bug assertions fail normally (red). |
| `npm run test:integration` / `test:e2e` | One project only. |
| `npm run test:safe` | Skips the tests that intentionally crash the API process. |
| `RUN_SLOW=1 npm run test:e2e` | Also runs the real-time access-token expiry scenario (waits about 62 s). |
| `./scripts/repro/bug-001-update-ignored.sh` | One-shot curl reproduction of BUG-001 (needs `test:setup` first). |

Configuration is optional. Every setting has a default that matches the SUT's compose file; see [`.env.example`](.env.example).

## 3. The Test Setup Script (`npm run test:setup`)

[`scripts/test-setup.js`](scripts/test-setup.js) → [`lib/seed.js`](lib/seed.js). Jest's `globalSetup` uses the same code.

1. **Safety:** refuses to wipe a non-local MongoDB (override with `ALLOW_REMOTE_RESET=1`).
2. **Readiness:** waits for the HTTP listener **and** for a request that needs the database. The SUT starts listening before MongoDB is connected.
3. **Roles:** waits for the SUT's own role bootstrap, then converges on exactly one `user`, `moderator` and `admin` document (inserts missing ones, removes duplicates). Roles are never dropped, because the SUT would not recreate them until it restarts.
4. **Baseline:** empties `users`, `refreshtokens` and `tutorials`, then inserts fixed-ID data from [`lib/fixtures.js`](lib/fixtures.js):
   * `qa_user` (user), `qa_moderator` (moderator), `qa_admin` (admin), `qa_superuser` (all three roles). The password for all of them is `Qa-Passw0rd!`.
   * 5 tutorials (3 published, 2 drafts) with fixed timestamps.
5. **Authentication prerequisites:** signs each persona in **through the API**, checks the returned roles, calls a protected endpoint with the token, and writes the tokens to `.state/session.json`. Tests reuse them while they're fresh; access tokens live only 60 s, so `lib/auth.js` signs in again when needed.
6. **Verification:** asserts the collection counts and exits non-zero on any mismatch.

It is **idempotent**: every run produces identical data (same ObjectIds and timestamps), no matter what earlier runs left behind.

## 4. What is tested

| Suite | Tests | Covers |
|---|---|---|
| `tests/integration/auth.*` | 48 | sign-up (roles persisted, bcrypt at rest, duplicates, invalid roles), sign-in (payload, JWT claims and TTL, refresh token persisted), refresh (flow, expiry and purge, deleted account), token validation (missing, tampered, foreign-signed, `alg:none`, expired), NoSQL injection |
| `tests/integration/rbac.matrix.test.js` | 55 | 11 endpoints × {anonymous, user, moderator, admin, multi-role}, generated from the SUT's permission table. Denied writes are checked against a full DB snapshot. |
| `tests/integration/tutorials.*` | 45 | create / read / update / delete with **database verification of every write** and **exact fixture comparison for every read** |
| `tests/integration/resilience.crash.test.js` | 3 | requests that crash the process, and recovery (run last) |
| `tests/e2e/` | 4 | ① editorial publishing workflow (draft → publish → read → retire), ② session lifecycle (register → sign in → refresh → expiry → re-auth; plus a real-time variant), ③ multi-role collaboration (moderator authors, reader browses, admin curates) |

Tool choices, architecture, data strategy, the known-bug mechanism and assumptions are covered in
**[docs/DESIGN.md](docs/DESIGN.md)**. Limitations and what I would add next are in **[docs/REFLECTION.md](docs/REFLECTION.md)**.

### Tools, briefly

**Jest** (runner: `test.each` matrices, global setup, projects, custom sequencer and reporter), **Node's
built-in `fetch`** (no HTTP dependency; never throws on 4xx/5xx, so error pages and dropped connections can be asserted),
**the official `mongodb` driver** (independent state verification rather than the SUT's own models), and
**bcryptjs / jsonwebtoken** (seeding identical hashes; crafting expired or forged tokens). Everything is JavaScript,
the same stack as the SUT, which keeps the barrier low for its developers.

## 5. Project layout

```
├── scripts/
│   ├── env.js                  # environment lifecycle (clone, compose up/down, readiness)
│   ├── test-setup.js           # Test Setup Script (CLI)
│   └── repro/bug-001-*.sh      # standalone curl reproduction of the intentional defect
├── lib/                        # reusable test framework
│   ├── config.js               # env-overridable settings (defaults = SUT compose)
│   ├── api-client.js           # thin fetch wrapper + endpoint map
│   ├── db.js                   # MongoDB access for seeding & verification
│   ├── fixtures.js             # canonical baseline data (fixed ids/timestamps)
│   ├── seed.js                 # establishBaseline / resetTutorials / issueTokens
│   ├── auth.js                 # token provider (60 s TTL aware), account helpers, JWT crafting
│   ├── known-bugs.js           # expectKnownBug / bugTest ("precise xfail") + bug registry
│   ├── known-bugs-reporter.js  # end-of-run bug summary
│   ├── step.js                 # named steps for E2E failure messages
│   └── wait.js                 # polling / readiness
├── tests/
│   ├── integration/            # endpoint-level tests (incl. RBAC matrix, resilience)
│   ├── e2e/                    # multi-step user journeys
│   ├── global-setup.js         # baseline before every run (+ run lock)
│   └── sequencer.js            # integration → e2e → destructive
├── docker/                     # OPTIONAL build override for TLS-intercepting proxies
├── docs/
│   ├── DESIGN.md  REFLECTION.md
│   └── bugs/                   # bug register, 9 reports, raw evidence
└── .github/workflows/api-tests.yml
```

## 6. Troubleshooting and issues I ran into

These are the problems I actually hit while setting this up from a clean machine (a fresh Linux container) and how I solved them.

| # | Symptom | Cause | Resolution |
|---|---|---|---|
| 1 | `Cannot connect to the Docker daemon` | The Docker daemon wasn't running (fresh container / Docker Desktop not started). | Start Docker Desktop, or `sudo dockerd &` / `sudo systemctl start docker`. `env:up` checks this first and prints a hint. |
| 2 | `429 Too Many Requests` when pulling `mongo:7` | Anonymous Docker Hub pull rate limit (shared IP). | `docker login`, or add a registry mirror to `/etc/docker/daemon.json`: `{"registry-mirrors":["https://mirror.gcr.io"]}`, then restart the daemon. |
| 3 | Image build fails at `RUN npm install`: `SELF_SIGNED_CERT_IN_CHAIN` | A TLS-intercepting corporate proxy; the `node:18-alpine` build container doesn't trust its CA. | `EXTRA_CA_CERT=/path/to/proxy-ca.pem npm run env:up`. This applies [`docker/compose.extra-ca.yml`](docker/compose.extra-ca.yml), which builds the **same, unmodified** SUT code with a Dockerfile that also trusts that CA. It isn't needed on a normal network. |
| 4 | `address already in use` on 8080 or 27017 | A local MongoDB or another service holds the port (the SUT's compose publishes both). | Stop the local service (`brew services stop mongodb-community`, `sudo systemctl stop mongod`), or run the SUT elsewhere and point the suite at it with `API_BASE_URL` / `MONGO_URI`. |
| 5 | The API accepts HTTP requests but sign-in hangs right after start-up | `app.listen()` runs before Mongoose connects. | The readiness probe signs in with an unknown user and waits for the DB-backed `404`. |
| 6 | After roles were deleted, sign-up crashes the API (`TypeError: Cannot read properties of null (reading '_id')`) | The SUT seeds roles only at start-up and only when the collection is empty; sign-up assumes they exist. | The setup script never drops roles. It converges them and re-inserts any that are missing (§3). |
| 7 | Tokens from the setup script are rejected mid-run | Access tokens expire after **60 s** (`auth.config.js` "for test" values). | `lib/auth.js` re-issues tokens transparently after 40 s. |
| 8 | Container restarts during the run; `docker inspect` shows a rising `RestartCount` | Intentional: BUG-002 and BUG-003 crash the process, and `restart: unless-stopped` brings it back. | The resilience tests run last and wait for recovery. Use `npm run test:safe` to skip them. |
| 9 | Random failures when two runs overlap | Both runs reset the same database. | A run lock (`.state/run.lock`) makes the second run fail fast with a clear message. |
| 10 | `env:up` fails with "has local modifications" | Someone edited `.sut/app`. | The SUT must stay unmodified: `rm -rf .sut && npm run env:up`. |

Windows: every script is Node-based, so PowerShell works. The optional `scripts/repro/*.sh` needs Git Bash or WSL.

## 7. Continuous integration

[`.github/workflows/api-tests.yml`](.github/workflows/api-tests.yml) runs the whole flow on every push:
`npm ci → env:up → test:setup → npm test`. It uploads a JSON test report and dumps the API logs on failure.

## 8. Assumptions (summary)

* The SUT's README is the specification; where it disagrees with the code, the code is wrong.
* Deleting a user directly in MongoDB stands in for an admin action (there is no delete-user endpoint).
* The SUT's hard-coded JWT secret, which is public in its repository, is only used to craft expired or forged tokens.

The full list is in [docs/DESIGN.md §9](docs/DESIGN.md#9-assumptions).
