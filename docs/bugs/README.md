# Bug register

All findings were observed against the SUT at commit
[`efbed6c`](https://github.com/attarchi-meatec/jwt-refresh-token-node-js-mongodb/commit/efbed6c4d01517fa47b4639a9b2f03b4159ec1c9),
running with its own Docker Compose file. The automated suite reproduces every finding. Run `npm run test:strict`
to see them fail, or look for the `[BUG-xxx]` suffix on test names.

**The intentional defect is BUG-001.** The rest were found while building the suite.

| ID | Title | Severity | Endpoint(s) | Tests |
|---|---|---|---|---|
| [BUG-001](BUG-001-put-tutorial-ignores-payload.md) | `PUT` reports success but never applies the update (intentional defect) | **Critical** | `PUT /api/tutorials/:id` | 5 |
| [BUG-002](BUG-002-signin-without-password-crashes-api.md) | Sign-in without a password crashes the API process (DoS) | **Critical** | `POST /api/auth/signin` | 1 |
| [BUG-003](BUG-003-deleted-user-tokens.md) | Deleted user's tokens stay valid; RBAC middleware crashes the API | **High** | all protected routes, `POST /api/auth/refreshtoken` | 3 |
| [BUG-009](BUG-009-nosql-injection-signin.md) | NoSQL operator injection in sign-in username | **High** | `POST /api/auth/signin` | 2 |
| [BUG-004](BUG-004-mod-board-rejects-admin.md) | `/api/test/mod` rejects admins (spec: moderator **or** admin) | Medium | `GET /api/test/mod` | 1 |
| [BUG-007](BUG-007-unhandled-input-stack-trace.md) | Unvalidated input → 500 with stack trace disclosure | Medium | `POST /api/auth/signup`, `GET /api/tutorials?title=` | 2 |
| [BUG-005](BUG-005-auth-error-status-and-format.md) | Missing token → 403 (spec 401); invalid token → text/plain + server error | Low–Medium | all protected routes | 2 |
| [BUG-006](BUG-006-malformed-objectid-500.md) | Malformed ObjectId → 500 | Low | `GET/PUT/DELETE /api/tutorials/:id` | 3 |
| [BUG-008](BUG-008-contract-deviations.md) | Status codes and bodies deviate from the documented contract | Low | several | 6 |

Evidence (raw request/response transcripts, container logs, MongoDB profiler output) is in [`evidence/`](evidence/).

## Severity scale

- **Critical**: data loss or full outage that an ordinary request can trigger.
- **High**: security weakness, or an outage that needs some precondition.
- **Medium**: wrong behaviour against the spec with a limited blast radius, or information disclosure.
- **Low**: contract or ergonomics deviation with no data or security impact.

## Observations (not raised as bugs)

These are risks or design choices rather than deviations from the documentation. They are listed so a reviewer
can decide whether to act on them.

| ID | Observation | Why it matters |
|---|---|---|
| SEC-01 | **Public sign-up can self-assign `admin`/`moderator`** (`"roles":["admin"]`). This is documented behaviour. | Anyone can become an admin. The whole RBAC model depends on sign-up not being public in production. |
| SEC-02 | **JWT secret hard-coded** in `app/config/auth.config.js` (`bezkoder-secret-key`). | Anyone who reads the repo can forge tokens for any user. A test documents this (`auth.token-validation.test.js`). |
| SEC-03 | **Refresh tokens are written to stdout** (`console.log(_object)` in `refreshToken.model.js`). | Log readers can hijack sessions. |
| SEC-04 | No refresh-token rotation, no revocation or logout endpoint, and expired tokens are purged only when someone presents them. | A stolen refresh token stays usable for its full lifetime. |
| SEC-05 | No rate limiting or lock-out on `/api/auth/signin`; distinct `404 User Not found` / `401 Invalid Password` responses. | Brute force and username enumeration (the 404/401 split is in the docs, so it's not raised as a bug). |
| OBS-01 | Read endpoints check authentication only, not role. An account with `"roles": []` (allowed by sign-up) can still read tutorials. | The docs list the role "user / mod / admin" for reads. The practical impact is small. |
| OBS-02 | No email format or password strength validation; username/email uniqueness is enforced only by a read-then-write check, with no unique index. | Concurrent sign-ups can create duplicates (a race that wasn't tested). |
| OBS-03 | Roles are seeded only when the `roles` collection is empty at start-up, and there's no unique index on `roles.name`. | If the roles are missing while the app runs, the next sign-up persists a role-less user and then **crashes the process** (`role._id` on `null`). The restart happens to re-seed the roles. Duplicate roles are possible. Not raised as a bug because it needs direct DB tampering; the setup script guards against it (`lib/seed.js`). |
| OBS-04 | The SUT has no `package-lock.json`, so dependency versions are resolved at image build time (observed: mongoose 5.13.23, express 4.22.3, jsonwebtoken 8.5.1). | Builds aren't bit-for-bit reproducible over time. |
| OBS-05 | MongoDB is published on host port 27017 with no authentication (dev compose). | Fine for local development. Must not be reused as a deployment template. |
