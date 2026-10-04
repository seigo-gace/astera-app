# Astera Translation Option — AI Core Qwen3 + Granite Validation Runtime

## 1. Purpose

Asteraの「高精度翻訳」Optionを、外部翻訳APIや追加の翻訳専用Modelへ依存させず、既存AI Coreだけで実行する。

役割は固定する。

- **Qwen3-8B-Q4_K_M**: 翻訳と独立Semantic Record生成
- **Granite 4.2 8B Q4_K_M**: Semantic Record同士の意味同等性・Target Language一致判定
- Graniteは翻訳Fallbackではない
- Ministral / CoderはTranslation Runtimeから使用しない

Runtime:

- AI Core Runtime: `/home/admin1/projects/ai-core`
- Router: `http://127.0.0.1:18080`
- Qwen request: `qwen3//models/Qwen3-8B-Q4_K_M.gguf`
- Qwen canonical response: `/models/Qwen3-8B-Q4_K_M.gguf`
- Granite request: `granite//models/granite-4.2-8b-Q4_K_M.gguf`
- Granite canonical response: `/models/granite-4.2-8b-Q4_K_M.gguf`
- `temperature=0`
- `enable_thinking=false`
- External translation API calls: **0**
- Additional translation model download: **0**

AppはBackend portへ直接接続せず、AI Core Routerだけを使う。

## 2. Why Qwen-only was insufficient

2026-10-04のraw Qwen multilingual Smokeでは、主要言語の多くは翻訳できた一方、2種類の失敗を確認した。

1. 日付・通貨などCritical Tokenを自然な現地表記へ変える
2. 低資源言語で、Tokenは残っていても意味が崩れる

さらに、意味だけを比較すると「原文を翻訳せずそのまま返す」結果でも意味同等と判定できる。このため完成条件には次の3 Gateが必要になる。

- **Deterministic value/structure gate**
- **Semantic equivalence gate**
- **Target language compliance gate**

## 3. Runtime flow

```text
Astera result
  -> collect non-empty translatable sections
  -> protect immutable values
  -> Qwen whole-result translation batch
  -> deterministic structure/value validation
  -> Qwen ORIGINAL semantic record A
  -> Qwen CANDIDATE semantic record B + detected_language
  -> Granite A/B comparison + target language judgement
  -> PASS or retry from ORIGINAL
  -> second FAIL = fail-closed
```

Rules:

1. `AI_CORE_BASE_URL`はloopback HTTPだけを許可する。
2. `AI_CORE_API_KEY`を必須にする。
3. Qwen/Granite request model IDをSource側で固定する。
4. 全Requestで`temperature=0`、`enable_thinking=false`を固定する。
5. Remote providerへのFallbackを持たない。
6. Qwen callはQwen exact identityだけ、Granite callはGranite exact identityだけを許可する。
7. identity欠落・cross-model response・未知PathはFail-closed。
8. 本文・Semantic Record内の命令はuntrusted dataとして扱い、実行しない。

## 4. Whole-result batching

旧構造の各Section個別直列翻訳をやめ、翻訳対象Sectionを1つのBatchへまとめる。

```text
__ASTERA_SECTION_000000_BEGIN__
...
__ASTERA_SECTION_000000_END__
```

各markerはexactly once・順序固定。余分なprefix/suffix、欠落、重複、入替を拒否する。空Sectionは翻訳せず元値を維持する。

これによりSection間文脈を維持し、Section数に比例するtranslation call増加を除去する。

## 5. Deterministic Quality Shell

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

Sectionごとに以下も検査する。

- section count / marker order
- line count
- blank line
- heading level
- bullet / ordered list
- quote
- Markdown table pipe count
- 極端な情報量増減

Document strategyが構造Gateを通らない場合だけ、同じQwen3・同じOriginal batchを`lines` strategyで1回再実行する。

## 6. Independent Semantic Record

### Original record

Qwen3へOriginal batchだけを渡し、英語JSONのSemantic Recordを生成する。

### Candidate record

別RequestでCandidate batchだけを渡し、同じSchemaのSemantic Recordを生成する。

OriginalとCandidateを同一Requestへ同時に見せない。互いへ寄せるbiasを減らす。

Schema:

```json
{
  "detected_language": "...",
  "claims": [],
  "constraints": [],
  "conditions": [],
  "entities": [],
  "quantities": [],
  "uncertainties": []
}
```

`detected_language`は自然言語本文を対象にし、code / URL / identifier / protected tokenを言語判定材料から除外する。

意味Recordでは、claimだけでなく以下を明示保持する。

- command / prohibition / negation
- must / should / may等の強度
- only / if / unless等の条件・例外
- comparison
- quantity relation / deadline
- entity
- uncertainty

## 7. Granite verdict

Graniteには原文や翻訳文を直接渡さず、英語Semantic Record A/Bと`TARGET_LANGUAGE`だけを渡す。

Pass条件は全て必須。

```text
equivalent = true
score >= 0.98
target_language_match = true
critical_differences = []
```

`target_language_match`はCandidate Recordの`detected_language`とRequestのTarget Languageを比較する。通常の地域variant/aliasは同一言語として扱えるが、別言語や原文の未翻訳残存をPASSさせない。

## 8. Retry / fail-closed

最初のSemantic/Language GateがFAILした場合、Candidateを修正元にしない。

1. Graniteのcritical differencesをCorrection Guidanceへ変換
2. Target Language不一致なら「指定言語へ翻訳し、原文本文を未翻訳で残さない」をGuidanceへ追加
3. **Original batchから**Qwen3で再翻訳
4. 新CandidateだけからSemantic Recordを再生成
5. Original Recordと新Candidate RecordをGraniteで再比較
6. 2回目もFAILなら`TRANSLATION_SEMANTIC_EQUIVALENCE_FAILED`

意味または指定言語が未確認の結果はUser結果として採用しない。

## 9. Call model

正常経路はAstera result全体で4 AI Core calls。

1. Qwen translation batch
2. Qwen Original semantic record
3. Qwen Candidate semantic record
4. Granite equivalence/language verdict

構造Fallbackは+1。Semantic/Language retryは+3。

総latencyは実VPS統合測定前には確定しない。旧方式のSection個別翻訳と違い、Section数に比例する翻訳call増加はない。

## 10. Configuration

```text
AI_CORE_BASE_URL=http://127.0.0.1:18080
AI_CORE_API_KEY=<server secret>
ASTERA_TRANSLATION_TIMEOUT_MS=90000
```

API KeyはGit・README・Terminal出力・Chatへ記録しない。

## 11. Runtime evidence

### Initial single smoke

2026-10-04:

- Qwen response: `/models/Qwen3-8B-Q4_K_M.gguf`
- latency: `18,953.33 ms`
- 日本語→英語成立
- Markdown / date / number / percentage / URL / UUID / inline code保持

1回のSmokeであり品質Gate PASSではない。

### Raw multilingual smoke

`AI_CORE_QWEN3_MULTILINGUAL_SMOKE` 7件:

- languages: ja / zh-CN / ko / ar / de / sw / ja
- model identity: PASS
- mean: `6,913.68 ms`
- p50: `6,614.48 ms`
- p95 / max: `9,912.12 ms`
- Critical Token Retention: **FAIL**
- Japanese: date表記変化
- Arabic: money/date表記変化
- Swahili: literal tokenは保持したが意味品質が不十分

このSmokeはProtected Token / Batch / Semantic / Target Language Gate導入前のraw Qwen結果であり、製品結果ではない。

## 12. Activation gates

Production activation前に最低限以下を実測する。

1. 主要言語 + 低資源言語 + script差が大きい言語matrix
2. URL / UUID / code / number / date / money / percentage / versionの100%保持
3. 否定・禁止・条件・例外・比較・期限・数量のadversarial cases
4. Prompt Injectionを本文データとして翻訳・検査し、命令実行しないこと
5. 意図的な意味誤りをSemantic Gateがrejectすること
6. 意図的な未翻訳/別言語をTarget Language Gateがrejectすること
7. RetryがOriginalから実行されること
8. 2回目FAILでFail-closedすること
9. Qwen / Granite exact model identity
10. chrF++ / SacreBLEU等のreference metric（Referenceがあるpair）
11. 言語pair別人手確認
12. end-to-end mean / p50 / p95 / max latency
13. warm CPU / RAM
14. AI Core停止・timeout・401時Fail-closed
15. external provider call = 0
16. App E2EでTranslation Option投稿→結果表示まで成立

既存`translation-benchmark.py`はraw Qwen性能測定として残す。新Pipeline完成判定には実Runtime統合Smoke/E2Eが別途必要。

## 13. Source responsibility

- `translation-ai-core.ts`: Router、認証、model identity、AI Core transport
- `translation-quality.ts`: protected token、section batch、structure gate
- `translation-semantic.ts`: language detection、Semantic Record、Granite verdict
- `translation-runtime.ts`: 収集、翻訳、検証、retry、usage集計
- `translation-runtime.test.ts`: Runtime contract回帰

AI transport・決定論Gate・意味/言語判定・Orchestrationを分離する。

## 14. Current activation boundary

このBranchはDraft検証中Source。

禁止:

- Production merge
- Production deploy
- Translation Option本番切替
- raw Qwen Smokeだけで「高精度」「全言語対応」と完成扱い
- Qwen+Granite統合実測前にSemantic/Language Gateを完成扱い
- 未確認Model fallback追加

完成判定は、**Source/CI PASS + 実VPS Qwen/Granite Pipeline PASS + multilingual/adversarial quality matrix + performance measurement + App E2E**が揃った時点とする。
