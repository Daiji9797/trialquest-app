# TrialQuest

## 概要

MBTI 診断結果とユーザーの回答をもとに、AI エージェントが「5 つの大陸」（健康・知識・関係・行動・創造）それぞれの視点からパーソナライズされたクエスト（行動提案）を生成するアプリケーションです。

**本番 URL**: https://witty-field-0bc896100.4.azurestaticapps.net

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│  ブラウザ（React SPA）                                           │
│  GitHub OAuth でログイン → /.auth/me でユーザーID 取得          │
└───────────────────┬─────────────────────────────────────────────┘
                    │ HTTPS（SWA 認証ゲート）
┌───────────────────▼─────────────────────────────────────────────┐
│  Azure Static Web Apps（trialquest-web）                         │
│                                                                  │
│  フロントエンド          SWA Managed Functions (Node 20)         │
│  /  → index.html        /api/questions      → CosmosDB          │
│  /mtbi                  /api/answers        → CosmosDB          │
│  /questions             /api/userProfile/:id→ CosmosDB          │
│  /questions/:id         /api/agentSuggestions → プロキシ ↓      │
│  /login → login.html    /api/health         → OK                │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP + function key
┌───────────────────────────────▼─────────────────────────────────┐
│  Azure Functions（trialquest-functions, Node 20, Japan West）    │
│                                                                  │
│  agentSuggestions                                                │
│  ・大陸 1 つ選択   → callSingleAgent                            │
│                      1. Foundry Agents API でエージェント定義取得        │
│                         （5分キャッシュ）                          │
│                      2. 取得した instructions で Chat Completions  │
│  ・大陸 2 つ以上   → callConductor → council-agent Application   │
│  ・全大陸(0選択)   → callConductor → council-agent Application   │
│  ・2大陸以上のみ   → callConductorSummary → Chat Completions     │
│                      （統合メッセージ 2〜3 文を別途生成）         │
│                                                                  │
│  認証: Managed Identity（APIキー不要）                           │
└───────────────────────────────┬─────────────────────────────────┘
                                │ Managed Identity (Bearer)
┌───────────────────────────────▼─────────────────────────────────┐
│  Azure AI Foundry（trialquestopenai, Japan East）                 │
│  ・5大陸エージェント（各大陸に1つ）                              │
│     health-agent / knowledge-agent / relationship-agent /        │
│     action-agent / creation-agent                                │
│     → Function Appが起動時に instructions を取得（5分キャッシュ）   │
│       プロンプト変更は Foundry ポータルのみで完結                  │
│  ・council-agent Application（マルチエージェント統合）           │
│    └→ 内部で5大陸エージェントを呼び出し統合回答を生成            │
│  ・gpt-4o-mini デプロイメント（Chat Completions）                │
└─────────────────────────────────────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────────────────┐
│  Azure Cosmos DB（trialquest-cosmos）                            │
│  データベース: trialquest-db                                     │
│  コンテナー: userProfile / questions / answers                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 機能一覧

| 機能 | 説明 |
|------|------|
| GitHub OAuth ログイン | SWA 組み込み認証。未認証ユーザーは `/login` にリダイレクト |
| MTBI 診断 | EI / SN / TF / JP の 4 軸をスライダーで入力・保存 |
| MTBI 履歴 | 過去の診断結果を時系列で表示（スクロール対応） |
| 質問一覧・回答 | CosmosDB から質問を取得し、自由記述で回答を保存 |
| 大陸選択 | 5 つの大陸（健康・知識・関係・行動・創造）からクエストを受ける大陸を選択 |
| AI クエスト提案 | 選択大陸数に応じて単一エージェント or コンダクター（マルチエージェント）を切り替え |
| コンダクターサマリー | 複数大陸選択時、提案全体を統合した 2〜3 文のメッセージを生成 |
| 提案ステータス管理 | 各提案に「実施する」「完了」「削除」ボタン。状態は localStorage + CosmosDB に永続化 |
| ユーザーデータ隔離 | GitHub userId を主キーとして使用。別ユーザーのデータは参照不可 |
| 今興味があること | 自由記述でコンテキストを追加し、より関連性の高い提案を取得 |

---

## ディレクトリ構成

```
trialquest-app/
├── frontend/
│   ├── build/                        # ビルド済み成果物（SWA にデプロイ）
│   │   ├── static/
│   │   │   ├── js/
│   │   │   │   └── main.81e5bac6.js  # React アプリ本体（直接編集）
│   │   │   └── css/
│   │   ├── index.html                # SPA エントリーポイント
│   │   ├── login.html                # GitHub ログインページ
│   │   └── staticwebapp.config.json  # SWA ルーティング・認証設定
│   └── src/
│       ├── components/               # React コンポーネント（参照用）
│       └── hooks/                    # カスタムフック（参照用）
│
├── api/                              # SWA Managed Functions（Node 20 / ESM）
│   ├── index.js                      # 全関数エントリーポイント + /api/health
│   ├── host.json                     # Functions ホスト設定
│   ├── package.json                  # type:module, @azure/functions v4
│   ├── agentSuggestions/
│   │   └── index.js                  # External Function App へのプロキシ
│   ├── questions/
│   │   └── index.js                  # GET /api/questions（CosmosDB）
│   ├── answers/
│   │   └── index.js                  # GET/POST /api/answers（CosmosDB）
│   └── userProfile/
│       └── index.js                  # GET/PUT/POST/PATCH /api/userProfile/:id
│
└── _tmp_funcdeploy/                  # External Function App デプロイ資材
    ├── host.json
    └── agentSuggestions/
        ├── function.json             # authLevel: function
        └── index.js                  # AI エージェント呼び出し本体
```

---

## Azure リソース

| リソース | 名前 | 用途 |
|---------|------|------|
| Static Web Apps | trialquest-web | フロントエンド + SWA Managed Functions ホスト |
| Function App | trialquest-functions | AI エージェント呼び出し（Managed Identity 認証） |
| Azure AI Foundry | trialquestopenai | 5大陸エージェント + council-agent Application + gpt-4o-mini |
| Cosmos DB | trialquest-cosmos | ユーザープロファイル・質問・回答の永続化 |
| Resource Group | traialquest | 全リソースをまとめる |

---

## 環境変数（SWA App Settings）

### 使用中

| 変数名 | 用途 |
|--------|------|
| `GITHUB_CLIENT_ID` | GitHub OAuth アプリ Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth アプリ Client Secret |
| `COSMOS_CONNECTION_STRING` | CosmosDB 接続文字列（SWA Managed Functions で使用） |

### 不要（削除推奨）

| 変数名 | 不要な理由 |
|--------|----------|
| `ACTION_AGENT_URL` / `HEALTH_AGENT_URL` / `KNOWLEDGE_AGENT_URL` / `RELATIONSHIP_AGENT_URL` / `CREATION_AGENT_URL` / `COUNCIL_AGENT_URL` | 旧アーキテクチャ（SWA からエージェントを直接呼ぶ方式）の残骸 |
| `AZURE_FOUNDRY_KEY` | Managed Identity 採用後は不要 |
| `AGENT_PROXY_SECRET` | proxy secret 方式廃止後の残骸 |
| `FUNC_AGENT_KEY` | function key 埋め込み方式に移行済み、この変数は未参照 |

## 環境変数（External Function App）

### 使用中（全てデフォルト値あり、未設定でも動作）

| 変数名 | デフォルト値 | 用途 |
|--------|------------|------|
| `OPENAI_ENDPOINT` | `https://trialquestopenai.services.ai.azure.com` | Azure AI Foundry エンドポイント |
| `CHAT_DEPLOYMENT` | `gpt-4o-mini` | Chat Completions デプロイ名（singleAgent + conductorSummary） |
| `FOUNDRY_PROJECT` | `trialquestopenai-project` | AI Foundry プロジェクト名 |
| `FOUNDRY_APP` | `council-agent` | council-agent アプリケーション名（2大陸以上時） |
| `APP_API_VERSION` | `2025-11-15-preview` | council-agent Applications API バージョン |
| `HEALTH_APP` | `health-agent` | 健康大陸エージェント名（Foundry Agents API で定義取得） |
| `KNOWLEDGE_APP` | `knowledge-agent` | 知識大陸エージェント名 |
| `RELATIONSHIP_APP` | `relationship-agent` | 関係大陸エージェント名 |
| `ACTION_APP` | `action-agent` | 行動大陸エージェント名 |
| `CREATION_APP` | `creation-agent` | 創造大陸エージェント名 |
| `IDENTITY_ENDPOINT` / `IDENTITY_HEADER` / `MSI_ENDPOINT` / `MSI_SECRET` | （Azure Functions ランタイムが自動注入） | Managed Identity トークン取得 |

### 不要（削除推奨）

| 変数名 | 不要な理由 |
|--------|----------|
| `ACTION_AGENT_URL` / `HEALTH_AGENT_URL` / `KNOWLEDGE_AGENT_URL` / `RELATIONSHIP_AGENT_URL` / `CREATION_AGENT_URL` | 旧アーキテクチャ（個別エージェント URL 直接呼び出し）の残骸 |
| `ACTION_MODEL` / `HEALTH_MODEL` / `KNOWLEDGE_MODEL` / `RELATIONSHIP_MODEL` / `CREATION_MODEL` / `COUNCIL_MODEL` | コードで一切参照なし |
| `COUNCIL_AGENT_URL` | 旧 SWA 直接呼び出し時の残骸（現在は `FOUNDRY_APP` + デフォルト値で構築） |
| `AZURE_FOUNDRY_KEY` | Managed Identity 採用後は不要 |
| `AGENT_PROXY_SECRET` | proxy secret 方式廃止後の残骸 |
| `COSMOS_CONNECTION_STRING` | Function App は CosmosDB に接続しない |

---

## セキュリティ設計

```
SWA ルート認証
  └── /* → authenticated 必須（未ログインは /login へ）
  └── /api/* → anonymous 許可（function key で保護）

External Function App
  └── authLevel: function（?code= なしは 401）
  └── IP 制限: AllowAll（function key が主防衛ライン）

AI Foundry 認証
  └── Managed Identity（APIキー不要）
  └── SWA App Settings に API キーは不保持
```

---

## デプロイ手順

### SWA（フロントエンド + Managed Functions）

```powershell
$swaToken = az staticwebapp secrets list --name trialquest-web --query "properties.apiKey" -o tsv
npx @azure/static-web-apps-cli deploy ".\frontend\build" --api-location ".\api" `
  --deployment-token $swaToken --env production --api-language node --api-version 20
```

### External Function App

```powershell
Compress-Archive -Path "_tmp_funcdeploy\agentSuggestions","_tmp_funcdeploy\host.json" `
  -DestinationPath "deploy_func.zip" -Force
az functionapp deployment source config-zip `
  --resource-group traialquest --name trialquest-functions --src deploy_func.zip
```
