# BUG-004: `GET /api/test/mod` rejects admins

| Field | Value |
|---|---|
| **Severity** | Medium (RBAC rule differs from the specification) |
| **Priority** | P2 |
| **Component** | `app/routes/user.routes.js` uses `authJwt.isModerator` |
| **Detected by** | `tests/integration/rbac.matrix.test.js` → `GET /api/test/mod › admin is ALLOWED [BUG-004]` |

**Specification** (SUT README): "GET `/api/test/mod`, Required Role: **moderator or admin**".

**Steps:** sign in as `qa_admin`, then `curl -H "x-access-token: <admin token>" http://localhost:8080/api/test/mod`.

**Expected:** `200 Moderator Content.`
**Actual:** `403 {"message":"Require Moderator Role!"}`. An account holding both roles (`qa_superuser`) gets 200, which confirms the check is "has moderator" and not "moderator or admin".

**Fix:** use `authJwt.isModeratorOrAdmin` (the tutorial routes already use it) for this route.
Evidence: [`evidence/BUG-004-to-009-transcripts.txt`](evidence/BUG-004-to-009-transcripts.txt)
