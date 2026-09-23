#!/usr/bin/env bash
set -Eeuo pipefail

TGS_LIVE=/home/admin1/projects/TGserver
APP_LIVE=/home/admin1/projects/astera-app
TGS_ENV="$TGS_LIVE/.env"
APP_ENV="$APP_LIVE/contabo/app-api/.env"
TGS_COMPOSE="$TGS_LIVE/docker-compose.yml"
APP_OLD_COMPOSE="$APP_LIVE/docker-compose.yml"

BUILD_STAMP=20260923-143744
NEW_TGS_IMAGE="astera-tgserver-storage-live:${BUILD_STAMP}"
NEW_APP_IMAGE="astera-app-api-storage-live:${BUILD_STAMP}"
REL="/home/admin1/releases/storage-backend-${BUILD_STAMP}"
APP_NEW_COMPOSE="$REL/astera-app/docker-compose.yml"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/home/admin1/backups/storage-backend-${STAMP}"
OLD_TGS_TAG="astera-tgserver-storage-rollback-flat:${STAMP}"
OLD_APP_TAG="astera-app-api-storage-rollback-flat:${STAMP}"
TGS_OVERRIDE="$REL/tgs-live-flat-${STAMP}.override.yml"
APP_OVERRIDE="$REL/app-live-flat-${STAMP}.override.yml"
TGS_RB_OVERRIDE="$REL/tgs-rollback-flat-${STAMP}.override.yml"
APP_RB_OVERRIDE="$REL/app-rollback-flat-${STAMP}.override.yml"

ARMED=0
TGS_CHANGED=0
APP_CHANGED=0

log(){ printf '%s\n' "$*"; }
fail(){ log "REASON=$1"; return 1; }

[ -f "$TGS_ENV" ] || { echo 'OVERALL=BLOCKED'; echo 'REASON=TGS_ENV_MISSING'; exit 1; }
[ -f "$APP_ENV" ] || { echo 'OVERALL=BLOCKED'; echo 'REASON=APP_ENV_MISSING'; exit 1; }
[ -f "$TGS_COMPOSE" ] || { echo 'OVERALL=BLOCKED'; echo 'REASON=TGS_COMPOSE_MISSING'; exit 1; }
[ -f "$APP_OLD_COMPOSE" ] || { echo 'OVERALL=BLOCKED'; echo 'REASON=APP_OLD_COMPOSE_MISSING'; exit 1; }
[ -f "$APP_NEW_COMPOSE" ] || { echo 'OVERALL=BLOCKED'; echo 'REASON=APP_NEW_COMPOSE_MISSING'; exit 1; }
sudo docker image inspect "$NEW_TGS_IMAGE" >/dev/null 2>&1 || { echo 'OVERALL=BLOCKED'; echo 'REASON=BUILT_TGS_IMAGE_NOT_FOUND'; exit 1; }
sudo docker image inspect "$NEW_APP_IMAGE" >/dev/null 2>&1 || { echo 'OVERALL=BLOCKED'; echo 'REASON=BUILT_APP_IMAGE_NOT_FOUND'; exit 1; }
sudo docker inspect tgserver-tgs-1 >/dev/null 2>&1 || { echo 'OVERALL=BLOCKED'; echo 'REASON=TGS_CONTAINER_MISSING'; exit 1; }
sudo docker inspect astera-app-api >/dev/null 2>&1 || { echo 'OVERALL=BLOCKED'; echo 'REASON=APP_CONTAINER_MISSING'; exit 1; }

TGS_PROJECT="$(sudo docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' tgserver-tgs-1)"
APP_PROJECT="$(sudo docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' astera-app-api)"
[ -n "$TGS_PROJECT" ] || { echo 'OVERALL=BLOCKED'; echo 'REASON=TGS_PROJECT_UNKNOWN'; exit 1; }
[ -n "$APP_PROJECT" ] || { echo 'OVERALL=BLOCKED'; echo 'REASON=APP_PROJECT_UNKNOWN'; exit 1; }

rollback(){
  rc=$?
  trap - ERR
  log ''
  log '========== AUTOMATIC ROLLBACK =========='
  if [ "$ARMED" = 1 ]; then
    sudo cp -a "$BACKUP/TGserver.env" "$TGS_ENV" 2>/dev/null || true
    sudo cp -a "$BACKUP/app-api.env" "$APP_ENV" 2>/dev/null || true

    if [ "$APP_CHANGED" = 1 ]; then
      cat >"$APP_RB_OVERRIDE" <<YAML
services:
  astera-app-api:
    image: ${OLD_APP_TAG}
YAML
      sudo docker compose -p "$APP_PROJECT" -f "$APP_OLD_COMPOSE" -f "$APP_RB_OVERRIDE" up -d --no-deps --no-build astera-app-api || true
    fi

    if [ "$TGS_CHANGED" = 1 ]; then
      cat >"$TGS_RB_OVERRIDE" <<YAML
services:
  tgs:
    image: ${OLD_TGS_TAG}
YAML
      sudo docker compose -p "$TGS_PROJECT" -f "$TGS_COMPOSE" -f "$TGS_RB_OVERRIDE" up -d --no-deps --no-build tgs || true
    fi

    sleep 4
    curl -fsS --max-time 10 http://127.0.0.1:3000/health >/tmp/tgs-rollback-health.json 2>/dev/null || true
    curl -fsS --max-time 10 http://127.0.0.1:8788/health >/tmp/app-rollback-health.json 2>/dev/null || true
    log "ROLLBACK_TGS_CHANGED=$TGS_CHANGED"
    log "ROLLBACK_APP_CHANGED=$APP_CHANGED"
    log 'ROLLBACK=ATTEMPTED'
    log 'OVERALL=FAILED_ROLLED_BACK'
  else
    log 'ROLLBACK=NOT_NEEDED'
    log 'OVERALL=BLOCKED_BEFORE_MUTATION'
  fi
  exit "$rc"
}
trap rollback ERR

flat_snapshot(){
  local container="$1"
  local tag="$2"
  local tarfile="$3"

  local entrypoint cmd workdir user stopsignal
  entrypoint="$(sudo docker inspect -f '{{json .Config.Entrypoint}}' "$container")"
  cmd="$(sudo docker inspect -f '{{json .Config.Cmd}}' "$container")"
  workdir="$(sudo docker inspect -f '{{.Config.WorkingDir}}' "$container")"
  user="$(sudo docker inspect -f '{{.Config.User}}' "$container")"
  stopsignal="$(sudo docker inspect -f '{{.Config.StopSignal}}' "$container")"

  sudo docker export -o "$tarfile" "$container"

  local -a changes
  changes=(--change 'ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin')

  local safe_env
  safe_env="$(sudo docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$container" | grep -E '^(NODE_ENV|NODE_VERSION|YARN_VERSION)=' || true)"
  while IFS= read -r line; do
    [ -n "$line" ] && changes+=(--change "ENV $line")
  done <<<"$safe_env"

  [ -n "$workdir" ] && changes+=(--change "WORKDIR $workdir")
  [ -n "$user" ] && changes+=(--change "USER $user")
  [ -n "$stopsignal" ] && changes+=(--change "STOPSIGNAL $stopsignal")
  [ "$entrypoint" != "null" ] && [ "$entrypoint" != "[]" ] && changes+=(--change "ENTRYPOINT $entrypoint")
  [ "$cmd" != "null" ] && [ "$cmd" != "[]" ] && changes+=(--change "CMD $cmd")

  sudo docker import "${changes[@]}" "$tarfile" "$tag" >/dev/null
  sudo rm -f "$tarfile"
  sudo docker image inspect "$tag" >/dev/null

  sudo docker run --rm --entrypoint /bin/sh "$tag" -c 'command -v node >/dev/null 2>&1 && node --version >/dev/null 2>&1'
}

log '============================================================'
log ' ASTERA STORAGE BACKEND LIVE CUTOVER - FLAT ROLLBACK'
log '============================================================'
log "REUSED_TGS_IMAGE=$NEW_TGS_IMAGE"
log "REUSED_APP_IMAGE=$NEW_APP_IMAGE"
log "REUSED_RELEASE=$REL"

log ''
log '========== 6. FLAT ROLLBACK SNAPSHOT =========='
mkdir -p "$BACKUP"
sudo cp -a "$TGS_ENV" "$BACKUP/TGserver.env"
sudo cp -a "$APP_ENV" "$BACKUP/app-api.env"
sudo docker inspect tgserver-tgs-1 >"$BACKUP/tgserver-container-inspect.json"
sudo docker inspect astera-app-api >"$BACKUP/app-container-inspect.json"
flat_snapshot tgserver-tgs-1 "$OLD_TGS_TAG" "$BACKUP/tgserver-rootfs.tar"
flat_snapshot astera-app-api "$OLD_APP_TAG" "$BACKUP/app-rootfs.tar"
ARMED=1
log 'TGS_FLAT_ROLLBACK_IMAGE=PASS'
log 'APP_FLAT_ROLLBACK_IMAGE=PASS'
log 'ROLLBACK_SNAPSHOT=PASS|MODE=EXPORT_IMPORT_INDEPENDENT_ROOTFS'

log ''
log '========== 7. STORAGE SECRET CONTRACT =========='
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
    mode=stat.S_IMODE(path.stat().st_mode)
    tmp=path.with_name(path.name+'.cutover.tmp')
    tmp.write_text('\n'.join(out)+'\n',encoding='utf-8')
    os.chmod(tmp,mode)
    os.replace(tmp,path)

tgs_path=Path(sys.argv[1]); app_path=Path(sys.argv[2]); _,tgs=load(tgs_path)
if tgs.get('TELEGRAM_APP_STORAGE_CHAT_ID','').strip() != '-1003934977314':
    print('TGS_STORAGE_CHAT_GATE=FAIL'); raise SystemExit(31)
token=tgs.get('TGS_STORAGE_INTERNAL_TOKEN','').strip()
if not token or token.startswith('REPLACE_'):
    token=secrets.token_urlsafe(48)
    update(tgs_path,{'TGS_STORAGE_INTERNAL_TOKEN':token})
    print('TGS_STORAGE_TOKEN=GENERATED')
else:
    print('TGS_STORAGE_TOKEN=REUSED')
update(app_path,{
    'TGS_STORAGE_INTERNAL_ORIGIN':'http://127.0.0.1:3000',
    'TGS_STORAGE_INTERNAL_TOKEN':token,
    'TGS_STORAGE_TIMEOUT_MS':'600000'
})
print('TGS_STORAGE_CHAT_GATE=PASS')
print('APP_TGS_SECRET_SYNC=PASS')
print('SECRET_VALUES_PRINTED=NO')
PY

log ''
log '========== 8. VAULT KEY REAL PROBE =========='
python3 - "$APP_ENV" <<'PY'
import base64,json,stat,sys
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
        if line.strip().startswith('LIBRAL_VAULT_JOB_KEY_REF='):
            out.append('LIBRAL_VAULT_JOB_KEY_REF='+ref); found=True
        else:
            out.append(line)
    if not found: out.append('LIBRAL_VAULT_JOB_KEY_REF='+ref)
    mode=stat.S_IMODE(p.stat().st_mode)
    t=p.with_name(p.name+'.vault.tmp')
    t.write_text('\n'.join(out)+'\n',encoding='utf-8')
    t.chmod(mode)
    t.replace(p)

e=env()
origin=e.get('LIBRAL_VAULT_INTERNAL_ORIGIN','').rstrip('/')
token=e.get('LIBRAL_VAULT_INTERNAL_TOKEN','')
current=e.get('LIBRAL_VAULT_JOB_KEY_REF','')

def call(path,data):
    try:
        req=Request(origin+path,data=json.dumps(data).encode(),method='POST',
                    headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        with urlopen(req,timeout=8) as r:
            return json.loads(r.read())
    except Exception:
        return None

def test(ref):
    plain=b'astera-storage-key-probe'
    s=call('/internal/v1/crypto/seal',{
        'key_ref':ref,'consumer':'astera-app-runtime',
        'plaintext_base64':base64.b64encode(plain).decode()
    })
    if not s or not s.get('ciphertext') or not s.get('iv'): return False
    u=call('/internal/v1/crypto/unseal',{
        'key_ref':ref,'consumer':'astera-app-runtime',
        'ciphertext':s['ciphertext'],'iv':s['iv']
    })
    try:
        return bool(u and base64.b64decode(u['plaintext_base64'])==plain)
    except Exception:
        return False

if not origin or not token or not current:
    print('VAULT_KEY_REF_GATE=FAIL|CONFIG'); raise SystemExit(41)
if test(current):
    print('VAULT_KEY_REF_GATE=PASS_CURRENT')
elif current=='local-job-key-ref' and test('astera-storage-wrap-key-v1'):
    setref('astera-storage-wrap-key-v1')
    print('VAULT_KEY_REF_GATE=PASS_SWITCHED_FROM_PLACEHOLDER')
else:
    print('VAULT_KEY_REF_GATE=FAIL|UNUSABLE'); raise SystemExit(42)
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

log ''
log '========== 9. CUTOVER TGserver 3000 =========='
sudo docker compose -p "$TGS_PROJECT" -f "$TGS_COMPOSE" -f "$TGS_OVERRIDE" config -q
TGS_CHANGED=1
sudo docker compose -p "$TGS_PROJECT" -f "$TGS_COMPOSE" -f "$TGS_OVERRIDE" up -d --no-deps --no-build tgs
for i in $(seq 1 30); do
  body="$(curl -fsS --max-time 5 http://127.0.0.1:3000/health 2>/dev/null || true)"
  if python3 -c 'import json,sys;x=json.loads(sys.stdin.read());sys.exit(0 if x.get("status")=="ok" and x.get("user_storage")=="configured" and "bot-chunk" in str(x.get("version","")) else 1)' <<<"$body" 2>/dev/null; then
    break
  fi
  [ "$i" -lt 30 ] || fail TGS_HEALTH_AFTER_CUTOVER_FAILED
  sleep 2
done
log 'TGS_LIVE_CUTOVER=PASS'
code="$(curl -sS --max-time 5 -o /tmp/tgs-auth.json -w '%{http_code}' http://127.0.0.1:3000/internal/storage/users/cutover-auth-probe/topic || true)"
[ "$code" = 401 ] || fail TGS_AUTH_FAIL_CLOSED_FAILED
log 'TGS_AUTH_FAIL_CLOSED=PASS'

log ''
log '========== 10. CUTOVER App API 8788 =========='
sudo docker compose -p "$APP_PROJECT" -f "$APP_NEW_COMPOSE" -f "$APP_OVERRIDE" config -q
APP_CHANGED=1
sudo docker compose -p "$APP_PROJECT" -f "$APP_NEW_COMPOSE" -f "$APP_OVERRIDE" up -d --no-deps --no-build astera-app-api
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:8788/health >/tmp/app-health.json 2>/dev/null && \
     curl -fsS --max-time 5 http://127.0.0.1:8788/ready >/tmp/app-ready.json 2>/dev/null; then
    if python3 - <<'PY'
import json
h=json.load(open('/tmp/app-health.json'))
r=json.load(open('/tmp/app-ready.json'))
assert h.get('status')=='ok' and r.get('database') is True and r.get('vault') is True
PY
    then
      break
    fi
  fi
  [ "$i" -lt 30 ] || fail APP_READY_AFTER_CUTOVER_FAILED
  sleep 2
done
log 'APP_API_LIVE_CUTOVER=PASS'
log 'APP_READY_DATABASE_VAULT=PASS'
code="$(curl -sS --max-time 5 -o /tmp/app-auth.json -w '%{http_code}' -X POST http://127.0.0.1:8788/internal/v1/storage-binary/objects/cutover-auth-probe/upload || true)"
[ "$code" = 401 ] || fail APP_STORAGE_AUTH_FAIL_CLOSED_FAILED
log 'APP_STORAGE_AUTH_FAIL_CLOSED=PASS'

log ''
log '========== 11. FINAL STATE =========='
sudo docker inspect astera-app-api --format 'APP_NETWORK_MODE={{.HostConfig.NetworkMode}} APP_STATUS={{.State.Status}} APP_RESTARTS={{.RestartCount}}'
sudo docker inspect tgserver-tgs-1 --format 'TGS_NETWORK_MODE={{.HostConfig.NetworkMode}} TGS_STATUS={{.State.Status}} TGS_RESTARTS={{.RestartCount}}'

cat >"$BACKUP/context.env" <<EOF
STAMP=$STAMP
TGS_ENV_BACKUP=$BACKUP/TGserver.env
APP_ENV_BACKUP=$BACKUP/app-api.env
OLD_TGS_TAG=$OLD_TGS_TAG
OLD_APP_TAG=$OLD_APP_TAG
TGS_PROJECT=$TGS_PROJECT
APP_PROJECT=$APP_PROJECT
EOF
chmod 600 "$BACKUP/context.env"

trap - ERR
log "CUTOVER_CONTEXT=$BACKUP/context.env"
log 'OVERALL=LIVE_BACKEND_CUTOVER_PASS'
