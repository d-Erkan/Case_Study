# BUG-001: `PUT /api/tutorials/:id` returns success but never updates the tutorial

| Field | Value |
|---|---|
| **ID** | BUG-001 |
| **Severity** | **Critical**: silent data loss. Every edit a moderator or admin makes is discarded while the client is told it succeeded. |
| **Priority** | P1 (blocks the core "draft → publish" editorial workflow) |
| **Component** | Tutorials API, `app/controllers/tutorial.controller.js` → `exports.update` |
| **Endpoint** | `PUT /api/tutorials/:id` |
| **Affected roles** | moderator, admin (the only roles allowed to call it) |
| **Environment** | Local Docker Compose stack from the SUT repo @ `efbed6c`; `node:18-alpine` (Node 18.20.8), mongoose 5.13.23, MongoDB 7.0 |
| **Reproducibility** | 100% (deterministic) |
| **Detected by** | `tests/integration/tutorials.update.test.js` (4 tests), `tests/e2e/publishing-workflow.e2e.test.js` (step 5) |
| **Status** | Open |

## Summary

The update endpoint authenticates and authorises the caller, looks up the tutorial and answers
`200 {"message":"Tutorial was updated successfully."}`. It never applies the request body.
Title, description, `published` and `updatedAt` all stay as they were. No error is returned and
nothing is logged, so neither the client nor operators can see that the write was lost.

## Steps to reproduce

Prerequisites: `npm run env:up && npm run test:setup` (the seeded moderator is `qa_moderator` / `Qa-Passw0rd!`).
You can also run the whole sequence with one script: `./scripts/repro/bug-001-update-ignored.sh`.

1. Sign in as a moderator:
   ```bash
   TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/signin \
     -H 'Content-Type: application/json' \
     -d '{"username":"qa_moderator","password":"Qa-Passw0rd!"}' | jq -r .accessToken)
   ```
2. Create a tutorial and note its `id`:
   ```bash
   curl -s -X POST http://localhost:8080/api/tutorials -H "x-access-token: $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"title":"Original title","description":"Original description","published":false}'
   ```
3. Update it:
   ```bash
   curl -i -X PUT http://localhost:8080/api/tutorials/<id> -H "x-access-token: $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"title":"Updated title","description":"Updated description","published":true}'
   ```
4. Read it back with `GET /api/tutorials/<id>`, or query MongoDB directly:
   ```bash
   docker exec jwt-rbac-qa-mongo-1 mongosh --quiet bezkoder_db \
     --eval "printjson(db.tutorials.findOne({_id: ObjectId('<id>')}))"
   ```

## Expected result

Per the SUT README ("Updates an existing tutorial by ID with new title, description, or published status"):

- The tutorial in MongoDB has `title = "Updated title"`, `description = "Updated description"`, `published = true`.
- `updatedAt` is later than before; `createdAt` is unchanged.
- A partial body (e.g. only `{"published": true}`) changes only that field.
- `GET /api/tutorials/<id>` and `GET /api/tutorials/published` show the new state.
- Response: `200` with the updated tutorial object (documented). The current message body is a separate, minor deviation tracked in BUG-008.

## Actual result

- Response: **`200 OK`** `{"message":"Tutorial was updated successfully."}`
- The document is **unchanged**. That includes `updatedAt`, so this is not a stale read.
- A non-existent id still correctly returns `404`, and a user token correctly returns `403`. Only the write itself is missing.

### Request / response evidence

This is taken from [`evidence/BUG-001-repro-output.txt`](evidence/BUG-001-repro-output.txt):

```
> POST /api/tutorials {"title":"Original title","description":"Original description","published":false}
< {"title":"Original title","description":"Original description","published":false,
   "createdAt":"2026-09-24T14:45:34.788Z","updatedAt":"2026-09-24T14:45:34.788Z","id":"6ab5378ebb274b70d4134e12"}

> PUT /api/tutorials/6ab5378ebb274b70d4134e12 {"title":"Updated title","description":"Updated description","published":true}
< HTTP/1.1 200 OK
< Content-Type: application/json; charset=utf-8
< {"message":"Tutorial was updated successfully."}

> GET /api/tutorials/6ab5378ebb274b70d4134e12
< {"title":"Original title","description":"Original description","published":false,
   "createdAt":"2026-09-24T14:45:34.788Z","updatedAt":"2026-09-24T14:45:34.788Z","id":"6ab5378ebb274b70d4134e12"}

MongoDB:
{ _id: ObjectId('6ab5378ebb274b70d4134e12'), title: 'Original title', description: 'Original description',
  published: false, createdAt: ISODate('2026-09-24T14:45:34.788Z'), updatedAt: ISODate('2026-09-24T14:45:34.788Z'), __v: 0 }
```

### Database-level evidence (MongoDB profiler)

With profiling level 2, a `PUT` records **only a `find` with `limit: 1`** on the `tutorials` collection.
No `update` or `findAndModify` command ever reaches the database
([`evidence/BUG-001-mongodb-profiler.txt`](evidence/BUG-001-mongodb-profiler.txt)):

```
{ op: 'query', command: { find: 'tutorials', filter: { _id: ObjectId('66b000000000000000000004') }, limit: 1 },
  docsExamined: 1, nreturned: 1 }
```

### Automated test output (`npm run test:strict`)

```
● E2E: editorial publishing workflow › draft -> edit & publish -> read by reader -> retire by admin [BUG-001]

  Step 5 "moderator edits and publishes the draft" failed:
  expect(received).toMatchObject(expected)
  -   "description": "final version",
  -   "published": true,
  +   "description": "first draft",
  +   "published": false,
```

Server logs: nothing is logged for the failed write, which is part of the problem.

## Root cause analysis

`app/controllers/tutorial.controller.js`, `exports.update`:

```js
Tutorial.findByIdAndUpdate(id, undefined, { useFindAndModify: false })   // ← update document is `undefined`
```

`req.body` is never passed to the update. Given an `undefined` update, Mongoose 5 falls back to a plain
`findOne` (as the profiler shows). The call resolves with the **existing** document, so the handler's
`if (!data)` check passes and it reports success.

Related weakness: the `if (!req.body)` guard can never fire, because `express.json()` always supplies an object
(`{}` for an empty body). An empty update is therefore also answered with `200` (tracked in BUG-008).

## Suggested fix

```js
Tutorial.findByIdAndUpdate(id, req.body, { useFindAndModify: false, new: true, runValidators: true })
  .then(data => data ? res.send(data) : res.status(404).send({ message: `Cannot update Tutorial with id=${id}...` }))
```

Consider also whitelisting the updatable fields (`title`, `description`, `published`) instead of passing
`req.body` through unchanged, and rejecting an empty update with `400`.

**Verifying the fix:** run `npm run test:strict`. The 4 `[BUG-001]` tests in `tutorials.update.test.js` and the
publishing E2E scenario must pass. In the default mode those tests will then fail with
*"BUG-001 no longer reproduces"*, which is the reminder to remove the `expectKnownBug` wrapper.

## Impact

- **Users:** moderators believe their edits are saved; content can never move from draft to published through the API.
- **Data integrity:** every update request is silently lost.
- **Detectability:** a check on status codes alone passes. Only a read-after-write or database check reveals the defect.
  This is why the suite verifies every write against MongoDB.
