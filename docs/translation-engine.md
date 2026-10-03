# Astera Local Multilingual Translation Engine v1

## 1. Purpose

Asteraの「高精度翻訳」Optionを、外部の有料翻訳API・Gemini・OpenAI等へ依存せず、1つの翻訳AIモデルだけで実行する。

Runtime AIは **`google/madlad400-3b-mt` 1モデルだけ**。周辺の品質向上はAIを追加せず、決定論的なSoftware Gateで行う。

- Model: `google/madlad400-3b-mt`
- Pinned upstream revision: `fa184c675da0b5c9e1c8694fccd4e12e2d422094`
- License: Apache-2.0
- Architecture: T5 / encoder-decoder
- Model parameters: 約2.94B
- Model card language metadata: 419 languages
- Runtime: CTranslate2 INT8 CPU
- External translation API calls: **0**
- Runtime network: **loopback only + offline model files**

「世界中のすべての言語」を保証する表現はしない。保証範囲はPinned Modelが持つTarget tokenでRuntime実検証できる言語。Source言語はMADLADの多言語入力能力へ委ね、Targetは`<2xx>` tokenの存在確認を必須にする。

## 2. Why MADLAD-400

### 採用

Google MADLAD-400は、論文で419言語の監査済みCorpusを示し、450超言語を対象にしたMachine Translation Modelを報告している。3B MT checkpointはHugging Face上でApache-2.0として公開されている。

- Paper: https://arxiv.org/abs/2309.04662
- Model: https://huggingface.co/google/madlad400-3b-mt

### 不採用

- NLLB-200: 言語範囲は広いがModel LicenseがCC-BY-NC-4.0。商用Appの標準Runtimeには採用しない。
- OPUS-MT/Marian pair models: 軽量だが多数の言語Pair Modelを必要とし、「1 AI Model」という今回のContractに合わない。
- M2M-100 418M: MITかつ軽量で優秀だが100言語。今回の広域言語Coverage要件ではMADLADを優先する。

M2M-100論文が示す「English pivotへ固定しないMany-to-Many direct translation」は設計思想として採用するが、Runtime ModelはMADLADだけに固定する。

- M2M-100 paper: https://arxiv.org/abs/2010.11125

## 3. Accuracy strategy: one AI model + deterministic Quality Shell

AIを複数段にしない。精度向上は以下の順序で行う。

### A. Target languageを明示

MADLADのTarget token `<2xx>`を入力先頭へ付ける。`ja-JP`等のBCP-47 localeはRuntimeで`ja-jp -> ja`の順に解決し、TokenizerにTarget tokenが存在しない言語はFail-closedにする。

### B. Protected Token Fence

翻訳前に以下をimmutable tokenへ置換する。

- fenced code / inline code
- URL
- email
- template placeholder (`{{...}}`, `${...}`, `<%...%>`)
- UUID
- 数字・日付・Versionに該当するtoken

翻訳後、各tokenが**exactly once**存在しなければ結果を採用しない。URL、ID、数値、Code等を「自然な翻訳」の名目で壊すことを防ぐ。

### C. Document-first translation

最初はSection body全体を1単位としてMADLADへ渡す。MADLAD-400がDocument-level Dataを含む設計である利点を利用し、文脈を保持する。

### D. Structural validation

翻訳後に以下をSourceと比較する。

- line count
- blank line
- heading level
- bullet / ordered list
- quote
- Markdown table pipe count
- protected token exact restoration
- 極端な情報量増減

1つでも壊れた結果はUserへ返さない。

### E. Same-model structured fallback

Document-first resultが構造Gateを通らない場合だけ、**同じMADLADモデル**を再使用する。Markdown prefix・table delimiterをSoftware側で固定し、人間可読部分だけをBatch翻訳する。

これにより「別AIによる修正」を入れず、1モデルContractを保ったままFormatting破壊を抑える。

### F. Terminology / constraint design

Lexically constrained decoding研究は、Model Parameterを変えずに必須語彙をOutputへ強制する考え方が有効であることを示している。

- Post & Vilar 2018: https://arxiv.org/abs/1804.06609
- Hokamp & Liu 2017: https://arxiv.org/abs/1704.07138

v1では、誤ったGlossaryを強制して意味を壊さないよう、まずURL/ID/Code/Number等の「絶対保存対象」をhard constraint相当として保護する。User Glossaryは別途、GlossaryのAuthority・誤登録Recovery・Quality Testが揃った後に追加する。

## 4. Free local runtime

RuntimeはCTranslate2を使用する。

CTranslate2はT5を正式サポートし、CPU INT8 quantizationを正式サポートしている。これにより3B ModelをGPU APIへ送らず、自前CPUで実行できる。

- Transformers/T5 support: https://opennmt.net/CTranslate2/guides/transformers.html
- INT8 quantization: https://opennmt.net/CTranslate2/quantization.html
- CPU performance guidance: https://opennmt.net/CTranslate2/performance.html

Runtime dependencies are pinned:

- CTranslate2 `4.8.2`
- Transformers `4.57.6`
- SentencePiece `0.2.2`

## 5. Supply-chain rules

Model RuntimeはHugging Face `main`を追従しない。

1. Upstream `google/madlad400-3b-mt` revisionを`fa184c...`へ固定。
2. Source snapshotからCTranslate2 INT8へ変換。
3. Source `model.safetensors` SHA-256を記録。
4. Converted `model.bin` SHA-256を記録。
5. `ASTERA_MODEL_MANIFEST.json`を生成。
6. Runtime起動時にModel ID / revision / quantization / model.bin SHA-256を再照合。
7. 不一致ならEngineを起動しない。
8. Runtimeでは`HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1`。

したがってProduction request中にModel Downloadや外部InferenceへFallbackしない。

## 6. Service boundary

`astera-app-api` -> `http://127.0.0.1:8792/v1/translate` -> local MADLAD Engine

Rules:

- bindはloopbackのみ。
- App API側もnon-loopback Translation Originを拒否。
- Bearer internal token必須。
- Model ID / revisionをApp API側でもresponse検証。
- Engineが`external_api_calls != 0`を返したらFail-closed。
- Gemini/Vault Provider callは翻訳経路から削除。

Translation Engineは`docker compose`の`translation` Profileに隔離する。Modelを準備する前に既存App deploymentへ勝手に起動・混入しない。

## 7. Model preparation

Model変換はRuntime Containerでは行わない。別のModel Builderで一度だけ実施し、検証済みDirectoryをread-only mountする。

Builder source:

- `contabo/translation-engine/prepare_model.py`
- `contabo/translation-engine/Dockerfile.model-builder`

変換後に実翻訳Smokeを行い、空Output / `<unk>`破損ならManifestを完成扱いにしない。

## 8. Quality / benchmark gates before activation

Source実装がPASSしても、ModelをServerへ載せただけでProduction完了とはしない。

Activation前に最低限以下を実測する。

1. **Language Contract**: App主要言語 + 低資源言語代表でTarget token解決。
2. **Invariant Suite**: URL / UUID / 数字 / 日付 / code / Markdown / table 100% preservation。
3. **Reference Translation Suite**: FLORES系等の公開Referenceがある言語でchrF++ / SacreBLEUを計測。
4. **Astera Domain Suite**: Astera Result 8項目、Software、契約・料金、一般会話、崩れた文書を人手Reference付きで検証。
5. **Negation/number critical set**: not/no/禁止/以上/以下、金額、割合、期限、Versionを重点検査。
6. **Performance**: cold load、warm latency、tokens/sec、Peak RAM、同時実行時OOMなし。
7. **Failure injection**: Engine停止、timeout、Model hash mismatch、unsupported language、protected token破損でFail-closed。
8. **No external cost proof**: Translation request中のexternal provider call=0。

chrF/BLEUだけを「正確さ」とみなさない。重要な数値・否定・固有tokenの保持と、人手Reference差分を別Gateで持つ。

## 9. Current activation boundary

Source / CIまではこのBranchで進める。

以下は別途Server実測後まで禁止:

- Production merge
- Production deploy
- 既存Gemini translation routeの無検証切替
- Model未準備でTranslation Profileを常時起動
- Benchmark未実施で「全419言語高精度」と宣言

完成判定は「Source PASS」ではなく、**Pinned model preparation + exact runtime health + multilingual quality benchmark + App実E2E**まで揃った時点とする。
