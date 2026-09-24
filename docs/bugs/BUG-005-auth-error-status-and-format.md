# BUG-005: Authentication failures use the wrong status code and inconsistent bodies

| Field | Value |
|---|---|
| **Severity** | Low–Medium (contract/interoperability; server-side error on every invalid token) |
| **Priority** | P3 |
| **Component** | `app/middlewares/authJwt.js`: `verifyToken`, `catchError` |
| **Detected by** | `tests/integration/auth.token-validation.test.js` |

| Case | Documented | Actual |
|---|---|---|
| No `x-access-token` header | `401 Unauthorized` | `403 {"message":"No token provided!"}` |
| Malformed / tampered / foreign-signed token | `401` with a JSON message | `401` **`text/plain` "Unauthorized"**; the server logs `ERR_HTTP_HEADERS_SENT` |

**Steps:** `curl -i http://localhost:8080/api/tutorials`, then
`curl -i -H 'x-access-token: not-a-jwt' http://localhost:8080/api/tutorials`, then check `npm run env:logs`.

**Root cause:** `catchError` calls `res.sendStatus(401).send({...})`. `sendStatus` already sends the response,
so the chained `.send` throws "Cannot set headers after they are sent". Missing credentials should be `401`
(authentication), not `403` (authorisation).

**Fix:** `return res.status(401).send({ message: "Unauthorized!" })`, and use `401` for the missing-token branch.
Evidence: [`evidence/BUG-004-to-009-transcripts.txt`](evidence/BUG-004-to-009-transcripts.txt)
