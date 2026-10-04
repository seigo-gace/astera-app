# Astera Translation Option — AI Core Qwen3 Runtime

## 1. Purpose

Asteraの「高精度翻訳」Optionを、外部翻訳APIや追加の翻訳専用Modelへ依存させず、Serverですでに正式運用しているAI Coreの4モデルから1モデルを固定して実行する。

採用Modelは **Qwen3-8B-Q4_K_M**。

- AI Core Runtime: `/home/admin1/projects/ai-core`
- Router: `http://127.0.0.1:18080`
- Router request model ID: `qwen3//models/Qwen3-8B-Q4_K_M.gguf`
- Current AI Core response model ID: `/models/Qwen3-8B-Q4_K_M.gguf`
- Runtime: llama.cpp + llama-swap
- Quantization: Q4_K_M
- Translation thinking: OFF
- Temperature: 0
- External translation API calls: **0**
- Additional translation model download: **0**

通常AppはBackend portへ直接接続せず、AI Core Routerを利用する。

## 2. Why Qwen3 from the existing four models

AI Coreの正式4モデルは以下。

- Qwen3: 汎用、日本語、通常文章処理
- Granite: 分析、指示処理、構造化寄り
- Ministral: reasoningを使う深い検討
- Qwen2.5 Coder: Code生成・修正・Debug補助

翻訳は「深い推論」や「Code生成」ではなく、入力情報を欠落・追加せず別言語へ写像する通常文章処理であるため、Qwen3を固定採用する。

Granite / Ministral / Coderへの自動Fallbackは行わない。翻訳品質の修復が必要な場合も、同じQwen3を再実行し、Software側の検証条件だけを強化する。

## 3. Runtime boundary

```text
Astera App API
  -> 127.0.0.1:18080/v1/chat/completions
  -> AI Core Router (llama-swap)
  -> qwen3//models/Qwen3-8B-Q4_K_M.gguf
```

Rules:

1. `AI_CORE_BASE_URL`はloopback HTTPだけを許可する。
2. `AI_CORE_API_KEY`を必須にする。
3. Translation Runtime自身がrequest model IDを固定する。
4. `enable_thinking=false`を固定する。
5. Remote providerへのFallbackを持たない。
6. AI Core responseの`model`は、Router request IDまたは実VPSで確認したcanonical backend pathの**Qwen3 exact identityだけ**を許可し、欠落・別modelはFail-closedにする。
7. Qwen3 Backend `18082`へ直接接続せずRouter `18080`を使う。

### Model identity normalization boundary

2026-10-04の実VPS Smokeで、Routerへ`qwen3//models/Qwen3-8B-Q4_K_M.gguf`を指定した正常Requestに対し、AI Core responseの`model`は`/models/Qwen3-8B-Q4_K_M.gguf`を返した。

そのためApp側は「任意のbasename一致」や部分一致には緩めず、次の2値だけを同一Qwen3 identityとして許可する。

```text
qwen3//models/Qwen3-8B-Q4_K_M.gguf
/models/Qwen3-8B-Q4_K_M.gguf
```

空値・Granite・Ministral・Coder・その他Pathは拒否する。

## 4. Deterministic Quality Shell

Qwen3へ本文を渡す前後で、AIではなくSoftware Gateを使って構造を守る。

### Protected Token Fence

翻訳前に以下をimmutable tokenへ置換する。

- fenced code / inline code
- URL
- email
- template placeholder (`{{...}}`, `${...}`, `<%...%>`)
- UUID
- 数字・日付・Version相当token

翻訳後、各tokenがexactly once存在しなければ結果を採用しない。

### Document-first

最初はSection body全体を1単位でQwen3へ渡す。文脈を分断しない。

### Structural validation

翻訳後にSourceと以下を比較する。

- line count
- blank line
- heading level
- bullet / ordered list
- quote
- Markdown table pipe count
- protected token exact restoration
- 極端な情報量増減

### Same-model fallback

Document-first結果が構造Gateを通らない場合だけ、同じQwen3を再実行する。

Fallbackでは、

- exact line count
- line merge禁止
- line split禁止
- structural prefix位置固定

を追加指示する。

別AIへの切替はしない。

## 5. Existing AI Core reuse

今回のTranslation Optionのために新しいModel Containerは追加しない。

従来案にあった独立Translation Engine、Model Builder、Model Weight mount、追加Model常駐は不要。

その結果、

- 既存AI Coreを再利用
- 追加常駐RAMを原則発生させない
- 追加Model download不要
- Router認証・Model管理方式を共通化
- App独自のAI Runtimeを増殖させない

という構造になる。

## 6. Configuration

App API側:

```text
AI_CORE_BASE_URL=http://127.0.0.1:18080
AI_CORE_API_KEY=<server secret>
ASTERA_TRANSLATION_TIMEOUT_MS=90000
```

API KeyはGit・README・Terminal出力・Chatへ記録しない。

## 7. Quality / benchmark gates before activation

Source GateがPASSしてもProduction完成とはしない。

Activation前に最低限以下を実測する。

1. App主要言語 + 低資源言語代表の翻訳成立
2. URL / UUID / 数字 / 日付 / Code / Markdown / tableの100%保持
3. 人手Referenceに対するchrF++ / SacreBLEU
4. 言語Pair別Score
5. 否定・禁止・以上/以下・金額・割合・期限・Versionの重点検査
6. mean / p50 / p95 / max latency
7. warm request時のCPU / RAM
8. AI Core停止・timeout・401・model identity欠落/別model応答時のFail-closed
9. Translation request中の外部Provider call 0

Benchmark helper:

```text
scripts/translation-benchmark.py
scripts/translation-benchmark-requirements.txt
```

BenchmarkもAI Core Router `18080`だけへ接続し、Runtimeと同じQwen3 response identity ruleを使う。

## 8. Runtime evidence

2026-10-04のContabo VPS実測Smoke:

- request: Qwen3 / thinking OFF / temperature 0
- response model: `/models/Qwen3-8B-Q4_K_M.gguf`
- latency: 18,953.33 ms
- prompt tokens: 145
- output tokens: 90
- 日本語→英語翻訳: 成立
- Markdown heading: 保持
- `2026-10-04`: 保持
- `12,500`: 保持
- `95%`: 保持
- `https://asterav8.jp`: 保持
- UUID: 保持
- inline code: 保持

これは**1回のSmoke Evidence**であり、多言語品質・warm p50/p95・同時実行性能・App E2EのPASSへは昇格させない。

## 9. Current activation boundary

このBranchではSource / CI / Server benchmark準備まで進める。

以下はServer実測とApp E2E完了まで禁止:

- Production merge
- Production deploy
- Translation Optionの本番切替
- Benchmark未実施で「高精度」を完成扱い
- 4モデル間の自動Fallback追加

完成判定は、**Qwen3 exact runtime確認 + multilingual quality benchmark + structure invariant PASS + App実E2E**まで揃った時点とする。
