# Astera Translation Option — AI Core Qwen3 + Granite Validation Runtime

## 1. Purpose

Asteraの「高精度翻訳」Optionを、外部翻訳APIや追加の翻訳専用Modelへ依存させず、Serverですでに正式配置されているAI Coreを再利用して実行する。

役割は固定する。

- **Qwen3-8B-Q4_K_M**: 翻訳と独立Semantic Record生成
- **Granite 4.2 8B Q4_K_M**: 翻訳結果の意味同等性判定だけ
- Graniteは翻訳Fallbackではない
- Ministral / CoderはTranslation Runtimeから使用しない

共通条件:

- AI Core Runtime: `/home/admin1/projects/ai-core`
- Router: `http://127.0.0.1:18080`
- Qwen request model: `qwen3//models/Qwen3-8B-Q4_K_M.gguf`
- Qwen canonical response model: `/models/Qwen3-8B-Q4_K_M.gguf`
- Granite request model: `granite//models/granite-4.2-8b-Q4_K_M.gguf`
- Granite canonical response model: `/models/granite-4.2-8b-Q4_K_M.gguf`
- Runtime: llama.cpp + llama-swap
- `temperature=0`
- `enable_thinking=false`
- External translation API calls: **0**
- Additional translation model download: **0**

AppはBackend portへ直接接続せず、AI Core Routerだけを利用する。

## 2. Why the design is no longer Qwen-only

Qwen3単体Smokeでは主要言語の多くは翻訳できたが、次の2種類の失敗を確認した。

1. 日付・通貨などのCritical Tokenを自然な現地表記へ変換する
2. 低資源言語で、表面上は翻訳文でも原文の意味そのものが崩れる

1はSoftware側のimmutable token化で防げる。2は文字列比較や構造検査では検出できないため、翻訳担当とは別責務の意味検査が必要になる。

そのため、Qwen3は翻訳担当のまま維持し、既存AI CoreのGraniteを**英語Semantic Record同士の独立比較器**として使う。Graniteが原言語を直接理解できることには依存しない。

## 3. Runtime boundary

```text
Astera App API
  -> 127.0.0.1:18080/v1/chat/completions
  -> AI Core Router

Translation path:
  Qwen3 -> translated batch

Semantic validation path:
  ORIGINAL batch -> Qwen3 -> English semantic record A
  translated batch -> Qwen3 -> English semantic record B
  A + B -> Granite -> equivalence verdict
```

Rules:

1. `AI_CORE_BASE_URL`はloopback HTTPだけを許可する。
2. `AI_CORE_API_KEY`を必須にする。
3. Translation Runtime自身がQwen/Graniteのrequest model IDを固定する。
4. 全Requestで`temperature=0`、`enable_thinking=false`を固定する。
5. Remote providerへのFallbackを持たない。
6. Qwen callはQwen exact identityだけ、Granite callはGranite exact identityだけを受理する。
7. identity欠落・cross-model response・未知PathはFail-closedにする。
8. Backendへ直接接続せずRouter `18080`を使う。

## 4. Whole-result batching

旧構造はAsteraの各Sectionを個別にQwenへ直列送信していた。新構造では翻訳対象Sectionを1つのBatchへまとめる。

各Sectionを以下のimmutable markerで分離する。

```text
__ASTERA_SECTION_000000_BEGIN__
...
__ASTERA_SECTION_000000_END__
```

全markerはexactly once・順序固定。余分なprefix/suffix、欠落、重複、入替を拒否する。

これにより、Asteraの複数Section間の文脈を保持しつつ、通常翻訳callを1回へ集約する。空Sectionは翻訳対象から除外して元値を維持する。

## 5. Deterministic Quality Shell

### Protected Token Fence

翻訳前に以下を`__ASTERA_PROTECTED_XXXXXX__`へ置換する。

- fenced code / inline code
- URL
- email
- template placeholder (`{{...}}`, `${...}`, `<%...%>`)
- UUID
- semantic version (`v8.4.1`等)
- ISO / slash / dot形式の日付
- 通貨記号付き金額
- `USD / EUR / GBP / JPY`付き金額
- percentage
- その他数値token

翻訳後、各tokenがexactly once存在しなければ採用しない。復元時は原文のexact valueへ戻す。

### Structural validation

Sectionごとに以下を比較する。

- section count / marker order
- line count
- blank line
- heading level
- bullet / ordered list
- quote
- Markdown table pipe count
- protected token exact restoration
- 極端な情報量増減

### Structural fallback

Document strategyが構造Gateを通らない場合だけ、**同じQwen3・同じOriginal batch**を`lines` strategyで1回再実行する。

別Modelへの翻訳切替は行わない。

## 6. Independent Semantic Validation

構造が正しくても意味が壊れる可能性があるため、候補訳を採用する前にSemantic Gateを通す。

### Step A — Original semantic record

Qwen3へOriginal batchだけを渡し、英語JSONのSemantic Recordを生成する。

Record対象:

- claims
- constraints / commands / prohibitions
- conditions / exceptions
- entities
- quantities / deadlines / comparisons
- uncertainties

### Step B — Candidate semantic record

別RequestでQwen3へ候補訳だけを渡し、同じSchemaの英語Semantic Recordを生成する。

OriginalとCandidateを同一Requestへ同時に見せない。これにより、Record生成時に互いへ寄せるbiasを減らす。

### Step C — Granite equivalence verdict

Graniteには原文や翻訳文を直接渡さず、英語Semantic Record A/Bだけを渡す。

Pass条件は全て必須。

```text
equivalent = true
score >= 0.98
critical_differences = []
```

重点差分:

- 否定 / 禁止
- must / should / may等の強度
- only / unless / if等の条件
- 以上 / 以下 / 比較
- 金額 / 数量 / 割合 / 期限
- Entity
- Safety constraint
- 情報の追加 / 欠落

## 7. Semantic retry and fail-closed

最初のSemantic GateがFAILした場合、候補訳そのものは修正材料として再利用しない。

1. Graniteのcritical differencesをCorrection Guidanceへ変換
2. **Original batchから**Qwen3で再翻訳
3. 再翻訳candidateだけから新しいSemantic Recordを生成
4. Original Recordと新Candidate RecordをGraniteで再比較
5. 2回目もFAILなら`TRANSLATION_SEMANTIC_EQUIVALENCE_FAILED`でFail-closed

意味が未確認の翻訳をUser結果として採用しない。

## 8. Call model

正常経路ではAstera result全体につきAI Core callは4回。

1. Qwen translation batch
2. Qwen Original semantic record
3. Qwen Candidate semantic record
4. Granite equivalence verdict

構造Fallback時は+1 Qwen translation call。
Semantic retry時は、再翻訳 + Candidate semantic record + Granite verdictの+3 call。

これはSource上の構造であり、総latencyはServer実測前には確定しない。旧方式のように各Sectionごとに翻訳callを繰り返さないため、Section数に比例するtranslation call増加は除去している。

## 9. Configuration

```text
AI_CORE_BASE_URL=http://127.0.0.1:18080
AI_CORE_API_KEY=<server secret>
ASTERA_TRANSLATION_TIMEOUT_MS=90000
```

API KeyはGit・README・Terminal出力・Chatへ記録しない。

## 10. Runtime evidence

### 10.1 Initial single smoke

2026-10-04のContabo VPS実測:

- Qwen response model: `/models/Qwen3-8B-Q4_K_M.gguf`
- latency: `18,953.33 ms`
- 日本語→英語成立
- Markdown / date / number / percentage / URL / UUID / inline code保持

これは1回のSmokeだけで、多言語品質や性能GateのPASSではない。

### 10.2 Qwen3 raw multilingual smoke

`AI_CORE_QWEN3_MULTILINGUAL_SMOKE`として7件を実測した。

- ja / zh-CN / ko / ar / de / sw / ja
- model identity: PASS
- latency mean: `6,913.68 ms`
- p50: `6,614.48 ms`
- p95 / max: `9,912.12 ms`
- Critical Token Retention: **FAIL**
- Japanese case: date表記が変化
- Arabic case: money/date表記が変化
- Swahili case: literal tokenは保持したが意味品質が不十分

このSmokeは**raw Qwen request**であり、Protected Token Fence / Whole-result batching / Semantic Gateを通した製品結果ではない。

結論は「Qwen3単体で完成」ではなく、Deterministic Fenceと独立Semantic Gateが必要、である。

## 11. Quality gates before activation

Production activation前に最低限以下を実測する。

1. 主要言語 + 低資源言語 + script差が大きい言語のmatrix
2. URL / UUID / code / number / date / money / percentage / versionの100%保持
3. 否定・禁止・条件・例外・比較・期限・数量のadversarial semantic cases
4. Semantic Gateが意図的な誤訳をrejectできること
5. Semantic retryがOriginalから実行されること
6. 2回目Semantic FAILでFail-closedすること
7. Qwen / Granite exact model identity
8. chrF++ / SacreBLEU等のreference metric（Referenceを用意できる言語pair）
9. 言語pair別の人手確認
10. mean / p50 / p95 / max end-to-end latency
11. warm request時CPU / RAM
12. AI Core停止・timeout・401時のFail-closed
13. Translation request中のexternal provider call = 0
14. App E2EでTranslation Optionの実投稿→結果表示まで成立

Benchmark helper:

```text
scripts/translation-benchmark.py
scripts/translation-benchmark-requirements.txt
```

既存Benchmarkはraw Qwen性能測定として残す。新Semantic Pipelineの完成判定はApp Runtime統合Smoke/E2Eを別途必要とする。

## 12. Source responsibility

- `translation-ai-core.ts`: Router接続、認証、model identity、AI Core transport
- `translation-quality.ts`: immutable token、section batch、structure gate
- `translation-semantic.ts`: Semantic Record / Granite verdict
- `translation-runtime.ts`: Astera resultの収集、翻訳、検証、retry、usage集計
- `translation-runtime.test.ts`: Runtime contract回帰

責務を分離し、AI transport・決定論Gate・意味判定・Orchestrationを1ファイルへ混在させない。

## 13. Current activation boundary

このBranchはDraftの検証中Sourceである。

禁止:

- Production merge
- Production deploy
- Translation Optionの本番切替
- raw Qwen Smokeだけで「高精度」「全言語対応」を完成扱い
- Semantic Gate未実測でGranite validatorを完成扱い
- 未確認のModel fallback追加

完成判定は、**Source/CI PASS + 実VPSでQwen/Granite統合Pipeline PASS + multilingual/adversarial quality matrix + performance measurement + App E2E**が揃った時点とする。
