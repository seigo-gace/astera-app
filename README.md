# Astera App — Public Decision Workspace

> Astera v8が生成する判断材料を、利用者が入力・比較・確認・再利用するための公開Web Application。

**個人設計・個人開発：Seigo (`seigo-gace`)**

## このApplicationの役割

Astera Appは、Astera v8の公開Frontendです。

一般的なChat UIを模倣することではなく、長い入力、複数資料、用途指定、8段の判断材料、履歴、再確認を一つの作業画面で扱えるように設計しています。

```text
User
  → Astera App
  → Astera v8 Runtime
  → 8段の判断材料
  → 履歴・比較・コピー・次の作業
```

Frontendは表示だけに閉じず、利用者の作業状態を保持しながら、Backendの責務を奪わない境界として実装しています。

## このプロジェクトで示している開発力

- PC、Tablet、Smartphoneを同じ責務構造で扱うResponsive UI
- 長文入力と長文結果を前提にした画面設計
- Project、履歴、Turn、入力、結果の状態分離
- 複数用途、資料、Template、有料Optionを組み合わせる入力設計
- 8段全体と項目単位の再利用導線
- 日本語／英語、Light／Dark、端末設定追従
- 公開UIとPrivate Backendを分離するAPI境界
- Backend未接続時に偽結果を出さないError Handling
- Cloudflare Pagesで配備できるFrontend構成
- TypeScript CheckとProduction Buildによる検証

## 主な実装済みUI

### Input

- 入力欄の全画面化
- 資料追加
- 任意の用途を複数選択
- Template選択
- 設定で有効化したOptionだけを表示
- 有料Optionの消費予定Credit表示
- 音声入力に依存しないText中心の操作

### Result

- 縦Scroll式のTurn表示
- 8段の判断材料を分離表示
- 回答全体のCopy
- 8段項目ごとのCopy
- 最新結果へのJump
- 右側Turn Navigation

### Workspace

- Astera専用Sidebar
- Project・履歴領域
- Plan・Credit追加・設定・Account
- 「アステラとは？」公式HP導線
- 開発支援、Crowdfunding、出資・事業提携への導線

## UI設計上の原則

### 1. 入力を失わせない

Backendへ接続できない場合も入力内容を保持し、架空のAstera結果を生成せず、接続Errorを明示します。

### 2. 長文を一枚の塊にしない

入力、Turn、8段結果、Navigationを分け、必要な場所へ戻れる構造にしています。

### 3. 表示と処理を混ぜない

Astera Appは利用者との接点を担当し、判断材料の生成RuleはAstera v8側へ残します。

### 4. 機能追加で画面を崩さない

Template、Option、資料、用途を独立した選択要素として扱い、設定されていない機能を常時露出させません。

## Astera全体での位置

```text
Astera App
  └─ 公開UI・入力・履歴・結果・Account導線

Astera v8
  └─ 非生成AI型の判断材料Runtime

Webhook Gateway
  └─ 外部Event受信・検証・配送・復旧
```

App、Runtime、外部連携を別Repositoryに分けることで、それぞれを独立して変更・検証・配備できる構成にしています。

## 公開MCPとの関係

公開準備中のMCPは、Downloadして導入・実行できる公開作品です。

Astera Appは、MCPとは別の開発実績として、**利用者向けUI、状態管理、Backend連携、Error Handling、Cloud Deploymentまでを一つのProductへまとめる能力**を示します。

## Technology

- React
- TypeScript
- Vite
- Radix UI Primitives
- Lucide Icons
- i18next / react-i18next
- Cloudflare Pages

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

## Validation

```bash
npm run check
npm run build
```

検証対象は、TypeScript、Production Build、Responsive表示、主要操作、Backend接続失敗時の挙動です。

## Deployment Model

```text
Browser
  → Cloudflare Pages
  → Configured Backend API
  → Astera v8
```

公開Frontendと処理Backendを分け、FrontendへSecretや中核Ruleを置かない構成です。

## Developer

Astera Appは、画面を作ることだけを目的にしたProjectではありません。

利用者が長い入力と複雑な結果を扱う際に、どこで迷い、何を失い、どの情報へ戻る必要があるかを分解し、UI、状態、通信、Error Handlingの責務へ落とし込んだ個人開発Projectです。
