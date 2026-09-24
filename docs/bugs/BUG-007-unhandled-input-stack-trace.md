# BUG-007: Unvalidated input causes `500` responses that leak stack traces

| Field | Value |
|---|---|
| **Severity** | Medium (information disclosure; input handling) |
| **Priority** | P2 |
| **Component** | `auth.controller.js` → `signup`; `tutorial.controller.js` → `findAll` |
| **Detected by** | `auth.signup.test.js`, `tutorials.read.test.js` |

| Request | Expected | Actual |
|---|---|---|
| `POST /api/auth/signup {"username":"x","email":"x@y.z"}` (no password) | `400` JSON validation error | `500` HTML page with a full stack trace (`bcrypt.hashSync` … `/app/app/controllers/auth.controller.js:12:22`) |
| `GET /api/tutorials?title=(Part%201` | `200` literal substring match | `500` HTML page: `SyntaxError: Invalid regular expression: /(Part 1/` plus the stack |

**Root cause:** there's no request validation. The user-supplied `title` goes straight into `new RegExp(title)`,
which is also a ReDoS vector: patterns like `(a+)+$` run inside MongoDB. Express's default error handler
prints stack traces because `NODE_ENV` is not `production`.

**Fix:** validate the signup body. Escape the search term (`title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`).
Run with `NODE_ENV=production` and a JSON error handler.
Evidence: [`evidence/BUG-004-to-009-transcripts.txt`](evidence/BUG-004-to-009-transcripts.txt)
