# BUG-009: NoSQL operator injection in the sign-in `username`

| Field | Value |
|---|---|
| **Severity** | **High** (security: authentication logic bypass and username enumeration) |
| **Priority** | P1 |
| **Component** | `auth.controller.js` → `signin` (`User.findOne({ username: req.body.username })`); `verifySignUp.js` has the same pattern |
| **Detected by** | `tests/integration/auth.signin.test.js` → `non-string username (NoSQL operator injection)` |

## Summary
`req.body.username` goes to Mongoose unchecked, so a JSON object is interpreted as a **query operator**:

| Request body | Result |
|---|---|
| `{"username":{"$ne":null},"password":"<pw>"}` | `200`, signed in as **the first user in the collection** (no username needed) |
| `{"username":{"$regex":"^qa_adm"},"password":"x"}` | `401 Invalid Password!` → the prefix **exists** |
| `{"username":{"$regex":"^zzz"},"password":"x"}` | `404 User Not found.` → the prefix does not exist |

The `$regex` oracle lets an attacker enumerate every username one character at a time, then run
password-spraying against the discovered accounts, or sign in with `$ne`/`$regex` without knowing the username.

## Steps to reproduce
```bash
curl -s -X POST http://localhost:8080/api/auth/signin -H 'Content-Type: application/json' \
  -d '{"username":{"$ne":null},"password":"Qa-Passw0rd!"}'
```

## Expected
`400 Bad Request` for a non-string username; never a sign-in or a data-dependent answer.

## Actual
`200 {"id":"66a000000000000000000001","username":"qa_user",...,"accessToken":"..."}`

## Fix
Reject non-string `username`/`password`/`email` (schema validation such as `joi`/`zod`/`express-validator`),
or cast them (`String(req.body.username)`). Enable `mongoose.set('sanitizeFilter', true)` (Mongoose ≥ 6)
or use `express-mongo-sanitize`. Also consider returning the same error for "unknown user" and "wrong password".
Evidence: [`evidence/BUG-004-to-009-transcripts.txt`](evidence/BUG-004-to-009-transcripts.txt)
