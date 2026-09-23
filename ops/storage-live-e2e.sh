#!/usr/bin/env bash
set -Eeuo pipefail

TGS_LIVE=/home/admin1/projects/TGserver
APP_LIVE=/home/admin1/projects/astera-app
OPS_BRANCH=ops/storage-live-cutover-20260923
CTX_FILE="$(ls -1dt /home/admin1/backups/storage-backend-*/context.env 2>/dev/null | head -1 || true)"
[ -n "$CTX_FILE" ] && [ -f "$CTX_FILE" ] || { echo 'OVERALL=BLOCKED'; echo 'REASON=CUTOVER_CONTEXT_MISSING'; exit 1; }
# shellcheck disable=SC1090
source "$CTX_FILE"
TGS_ENV="$TGS_LIVE/.env"
APP_ENV="$APP_LIVE/contabo/app-api/.env"
TGS_COMPOSE="$TGS_LIVE/docker-compose.yml"
APP_OLD_COMPOSE="$APP_LIVE/docker-compose.yml"
E2E_CTX="/tmp/astera-storage-live-e2e-${STAMP}.json"
E2E_RESULT="/tmp/astera-storage-live-e2e-result-${STAMP}.json"
REDIS_KEY_FILE="/tmp/astera-storage-live-e2e-redis-key-${STAMP}"
RB_TGS="/tmp/astera-storage-rb-tgs-${STAMP}.yml"
RB_APP="/tmp/astera-storage-rb-app-${STAMP}.yml"

rollback(){
  rc=$?
  trap - ERR
  echo ''
  echo '========== AUTOMATIC ROLLBACK =========='
  sudo cp -a "$TGS_ENV_BACKUP" "$TGS_ENV" 2>/dev/null || true
  sudo cp -a "$APP_ENV_BACKUP" "$APP_ENV" 2>/dev/null || true
  cat >"$RB_TGS" <<YAML
services:
  tgs:
    image: ${OLD_TGS_TAG}
YAML
  cat >"$RB_APP" <<YAML
services:
  astera-app-api:
    image: ${OLD_APP_TAG}
YAML
  sudo docker compose -p "$TGS_PROJECT" -f "$TGS_COMPOSE" -f "$RB_TGS" up -d --no-deps --no-build tgs || true
  sudo docker compose -p "$APP_PROJECT" -f "$APP_OLD_COMPOSE" -f "$RB_APP" up -d --no-deps --no-build astera-app-api || true
  sleep 4
  curl -fsS --max-time 10 http://127.0.0.1:3000/health || true; echo
  curl -fsS --max-time 10 http://127.0.0.1:8788/health || true; echo
  echo 'ROLLBACK=ATTEMPTED'
  echo 'OVERALL=LIVE_E2E_FAILED_ROLLED_BACK'
  exit "$rc"
}
trap rollback ERR

curl -fsS --max-time 10 http://127.0.0.1:3000/health >/dev/null
curl -fsS --max-time 10 http://127.0.0.1:8788/ready >/dev/null

echo '========== LIVE BACKEND REAL E2E =========='
python3 - "$APP_ENV" "$STAMP" "$E2E_CTX" "$E2E_RESULT" <<'PY'
import hashlib,json,sys
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError

env={}
for raw in Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    s=raw.strip()
    if s and not s.startswith('#') and '=' in s:
        k,v=s.split('=',1); env[k.strip()]=v.strip().strip('"').strip("'")
stamp=sys.argv[2]; ctx_path=Path(sys.argv[3]); result_path=Path(sys.argv[4])
token=env.get('INTERNAL_SERVICE_TOKEN','')
user='cutover-smoke-'+stamp; obj='cutover-'+stamp
payload=(b'Astera storage live cutover E2E\n'*40000)[:1048576]
sha=hashlib.sha256(payload).hexdigest(); origin='http://127.0.0.1:8788'
refs=None; errors=[]; upload_ok=False; download_ok=False; purge_ok=False

def req(method,path,headers,data=None):
    r=Request(origin+path,data=data,method=method,headers=headers)
    try:
        with urlopen(r,timeout=120) as x: return x.status,x.read()
    except HTTPError as e:
        raise RuntimeError(f'HTTP_{e.code}|'+e.read().decode('utf-8','replace')[:300])

try:
    if not token: raise RuntimeError('INTERNAL_SERVICE_TOKEN_MISSING')
    h={'Authorization':'Bearer '+token,'X-Astera-User-ID':user,'X-Astera-File-Name':'cutover-e2e.bin','X-Astera-File-Size':str(len(payload)),'X-Astera-SHA256':sha,'X-Correlation-ID':'cutover-'+stamp}
    status,raw=req('POST',f'/internal/v1/storage-binary/objects/{obj}/upload',h,payload)
    if status!=201: raise RuntimeError(f'UPLOAD_STATUS_{status}')
    b=(json.loads(raw).get('binary') or {})
    need=['topic_id','message_id','telegram_file_id','checksum_sha256','encryption_profile','dek_wrap_ciphertext','dek_wrap_iv','content_iv_base64','auth_tag_base64']
    miss=[k for k in need if not str(b.get(k,'')).strip()]
    if miss: raise RuntimeError('UPLOAD_REF_MISSING|'+','.join(miss))
    if b['checksum_sha256']!=sha: raise RuntimeError('UPLOAD_SHA_MISMATCH')
    refs=b; upload_ok=True
    ctx_path.write_text(json.dumps({'user':user,'topic_id':int(b['topic_id']),'object_id':obj}),encoding='utf-8')

    dh={'Authorization':'Bearer '+token,'X-Astera-User-ID':user,'X-Astera-Topic-ID':str(b['topic_id']),'X-Astera-Message-ID':str(b['message_id']),'X-Astera-Telegram-File-ID':str(b['telegram_file_id']),'X-Astera-File-Name':'cutover-e2e.bin','X-Astera-Mime-Type':'application/octet-stream','X-Astera-File-Size':str(len(payload)),'X-Astera-SHA256':sha,'X-Astera-Encryption-Profile':str(b['encryption_profile']),'X-Astera-DEK-Wrap-Ciphertext':str(b['dek_wrap_ciphertext']),'X-Astera-DEK-Wrap-IV':str(b['dek_wrap_iv']),'X-Astera-Content-IV-Base64':str(b['content_iv_base64']),'X-Astera-Auth-Tag-Base64':str(b['auth_tag_base64']),'X-Correlation-ID':'cutover-download-'+stamp}
    status,out=req('GET',f'/internal/v1/storage-binary/objects/{obj}/download',dh)
    if status!=200 or out!=payload or hashlib.sha256(out).hexdigest()!=sha: raise RuntimeError('DOWNLOAD_SHA_MISMATCH')
    download_ok=True
except Exception as e:
    errors.append(str(e))
finally:
    if refs:
        try:
            ph={'Authorization':'Bearer '+token,'X-Astera-User-ID':user,'X-Astera-Topic-ID':str(refs['topic_id']),'X-Astera-Message-ID':str(refs['message_id']),'X-Astera-Telegram-File-ID':str(refs['telegram_file_id']),'X-Correlation-ID':'cutover-purge-'+stamp}
            status,_=req('POST',f'/internal/v1/storage-binary/objects/{obj}/purge',ph,b'')
            purge_ok=(status==200)
            if not purge_ok: errors.append(f'PURGE_STATUS_{status}')
        except Exception as e:
            errors.append('PURGE|'+str(e))
result_path.write_text(json.dumps({'pass':upload_ok and download_ok and purge_ok,'upload':upload_ok,'download':download_ok,'purge':purge_ok,'errors':errors}),encoding='utf-8')
print('LIVE_BACKEND_UPLOAD='+('PASS' if upload_ok else 'FAIL'))
print('LIVE_BACKEND_DOWNLOAD_SHA='+('PASS' if download_ok else 'FAIL'))
print('LIVE_BACKEND_PURGE='+('PASS' if purge_ok else 'FAIL'))
PY

echo '========== TEST ARTIFACT CLEANUP =========='
if [ -f "$E2E_CTX" ]; then
python3 - "$TGS_ENV" "$E2E_CTX" "$REDIS_KEY_FILE" <<'PY'
import hashlib,json,sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request,urlopen

env={}
for raw in Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    s=raw.strip()
    if s and not s.startswith('#') and '=' in s:
        k,v=s.split('=',1); env[k.strip()]=v.strip().strip('"').strip("'")
ctx=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
bot=env.get('TELEGRAM_BOT_TOKEN',''); chat=env.get('TELEGRAM_APP_STORAGE_CHAT_ID','')
if not bot or not chat: raise SystemExit('TELEGRAM_CLEANUP_CONFIG_MISSING')
data=urlencode({'chat_id':chat,'message_thread_id':ctx['topic_id']}).encode()
req=Request(f'https://api.telegram.org/bot{bot}/deleteForumTopic',data=data,method='POST')
with urlopen(req,timeout=20) as r: root=json.loads(r.read())
if root.get('ok') is not True: raise SystemExit('TELEGRAM_TOPIC_DELETE_FAILED')
key='tgs:astera-storage:user-topic:'+hashlib.sha256(ctx['user'].encode()).hexdigest()
Path(sys.argv[3]).write_text(key,encoding='utf-8')
print('TELEGRAM_TEST_TOPIC_CLEANUP=PASS')
print('SECRET_VALUES_PRINTED=NO')
PY
  REDIS_CID="$(sudo docker compose -p "$TGS_PROJECT" -f "$TGS_COMPOSE" ps -q redis)"
  [ -n "$REDIS_CID" ]
  MAP_KEY="$(cat "$REDIS_KEY_FILE")"
  DEL="$(sudo docker exec "$REDIS_CID" redis-cli DEL "$MAP_KEY" | tr -d '\r\n')"
  [ "$DEL" = 1 ]
  echo 'REDIS_TEST_MAPPING_CLEANUP=PASS'
fi

python3 - "$E2E_RESULT" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
if not r.get('pass'):
    print('LIVE_BACKEND_REAL_E2E=FAIL')
    print('ERRORS='+'|'.join(r.get('errors') or []))
    raise SystemExit(1)
print('LIVE_BACKEND_REAL_E2E=PASS')
PY

rm -f "$E2E_CTX" "$E2E_RESULT" "$REDIS_KEY_FILE" "$RB_TGS" "$RB_APP"
trap - ERR
if git -C "$APP_LIVE" push origin --delete "$OPS_BRANCH" >/dev/null 2>&1; then echo 'OPS_BRANCH_CLEANUP=PASS'; else echo 'OPS_BRANCH_CLEANUP=SKIPPED'; fi
echo 'TEST_ARTIFACTS_CLEAN=PASS'
echo 'OVERALL=LIVE_BACKEND_E2E_PASS'
echo 'FINAL_AUTHENTICATED_STAGING_STORAGE_E2E=PENDING'
