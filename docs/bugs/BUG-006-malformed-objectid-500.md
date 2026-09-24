# BUG-006: A malformed tutorial id returns `500 Internal Server Error`

| Field | Value |
|---|---|
| **Severity** | Low (wrong error class; pollutes 5xx monitoring) |
| **Priority** | P3 |
| **Component** | `tutorial.controller.js`: `findOne`, `update`, `delete` |
| **Detected by** | `tutorials.read/update/delete.test.js` (`malformed id` cases) |

**Steps:** `curl -H "x-access-token: <token>" http://localhost:8080/api/tutorials/not-an-id` (and the same with `PUT` / `DELETE`).

**Expected:** a client error: `404 Not Found` (documented for these endpoints) or `400 Bad Request`.
**Actual:** `500 {"message":"Error retrieving Tutorial with id=not-an-id"}` (and likewise for update and delete).

**Root cause:** Mongoose throws a `CastError` for ids that aren't ObjectIds; the handlers map every error to 500.
**Fix:** validate with `mongoose.isValidObjectId(id)` and return 400/404 before querying.
