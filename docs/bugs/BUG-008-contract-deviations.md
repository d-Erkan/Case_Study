# BUG-008: Responses deviate from the documented API contract

| Field | Value |
|---|---|
| **Severity** | Low (documentation versus implementation drift; breaks contract-driven clients) |
| **Priority** | P3. Decide per item whether to fix the code or the docs. |
| **Detected by** | tests tagged `[BUG-008]` in `auth.signup`, `auth.refresh-token`, `tutorials.create/read/update` |

| # | Endpoint | Documented | Actual |
|---|---|---|---|
| 1 | `POST /api/auth/signup` | `201` + user object (id, roles) | `200 {"message":"User was registered successfully!"}` |
| 2 | `POST /api/tutorials` | `201 Created` | `200` (body is correct) |
| 3 | `PUT /api/tutorials/:id` | returns the updated tutorial object | `{"message":"Tutorial was updated successfully."}` |
| 4 | `PUT /api/tutorials/:id` with `{}` | `400 Bad Request` | `200` (the `!req.body` guard never fires) |
| 5 | `POST /api/auth/refreshtoken` with an unknown token | `404` | `403 {"message":"Refresh token is not in database!"}` |
| 6 | `GET /api/tutorials` | "with pagination support" | no pagination; `?page=0&size=2` returns every item |

Steps and evidence for each item: [`evidence/BUG-004-to-009-transcripts.txt`](evidence/BUG-004-to-009-transcripts.txt).
