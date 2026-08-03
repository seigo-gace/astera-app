# Deep Link association files — internal template

この文書は開発用です。値が確定する前に `public/.well-known/` へ配置してはいけません。

## Android App Links

必要値：Google Play Release署名証明書のSHA-256 Fingerprint。

配置先：`public/.well-known/assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "jp.asterav8.app",
      "sha256_cert_fingerprints": ["REPLACE_WITH_RELEASE_CERT_SHA256"]
    }
  }
]
```

## iOS Universal Links

必要値：Apple Developer Team ID。

配置先：`public/.well-known/apple-app-site-association`（拡張子なし）

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "REPLACE_WITH_TEAM_ID.jp.asterav8.app",
        "paths": ["/*"]
      }
    ]
  }
}
```

## 公開前Gate

- Placeholderが一つも残っていない。
- HTTPSで認証なし取得できる。
- Content-TypeがJSONとして返る。
- Android Asset Links検証が成功する。
- Apple App Search API Validationが成功する。
- Android実機とiPhone実機で、`https://app.asterav8.jp/...` がAsteraを開く。
