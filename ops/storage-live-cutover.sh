#!/usr/bin/env bash
set -Eeuo pipefail

TGS_LIVE=/home/admin1/projects/TGserver
APP_LIVE=/home/admin1/projects/astera-app
TGS_SHA=b530a1030ae828ed6683d930a6fe7777d199f41b
APP_SHA=2d98b7ed84342d393496be956c0867392f5dfc20
STAMP="$(date +%Y%m%d-%H%M%S)"
REL="/home/admin1/releases/storage-backend-${STAMP}"
BACKUP="/home/admin1/backups/storage-backend-${STAMP}"
TGS_REL="$REL/TGserver"
APP_REL="$REL/astera-app"
TGS_ENV="$TGS_LIVE/.env"
APP_ENV="$APP_LIVE/contabo/app-api/.env"
TGS_COMPOSE="$TGS_LIVE/docker-compose.yml"
APP_OLD_COMPOSE="$APP_LIVE/docker-compose.yml"
APP_NEW_COMPOSE="$APP_REL/docker-compose.yml"
TGS_OVERRIDE="$REL/tgs-live.override.yml"
APP_OVERRIDE="$REL/app-live.override.yml"
TGS_RB_OVERRIDE="$REL/tgs-rollback.override.yml"
APP_RB_OVERRIDE="$REL/app-rollback.override.yml"
NEW_TGS_IMAGE="astera-tgserver-storage-live:${STAMP}"
NEW_APP_IMAGE="astera-app-api-storage-live:${STAMP}"
OLD_TGS_TAG="astera-tgserver-storage-rollback:${STAMP}"
OLD_APP_TAG="astera-app-api-storage-rollback:${STAMP}"
ARMED=0
SERVICES_CHANGED=0

log(){ printf '%s\n' "$*"; }
fail(){ log "REASON=$1"; if [ "$ARMED" = 1 ]; then return 1; fi; log "OVERALL=BLOCKED_BEFORE_MUTATION"; exit 1; }

rollback(){
  rc=$?
  trap - ERR
  log ""
  log "========== AUTOMATIC ROLLBACK =========="
  if [ "$ARMED" = 1 ]; then
    sudo cp -a "$BACKUP/TGserver.env" "$TGS_ENV" 2>/dev/null || true
    sudo cp -a "$BACKUP/app-api.env" "$APP_ENV" 2>/dev/null || true
    if [ "$SERVICES_CHANGED" = 1 ]; then
      cat >"$TGS_RB_OVERRIDE" <<YAML
services:
  tgs:
    image: ${OLD_TGS_TAG}
YAML
      cat >"$APP_RB_OVERRIDE" <<YAML
services:
  astera-app-api:
    image: ${OLD_APP_TAG}
YAML
      sudo docker compose -p "$TGS_PROJECT" -f "$TGS_COMPOSE" -f "$TGS_RB_OVERRIDE" up -d --no-deps --no-build tgs || true
      sudo docker compose -p "$APP_PROJECT" -f "$APP_OLD_COMPOSE" -f "$APP_RB_OVERRIDE" up -d --no-deps --no-build astera-app-api || true
      sleep 4
    fi
    log "ROLLBACK=ATTEMPTED"
    log "OVERALL=FAILED_ROLLED_BACK"
  else
    log "ROLLBACK=NOT_NEEDED"
    log "OVERALL=BLOCKED_BEFORE_MUTATION"
  fi
  exit "$rc"
}
trap rollback ERR

log "============================================================"
log " ASTERA STORAGE BACKEND LIVE CUTOVER"
log "============================================================"

[ -f "$TGS_ENV" ] || fail TGS_ENV_MISSING
[ -f "$APP_ENV" ] || fail APP_ENV_MISSING
[ -f "$TGS_COMPOSE" ] || fail TGS_COMPOSE_MISSING
[ -f "$APP_OLD_COMPOSE" ] || fail APP_COMPOSE_MISSING
sudo docker inspect tgserver-tgs-1 >/dev/null 2>&1 || fail TGS_CONTAINER_MISSING
sudo docker inspect astera-app-api >/dev/null 2>&1 || fail APP_CONTAINER_MISSING

TGS_PROJECT="$(sudo docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' tgserver-tgs-1)"
APP_PROJECT="$(sudo docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' astera-app-api)"
[ -n "$TGS_PROJECT" ] || fail TGS_PROJECT_UNKNOWN
[ -n "$APP_PROJECT" ] || fail APP_PROJECT_UNKNOWN
log "TGS_PROJECT=$TGS_PROJECT"
log "APP_PROJECT=$APP_PROJECT"

log ""
log "========== 1. SOURCE AUTHORITY =========="
git -C "$TGS_LIVE" fetch -q origin main
git -C "$APP_LIVE" fetch -q origin main
[ "$(git -C "$TGS_LIVE" rev-parse origin/main)" = "$TGS_SHA" ] || fail TGS_MAIN_SHA_MISMATCH
[ "$(git -C "$APP_LIVE" rev-parse origin/main)" = "$APP_SHA" ] || fail APP_MAIN_SHA_MISMATCH
log "TGS_MAIN_SHA=PASS|$TGS_SHA"
log "APP_MAIN_SHA=PASS|$APP_SHA"

log ""
log "========== 2. CURRENT LIVE HEALTH =========="
curl -fsS --max-time 10 http://127.0.0.1:3000/health >/tmp/tgs-before.json
curl -fsS --max-time 10 http://127.0.0.1:8788/health >/tmp/app-before.json
log "TGS_LIVE_BEFORE=PASS"
log "APP_LIVE_BEFORE=PASS"

log ""
log "========== 3. HOST NETWORK DEPENDENCY GATE =========="
python3 - "$APP_ENV" <<'PY'
import socket,sys
from urllib.parse import urlparse
env={}
for raw in open(sys.argv[1],encoding='utf-8'):
    s=raw.strip()
    if s and not s.startswith('#') and '=' in s:
        k,v=s.split('=',1); env[k.strip()]=v.strip().strip('"').strip("'")
for key in ('ASTERA_PROCESS_ORIGIN','LIBRAL_VAULT_INTERNAL_ORIGIN'):
    raw=env.get(key,'')
    if not raw:
        print(f'{key}_GATE=FAIL|MISSING'); raise SystemExit(21)
    u=urlparse(raw); host=u.hostname; port=u.port or (443 if u.scheme=='https' else 80)
    try:
        with socket.create_connection((host,port),timeout=4): pass
    except Exception as e:
        print(f'{key}_GATE=FAIL|HOST_NOT_REACHABLE|{host}:{port}|{type(e).__name__}'); raise SystemExit(22)
    print(f'{key}_GATE=PASS|{host}:{port}')
PY

log ""
log "========== 4. CLEAN RELEASE SOURCE =========="
mkdir -p "$TGS_REL" "$APP_REL" "$BACKUP"
git -C "$TGS_LIVE" archive "$TGS_SHA" | tar -x -C "$TGS_REL"
git -C "$APP_LIVE" archive "$APP_SHA" | tar -x -C "$APP_REL"
ln -s "$APP_ENV" "$APP_REL/contabo/app-api/.env"
log "RELEASE_SOURCE=PASS"

log ""
log "========== 5. BUILD =========="
sudo docker build --pull=false -t "$NEW_TGS_IMAGE" "$TGS_REL"
sudo docker build --pull=false -f "$APP_REL/contabo/app-api/Dockerfile" -t "$NEW_APP_IMAGE" "$APP_REL"
log "IMAGE_BUILD=PASS"

log ""
log "========== 6. ROLLBACK SNAPSHOT =========="
sudo cp -a "$TGS_ENV" "$BACKUP/TGserver.env"
sudo cp -a "$APP_ENV" "$BACKUP/app-api.env"
OLD_TGS_ID="$(sudo docker inspect -f '{{.Image}}' tgserver-tgs-1)"
OLD_APP_ID="$(sudo docker inspect -f '{{.Image}}' astera-app-api)"
sudo docker tag "$OLD_TGS_ID" "$OLD_TGS_TAG"
sudo docker tag "$OLD_APP_ID" "$OLD_APP_TAG"
ARMED=1
log "ROLLBACK_SNAPSHOT=PASS"

log ""
log "========== 7. STORAGE SECRET CONTRACT =========="
python3 - "$TGS_ENV" "$APP_ENV" <<'PY'
import os,secrets,stat,sys
from pathlib import Path

def load(path):
    lines=path.read_text(encoding='utf-8').splitlines(); vals={}
    for line in lines:
        s=line.strip()
        if s and not s.startswith('#') and '=' in s:
            k,v=s.split('=',1); vals[k.strip()]=v.strip().strip('"').strip("'")
    return lines,vals

def update(path,values):
    lines,_=load(path); out=[]; done=set()
    for line in lines:
        s=line.strip()
        if s and not s.startswith('#') and '=' in s:
            k=line.split('=',1)[0].strip()
            if k in values:
                out.append(f'{k}={values[k]}'); done.add(k); continue
        out.append(line)
    if out and out[-1] != '': out.append('')
    for k,v in values.items():
        if k not in done: out.append(f'{k}={v}')
    mode=stat.S_IMODE(path.stat().st_mode); tmp=path.with_name(path.name+'.cutover.tmp')
    tmp.write_text('\n'.join(out)+'\n',encoding='utf-8'); os.chmod(tmp,mode); os.replace(tmp,path)

tgs_path=Path(sys.argv[1]); app_path=Path(sys.argv[2]); _,tgs=load(tgs_path)
if tgs.get('TELEGRAM_APP_STORAGE_CHAT_ID','').strip() != '-1003934977314':
    print('TGS_STORAGE_CHAT_GATE=FAIL'); raise SystemExit(31)
token=tgs.get('TGS_STORAGE_INTERNAL_TOKEN','').strip()
if not token or token.startswith('REPLACE_'):
    token=secrets.token_urlsafe(48); update(tgs_path,{'TGS_STORAGE_INTERNAL_TOKEN':token}); print('TGS_STORAGE_TOKEN=GENERATED')
else:
    print('TGS_STORAGE_TOKEN=REUSED')
update(app_path,{'TGS_STORAGE_INTERNAL_ORIGIN':'http://127.0.0.1:3000','TGS_STORAGE_INTERNAL_TOKEN':token,'TGS_STORAGE_TIMEOUT_MS':'600000'})
print('TGS_STORAGE_CHAT_GATE=PASS')
print('APP_TGS_SECRET_SYNC=PASS')
print('SECRET_VALUES_PRINTED=NO')
PY

log ""
log "========== 8. VAULT KEY REAL PROBE =========="
python3 - "$APP_ENV" <<'PY'
import base64,json,os,stat,sys
from pathlib import Path
from urllib.request import Request,urlopen
p=Path(sys.argv[1])
def env():
    d={}
    for raw in p.read_text(encoding='utf-8').splitlines():
        s=raw.strip()
        if s and not s.startswith('#') and '=' in s:
            k,v=s.split('=',1); d[k.strip()]=v.strip().strip('"').strip("'")
    return d
def setref(ref):
    lines=p.read_text(encoding='utf-8').splitlines(); out=[]; found=False
    for line in lines:
        if line.strip().startswith('LIBRAL_VAULT_JOB_KEY_REF='): out.append('LIBRAL_VAULT_JOB_KEY_REF='+ref); found=True
        else: out.append(line)
    if not found: out.append('LIBRAL_VAULT_JOB_KEY_REF='+ref)
    mode=stat.S_IMODE(p.stat().st_mode); t=p.with_name(p.name+'.vault.tmp'); t.write_text('\n'.join(out)+'\n'); os.chmod(t,mode); os.replace(t,p)
e=env(); origin=e.get('LIBRAL_VAULT_INTERNAL_ORIGIN','').rstrip('/'); token=e.get('LIBRAL_VAULT_INTERNAL_TOKEN',''); current=e.get('LIBRAL_VAULT_JOB_KEY_REF','')
def call(path,data):
    try:
        req=Request(origin+path,data=json.dumps(data).encode(),method='POST',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        with urlopen(req,timeout=8) as r: return json.loads(r.read())
    except Exception: return None
def test(ref):
    plain=b'astera-storage-key-probe'; s=call('/internal/v1/crypto/seal',{'key_ref':ref,'consumer':'astera-app-runtime','plaintext_base64':base64.b64encode(plain).decode()})
    if not s or not s.get('ciphertext') or not s.get('iv'): return False
    u=call('/internal/v1/crypto/unseal',{'key_ref':ref,'consumer':'astera-app-runtime','ciphertext':s['ciphertext'],'iv':s['iv']})
    try: return bool(u and base64.b64decode(u['plaintext_base64'])==plain)
    except Exception: return False
if not origin or not token or not current: print('VAULT_KEY_REF_GATE=FAIL|CONFIG'); raise SystemExit(41)
if test(current): print('VAULT_KEY_REF_GATE=PASS_CURRENT')
elif current=='local-job-key-ref' and test('astera-storage-wrap-key-v1'):
    setref('astera-storage-wrap-key-v1'); print('VAULT_KEY_REF_GATE=PASS_SWITCHED_FROM_PLACEHOLDER')
else: print('VAULT_KEY_REF_GATE=FAIL|UNUSABLE'); raise SystemExit(42)
PY

cat >"$TGS_OVERRIDE" <<YAML
services:
  tgs:
    image: ${NEW_TGS_IMAGE}
YAML
cat >"$APP_OVERRIDE" <<YAML
services:
  astera-app-api:
    image: ${NEW_APP_IMAGE}
YAML

log ""
log "========== 9. CUTOVER TGserver 3000 =========="
SERVICES_CHANGED=1
sudo docker compose -p "$TGS_PROJECT" -f "$TGS_COMPOSE" -f "$TGS_OVERRIDE" config -q
sudo docker compose -p "$TGS_PROJECT" -f "$TGS_COMPOSE" -f "$TGS_OVERRIDE" up -d --no-deps --no-build tgs
for i in $(seq 1 30); do
  body="$(curl -fsS --max-time 5 http://127.0.0.1:3000/health 2>/dev/null || true)"
  if python3 -c 'import json,sys;x=json.loads(sys.stdin.read());sys.exit(0 if x.get("status")=="ok" and x.get("user_storage")=="configured" and "bot-chunk" in str(x.get("version","")) else 1)' <<<"$body" 2>/dev/null; then break; fi
  [ "$i" -lt 30 ] || fail TGS_HEALTH_AFTER_CUTOVER_FAILED
  sleep 2
done
log "TGS_LIVE_CUTOVER=PASS"
code="$(curl -sS --max-time 5 -o /tmp/tgs-auth.json -w '%{http_code}' -X PUT http://127.0.0.1:3000/internal/v1/user-storage/cutover-auth-probe || true)"
[ "$code" = 401 ] || fail TGS_AUTH_FAIL_CLOSED_FAILED
log "TGS_AUTH_FAIL_CLOSED=PASS"

log ""
log "========== 10. CUTOVER App API 8788 =========="
sudo docker compose -p "$APP_PROJECT" -f "$APP_NEW_COMPOSE" -f "$APP_OVERRIDE" config -q
sudo docker compose -p "$APP_PROJECT" -f "$APP_NEW_COMPOSE" -f "$APP_OVERRIDE" up -d --no-deps --no-build astera-app-api
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:8788/health >/tmp/app-health.json 2>/dev/null && curl -fsS --max-time 5 http://127.0.0.1:8788/ready >/tmp/app-ready.json 2>/dev/null; then
    if python3 - <<'PY'
import json
h=json.load(open('/tmp/app-health.json')); r=json.load(open('/tmp/app-ready.json'))
assert h.get('status')=='ok' and r.get('database') is True and r.get('vault') is True
PY
    then break; fi
  fi
  [ "$i" -lt 30 ] || fail APP_READY_AFTER_CUTOVER_FAILED
  sleep 2
done
log "APP_API_LIVE_CUTOVER=PASS"
log "APP_READY_DATABASE_VAULT=PASS"
code="$(curl -sS --max-time 5 -o /tmp/app-auth.json -w '%{http_code}' -X POST http://127.0.0.1:8788/internal/v1/storage-binary/objects/cutover-auth-probe/upload || true)"
[ "$code" = 401 ] || fail APP_STORAGE_AUTH_FAIL_CLOSED_FAILED
log "APP_STORAGE_AUTH_FAIL_CLOSED=PASS"

log ""
log "========== 11. FINAL STATE =========="
sudo docker inspect astera-app-api --format 'APP_NETWORK_MODE={{.HostConfig.NetworkMode}} APP_STATUS={{.State.Status}} APP_RESTARTS={{.RestartCount}}'
sudo docker inspect tgserver-tgs-1 --format 'TGS_NETWORK_MODE={{.HostConfig.NetworkMode}} TGS_STATUS={{.State.Status}} TGS_RESTARTS={{.RestartCount}}'
curl -fsS --max-time 10 http://127.0.0.1:3000/health; echo
curl -fsS --max-time 10 http://127.0.0.1:8788/health; echo
curl -fsS --max-time 10 http://127.0.0.1:8788/ready; echo

cat >"$BACKUP/context.env" <<EOF
STAMP=$STAMP
TGS_PROJECT=$TGS_PROJECT
APP_PROJECT=$APP_PROJECT
TGS_SHA=$TGS_SHA
APP_SHA=$APP_SHA
TGS_ENV_BACKUP=$BACKUP/TGserver.env
APP_ENV_BACKUP=$BACKUP/app-api.env
OLD_TGS_TAG=$OLD_TGS_TAG
OLD_APP_TAG=$OLD_APP_TAG
TGS_OVERRIDE=$TGS_OVERRIDE
APP_OVERRIDE=$APP_OVERRIDE
APP_NEW_COMPOSE=$APP_NEW_COMPOSE
EOF
chmod 600 "$BACKUP/context.env"
trap - ERR
log "OVERALL=LIVE_BACKEND_CUTOVER_PASS"
log "BACKUP_CONTEXT=$BACKUP/context.env"
log "NEXT=LIVE_BACKEND_REAL_E2E"
