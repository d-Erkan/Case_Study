#!/usr/bin/env bash
# Reproduces BUG-001: PUT /api/tutorials/:id returns 200 "updated successfully"
# but the tutorial is never modified.
#
# Prerequisites: environment up (npm run env:up) and baseline seeded (npm run test:setup).
# Requires: bash, curl, node (for JSON parsing), docker (for the DB check).
set -euo pipefail

API="${API_BASE_URL:-http://localhost:8080}"
MONGO_CONTAINER="${MONGO_CONTAINER:-jwt-rbac-qa-mongo-1}"
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[process.argv[1]]))' "$1"; }
say() { printf '\n\033[1m# %s\033[0m\n' "$*"; }

say "1. Sign in as the seeded moderator (qa_moderator)"
TOKEN=$(curl -s -X POST "$API/api/auth/signin" -H 'Content-Type: application/json' \
  -d '{"username":"qa_moderator","password":"Qa-Passw0rd!"}' | json accessToken)
echo "accessToken: ${TOKEN:0:20}..."

say "2. Create a tutorial"
echo "> POST /api/tutorials {\"title\":\"Original title\",\"description\":\"Original description\",\"published\":false}"
CREATED=$(curl -s -X POST "$API/api/tutorials" -H "x-access-token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Original title","description":"Original description","published":false}')
echo "< $CREATED"
ID=$(echo "$CREATED" | json id)

say "3. Update it"
echo "> PUT /api/tutorials/$ID {\"title\":\"Updated title\",\"description\":\"Updated description\",\"published\":true}"
curl -s -i -X PUT "$API/api/tutorials/$ID" -H "x-access-token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Updated title","description":"Updated description","published":true}' | sed 's/^/< /'
echo

say "4. Read it back through the API"
echo "> GET /api/tutorials/$ID"
echo "< $(curl -s "$API/api/tutorials/$ID" -H "x-access-token: $TOKEN")"

say "5. Read it straight from MongoDB"
if docker ps --format '{{.Names}}' | grep -qx "$MONGO_CONTAINER"; then
  docker exec "$MONGO_CONTAINER" mongosh --quiet bezkoder_db \
    --eval "printjson(db.tutorials.findOne({_id: ObjectId('$ID')}))"
else
  echo "(container $MONGO_CONTAINER not found; skipping DB check)"
fi

say "Result: the API answered 200 'Tutorial was updated successfully.' but title/description/published/updatedAt are unchanged."
