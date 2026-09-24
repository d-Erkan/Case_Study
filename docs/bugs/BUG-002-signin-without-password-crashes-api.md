# BUG-002: `POST /api/auth/signin` without a password crashes the API process

| Field | Value |
|---|---|
| **Severity** | **Critical**: one anonymous request takes the whole service down (denial of service). |
| **Priority** | P1 |
| **Component** | `app/controllers/auth.controller.js` → `exports.signin` (line 79) |
| **Environment** | SUT @ `efbed6c`, Docker Compose, Node 18.20.8, mongoose 5.13.23 |
| **Reproducibility** | 100% |
| **Detected by** | `tests/integration/resilience.crash.test.js` |

## Summary
When the request body names an **existing** username but has no `password`, `bcrypt.compareSync(undefined, hash)`
throws inside a Mongoose `exec` callback. Nothing catches it, so Node terminates the process. All in-flight
requests are dropped. The service only comes back because the SUT's `docker-compose.yml` has `restart: unless-stopped`.
Outside Docker, or under repeated requests while Docker's restart back-off grows, the API stays down.

## Steps to reproduce
1. `npm run env:up && npm run test:setup`
2. `curl -s -w '[%{http_code}]' -X POST http://localhost:8080/api/auth/signin -H 'Content-Type: application/json' -d '{"username":"qa_user"}'`
3. `docker inspect -f '{{.RestartCount}}' jwt-rbac-qa-app-1`: the count has gone up.

## Expected
`400 Bad Request` (or `401`) with a JSON error. The process keeps running.

## Actual
No HTTP response (`curl: (52) Empty reply from server`, HTTP code `000`). The container restarts. Log:
```
Error: Illegal arguments: undefined, string
    at bcrypt.compareSync (/app/node_modules/bcryptjs/dist/bcrypt.js:265:19)
    at /app/app/controllers/auth.controller.js:79:36
    at /app/node_modules/mongoose/lib/model.js:5082:18
Node.js v18.20.8
Server is running on port 8080.        <- restarted by Docker
```
Full transcript: [`evidence/BUG-002-crash.txt`](evidence/BUG-002-crash.txt)

## Root cause / suggested fix
There's no input validation, and the throw happens inside a callback that Express cannot catch.
Validate `username`/`password` as non-empty strings before the query (return `400`). Move to `async/await` with
`try/catch`, or use `bcrypt.compare` with error handling. Add a process-level safety net (log and exit cleanly
under a supervisor) rather than relying on a crash.
