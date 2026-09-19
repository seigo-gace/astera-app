#!/usr/bin/env python3
"""Print PRESENT/MISSING for configured env key names (no values)."""
from pathlib import Path

ROOT = Path('/home/admin1/projects/astera-billing/.env')
EXPECTED = [
    'SQUARE_LOCATION_ID',
    'SQUARE_ENVIRONMENT',
    'SQUARE_WEBHOOK_NOTIFICATION_URL',
    'BILLING_APP_SECRET',
    'ASTERA_PROJECTION_API_URL',
    'LIBRAL_VAULT_INTERNAL_ORIGIN',
    'LIBRAL_VAULT_INTERNAL_TOKEN',
    'VAULT_SQUARE_ACCESS_SECRET_ID',
    'VAULT_SQUARE_WEBHOOK_HMAC_SECRET_ID',
    'PORT',
]
FORBIDDEN = [
    'SQUARE_ACCESS_TOKEN',
    'WEBHOOK_GATEWAY_APP_SECRET',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
]

present: set[str] = set()
if ROOT.is_file():
    for line in ROOT.read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.strip().startswith('#'):
            key = line.split('=', 1)[0].strip()
            val = line.split('=', 1)[1].strip()
            if val:
                present.add(key)

for key in EXPECTED:
    print(f'{key}:{"PRESENT" if key in present else "MISSING"}')
for key in FORBIDDEN:
    print(f'{key}:{"MISSING" if key not in present else "STILL_PRESENT"}')
