# Reflection

## What I would add for a production-grade suite

1. **Contract testing from a machine-readable spec.** The main source of BUG-008 is a prose README that drifted from
   the code. I would write an OpenAPI spec, validate every response against it (e.g. `jest-openapi` or
   Schemathesis-style fuzzing), and run it as a CI gate on both sides.
2. **Hermetic, parallel environments.** Today there's one shared stack, tests run serially and a run lock
   prevents collisions. I would start a stack (or at least a database) per worker, e.g. Testcontainers with
   a randomised `DB_NAME` per Jest worker. That buys parallelism and removes the lock.
3. **Fully pinned environment.** The SUT has no lockfile and uses floating image tags (`node:18-alpine`, `mongo:7`),
   so rebuilding later may produce different dependency versions. I would pin image digests and generate a lockfile
   in a controlled build. The suite already records the versions it ran against in the docs.
4. **Security testing as its own stream.** Automated DAST (OWASP ZAP), dependency scanning (`npm audit`: the SUT
   uses jsonwebtoken 8.x and mongoose 5.x, both end-of-life) and focused tests for SEC-01…05 (rate limiting,
   token revocation, secrets in logs).
5. **Non-functional checks.** A load test (k6) around sign-in and refresh: bcrypt is CPU-bound and the refresh
   collection is never pruned. A resilience test that restarts MongoDB mid-run.
6. **Reporting.** JUnit and HTML reports as CI artefacts, trend tracking for flaky tests, and a link from each
   bug ID to the issue tracker instead of Markdown files.
7. **Static quality gates on the test code.** ESLint and Prettier, plus TypeScript or JSDoc types for the helper
   library once it grows beyond a single consumer.

## Limitations of the current approach

* **White-box shortcuts.** Expired access tokens are forged with the SUT's hard-coded secret, and refresh-token
  expiry is simulated by editing MongoDB. Both are deliberate (a 155-test run takes about 7 s instead of minutes),
  and a real-time test covers the unshortened path (`RUN_SLOW=1`). If the secret moves to an env var, set `SUT_JWT_SECRET`.
* **Direct DB coupling.** Tests know the collection names and document shapes Mongoose derives. A schema
  refactor in the SUT means updating `lib/db.js` and the fixtures. I accepted that because independent state
  verification is the point of the exercise.
* **Destructive tests rely on Docker's restart policy.** Against a bare `node server.js` they would leave the API down.
  They are isolated, run last and can be skipped (`SKIP_DESTRUCTIVE=1`).
* **xfail mode can make open bugs easy to ignore.** A green run with 9 open bugs is intentional and loudly
  summarised, but a team has to own the register. That's why `npm run test:strict` exists and why fixed bugs
  make the suite fail until the wrapper is removed.
* **Contract ambiguity.** Where the README is vague (pagination format, 400 vs 404 for malformed ids),
  I documented my interpretation (DESIGN.md §9). A real project would settle these with the product owner.

## Risks and edge cases not covered, and why

| Not covered | Reasoning |
|---|---|
| Concurrency: parallel sign-ups with the same username or email (read-then-write race, no unique index) | Probably reproducible, but timing-dependent tests are flaky. I'd rather fix it with a unique index than test for a race. Noted as OBS-02. |
| Real refresh-token expiry at 120 s | Covered through DB time travel; a real-time test adds 2 minutes for no new information. |
| Large payloads, body-size limits, unusual content types (`x-www-form-urlencoded` is also accepted) | Low risk for this API; Express defaults apply. |
| CORS (`origin: http://localhost:8081`) | Browser-enforced and irrelevant to server-to-server tests. It belongs in a front-end E2E suite. |
| ReDoS payloads in `?title=` | Confirming them means deliberately saturating MongoDB's CPU. I reported the root cause (BUG-007) without running a harmful payload. |
| Brute-force and rate limiting | There's no rate limiting to test (SEC-05). A test would just be a load generator. |
| Character-by-character username enumeration through `$regex` | Two requests prove the oracle (BUG-009); a full extraction adds nothing. |
| Token clock-skew and `nbf` handling | No custom claims are used; jsonwebtoken defaults apply. |
| Unicode or very long usernames and passwords | No validation exists, so every input is "accepted"; the gap is already reported (BUG-007, OBS-02). |
