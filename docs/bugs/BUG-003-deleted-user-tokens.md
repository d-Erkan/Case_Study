# BUG-003: Tokens of a deleted account keep working, and RBAC endpoints crash the API

| Field | Value |
|---|---|
| **Severity** | **High**: (a) access is not revoked when an account is removed; (b) an authenticated DoS. |
| **Priority** | P1 |
| **Component** | `app/middlewares/authJwt.js` (`isAdmin`, `isModerator`, `isModeratorOrAdmin`, e.g. line 104); `app/controllers/auth.controller.js` → `refreshToken` |
| **Environment** | SUT @ `efbed6c`, Docker Compose |
| **Reproducibility** | 100% |
| **Detected by** | `auth.token-validation.test.js`, `auth.refresh-token.test.js`, `resilience.crash.test.js` |

## Summary
Deleting a user does not invalidate that user's tokens:
1. **Read endpoints** (`verifyToken` only) keep serving data to the deleted account until the JWT expires.
2. **The refresh token keeps minting new access tokens** for up to 2 minutes, because `refreshToken` never checks that the user still exists.
3. **Any role-guarded endpoint crashes the process**: `User.findById()` returns `null` and `user.roles` throws a
   `TypeError` inside a Mongoose callback. That's an uncaught exception, and the container restarts.

## Steps to reproduce
1. Register and sign in a moderator; keep its `accessToken` and `refreshToken`.
2. Delete the account (as an admin would): `db.users.deleteOne({username: "<name>"})`
3. `GET /api/tutorials/published` with the access token → **200** (expected 401).
4. `POST /api/auth/refreshtoken {"refreshToken": "<token>"}` → **200 + new access token** (expected 403).
5. `POST /api/tutorials` with the access token → **no response, and the process crashes** (expected 401/403).

## Actual (excerpt from [`evidence/BUG-003-deleted-user.txt`](evidence/BUG-003-deleted-user.txt))
```
(a) GET /api/tutorials/published           < HTTP 200
(b) POST /api/auth/refreshtoken            {"accessToken":"eyJ...(valid JWT)", ...} < HTTP 200
(c) POST /api/tutorials                    < HTTP 000  curl exit code: 52
TypeError: Cannot read properties of null (reading 'roles')
    at /app/app/middlewares/authJwt.js:104:26
    at /app/node_modules/mongoose/lib/model.js:5082:18
docker inspect RestartCount before: 13, after: 14
```

## Suggested fix
- In the role middlewares: `if (!user) return res.status(401).send({ message: "Unauthorized!" })`.
- In `verifyToken`: optionally confirm the user still exists (or use short-lived tokens plus a revocation list).
- In `refreshToken`: reject the token if its user no longer exists. On account deletion, delete the user's refresh tokens (`RefreshToken.deleteMany({ user })`).
