#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="${PATH}:/home/admin1/.nvm/versions/node/v22.23.1/bin"

PROJECT=astera-app-e2e7375
COMPOSE=(docker compose -f docker-compose.e2e-process7375.yml --project-name "$PROJECT")

fail() {
  echo "e2e7375 failed: $1" >&2
  "${COMPOSE[@]}" ps >&2 || true
  exit 1
}

"${COMPOSE[@]}" build astera-app-api-e2e7375 astera-app-ui-e2e7375 astera-app-pages-e2e7375
"${COMPOSE[@]}" up -d astera-app-api-e2e7375
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T astera-app-api-e2e7375 node -e "fetch('http://127.0.0.1:8788/ready').then(async r=>{if(!r.ok)process.exit(1);const j=await r.json();if(!String(j.process_origin||'').includes('7375'))process.exit(2);process.exit(0);}).catch(()=>process.exit(1));" 2>/dev/null; then
    break
  fi
  sleep 2
done
"${COMPOSE[@]}" exec -T astera-app-api-e2e7375 node -e "fetch('http://127.0.0.1:8788/ready').then(async r=>{if(!r.ok)process.exit(1);const j=await r.json();if(!String(j.process_origin||'').includes('7375'))process.exit(2);console.log('ready process_origin='+j.process_origin);}).catch(()=>process.exit(1));" || fail "app-api /ready not on 7375"

"${COMPOSE[@]}" up -d astera-app-pages-e2e7375
for _ in $(seq 1 90); do
  if curl -sf -m 2 http://127.0.0.1:8780/ >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -sf -m 2 http://127.0.0.1:8780/ >/dev/null || fail "pages dev not ready on 8780"

"${COMPOSE[@]}" up -d astera-app-ui-e2e7375
for _ in $(seq 1 30); do
  if curl -sf -m 2 http://127.0.0.1:8083/ >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -sf -m 2 http://127.0.0.1:8083/ >/dev/null || fail "ui not ready on 8083"

E2E7375_BASE_URL=http://127.0.0.1:8083 npx playwright test --config playwright.e2e7375.config.ts
echo "e2e7375 playwright finished"
