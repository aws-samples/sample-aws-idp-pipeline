<h1 align="center">Quick Deploy Guide</h1>

<p align="center">
  <strong>CloudShell + CodeBuildによるワンクリックデプロイ</strong>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/AWS-CloudShell-FF9900?logo=amazonaws&logoColor=white" alt="CloudShell">
  <img src="https://img.shields.io/badge/AWS-CodeBuild-FF9900?logo=amazonaws&logoColor=white" alt="CodeBuild">
  <img src="https://img.shields.io/badge/Time-40--60_min-blue" alt="Deploy Time">
</p>

<p align="center">
  <a href="DEPLOYMENT_en.md">English</a> | <a href="DEPLOYMENT_ko.md">한국어</a> | <strong>日本語</strong>
</p>

---

## 概要

AWS CloudShellで単一スクリプト（`deploy.sh`）を実行するだけで、IDPパイプライン全体を自動デプロイします。スクリプトはCloudFormationでCodeBuildプロジェクトを作成し、CodeBuildがCDKを通じて12個のスタックを順次デプロイします。

```
deploy.sh 実行 (CloudShell)
  → CloudFormation スタック作成
    → CodeBuild プロジェクトプロビジョニング
      → CDK Bootstrap
        → VPC スタックデプロイ
          → 残り11スタック並列デプロイ (concurrency=4)
            → Cognito 管理者アカウント作成
```

---

## 事前準備

### リージョンの確認

以下のリージョンでのデプロイを推奨します：

| リージョン | 説明 |
|------------|------|
| **us-east-1** (N. Virginia) | 全モデル対応 |
| **us-west-2** (Oregon) | 全モデル対応 |

---

## デプロイ手順

### Step 1. CloudShellを開く

AWS Console上部のCloudShellアイコンをクリックするか、検索バーで「CloudShell」と入力してアクセスします。

<p align="center">
  <img src="../assets/quick-deploy-cloudshell.png" alt="CloudShell" width="800">
</p>

### Step 2. デプロイスクリプトの実行

```bash
git clone https://github.com/aws-samples/sample-aws-idp-pipeline.git
cd sample-aws-idp-pipeline
chmod +x ./deploy.sh
./deploy.sh
```

### Step 3. 管理者メールアドレスの入力

スクリプトが実行されると、管理者アカウント用のメールアドレスを入力します。このメールでCognitoユーザーが作成されます。

```
===========================================================================
  Sample AWS IDP Pipeline - Automated Deployment
---------------------------------------------------------------------------
  Deploys the full IDP pipeline via CodeBuild.

  Stacks: Vpc, Storage, Event, Bda, Ocr, Transcribe, Workflow,
          Websocket, Worker, Mcp, Agent, Application
===========================================================================

Enter admin user email address: your-email@example.com
```

### Step 4. 設定確認とデプロイ開始

入力した設定を確認し、`y`を入力してデプロイを開始します。

```
Configuration:
--------------
Admin Email: your-email@example.com
Repository:  https://github.com/aws-samples/sample-aws-idp-pipeline.git
Version:     main
Stack Name:  sample-aws-idp-pipeline-codebuild

Do you want to proceed with deployment? (y/N): y
```

デプロイが開始されると、以下の手順が自動的に実行されます：

1. CloudFormationテンプレートのダウンロードと検証
2. CodeBuildプロジェクトの作成（CloudFormation）
3. CodeBuildビルドの開始
4. CDK Bootstrap（初回のみ）
5. 12個のスタックを順次/並列デプロイ
6. Cognito管理者アカウントの作成

---

## デプロイの監視

### CloudShellで確認

スクリプトがCodeBuildビルドの進行状況をリアルタイムで表示します。

```
Starting CodeBuild: sample-aws-idp-pipeline-deploy ...
Build ID: sample-aws-idp-pipeline-deploy:xxxxxxxx

You can monitor progress in the AWS Console:
  CodeBuild > Build projects > sample-aws-idp-pipeline-deploy

Phase: BUILD
```

### CodeBuild Consoleで確認

詳細なログを確認するには、AWS ConsoleでCodeBuildプロジェクトを直接確認できます。

> **AWS Console** > **CodeBuild** > **Build projects** > **sample-aws-idp-pipeline-deploy**

<p align="center">
  <img src="../assets/quick-deploy-codebuild.png" alt="CodeBuild Console" width="800">
</p>

### CodeBuild ビルドフェーズ

| フェーズ | 内容 | 予想時間 |
|----------|------|----------|
| INSTALL | Node.js 22, Python 3.13, pnpm, CDK, Docker QEMUセットアップ | 2-3分 |
| PRE_BUILD | ソースクローン、依存関係インストール（`pnpm install`） | 3-5分 |
| BUILD | Lint, Compile, Test, Bundle + CDKデプロイ（12スタック） | 30-50分 |
| POST_BUILD | Cognito管理者アカウント作成、URL出力 | 1分 |

---

## デプロイ完了

デプロイが正常に完了すると、以下の情報が表示されます。

```
===========================================================================
  Deployment Successful
===========================================================================

  Application URL: https://dxxxxxxxxxx.cloudfront.net

  Login Credentials:
     Email:              your-email@example.com
     Temporary Password: TempPass123!

  Next Steps:
     1. Access the application using the URL above
     2. Log in with the credentials
     3. Change your password when prompted

  To destroy all resources:
     aws cloudformation delete-stack --stack-name sample-aws-idp-pipeline-codebuild

===========================================================================
```

### アクセスとログイン

1. **Application URL**にアクセスします
2. メールアドレスの`@`の前の部分がユーザー名です（例：`your-email@example.com` → `your-email`）
3. 一時パスワード`TempPass123!`でログインします
4. 初回ログイン時にパスワード変更が求められます

<p align="center">
  <img src="../assets/quick-deploy-login.png" alt="Login Screen" width="800">
</p>

---

## 高度なオプション

### コマンドラインオプション

```bash
bash deploy.sh [OPTIONS]

Options:
  --admin-email EMAIL   管理者メール（対話的入力をスキップ）
  --repo-url URL        リポジトリURL（デフォルト: github.com/aws-samples/...）
  --version VERSION     デプロイするブランチまたはタグ（デフォルト: main）
  --stack-name NAME     CloudFormationスタック名（デフォルト: sample-aws-idp-pipeline-codebuild）
  --info                デプロイ済みアプリケーションURLを表示
  --help                ヘルプメッセージを表示
```

### デプロイURL再確認

```bash
bash deploy.sh --info
```

### 特定バージョンのデプロイ

```bash
bash deploy.sh --admin-email user@example.com --version v1.0.0
```

---

## リソース削除

### destroy.sh の実行

デプロイされたすべてのリソースを削除するには、`destroy.sh`スクリプトを実行します。デプロイと同様にCodeBuildを通じて12個のスタックを逆順で削除します。

```bash
cd sample-aws-idp-pipeline
chmod +x ./destroy.sh
./destroy.sh
```

```
===========================================================================
  Sample AWS IDP Pipeline - Automated Destroy
---------------------------------------------------------------------------
  Destroys all IDP pipeline resources via CodeBuild.

  Stacks: Application, Agent, Mcp, Worker, Websocket, Workflow,
          Transcribe, Bda, Ocr, Event, Storage, Vpc
===========================================================================

WARNING: This will permanently delete all IDP pipeline resources.

Do you want to proceed with destroy? (y/N): y
```

削除が完了すると、destroy用のCodeBuildスタックも自動的にクリーンアップされます。

### 削除が失敗した場合

一部のリソースが削除されない場合があります（例：S3バケットにデータが残っている場合、ENIがまだ使用中の場合など）。この場合：

1. **AWS Console** > **CloudFormation**で`DELETE_FAILED`状態のスタックを確認します
2. 該当スタックの**Events**タブで失敗原因を確認します
3. 問題のあるリソースを手動で削除した後、CloudFormationからスタックを再度削除します

> **注意**: `CDKToolkit`スタックは将来の再デプロイのために保存されます。完全に削除するには`aws cloudformation delete-stack --stack-name CDKToolkit`を実行してください。

---

## トラブルシューティング

### CloudShellセッションタイムアウト

CloudShellは20分間未使用の場合、セッションが終了します。デプロイスクリプト実行後にCodeBuildが開始されると、CloudShellセッションが終了してもCodeBuildビルドは継続されます。CodeBuild Consoleで進行状況を確認できます。

### CodeBuildビルド失敗

ビルド失敗時にログを確認します：

```bash
# 最近のビルドログを確認
aws logs tail /aws/codebuild/sample-aws-idp-pipeline-deploy --since 10m
```

### 一般的な失敗原因

| 原因 | 解決方法 |
|------|----------|
| Bedrockモデルアクセス未有効化 | Bedrock Consoleで必要なモデルのアクセスを有効化 |
| サービスクォータ超過 | AWS Supportでクォータ増加をリクエスト |
| CDK Bootstrap失敗 | `aws cloudformation delete-stack --stack-name CDKToolkit` 後に再デプロイ |
| VPC制限超過 | 使用していないVPCを削除するかクォータ増加をリクエスト |

---

## デプロイアーキテクチャ

```
CloudShell
  │
  ├─ deploy.sh
  │   ├─ CloudFormation Template ダウンロード (deploy-codebuild.yml)
  │   ├─ CloudFormation Stack 作成
  │   │   └─ CodeBuild Project (IAM Role: PowerUserAccess + IAM)
  │   └─ CodeBuild Build 開始
  │
  └─ CodeBuild (BUILD_GENERAL1_LARGE, amazonlinux 5.0)
      ├─ INSTALL:    Node.js 22, Python 3.13, pnpm, CDK, Docker QEMU (ARM64)
      ├─ PRE_BUILD:  git clone → pnpm install
      ├─ BUILD:      lint + test + bundle → CDK deploy (12 stacks)
      └─ POST_BUILD: Cognito admin user 作成
```

---

## ライセンス

このプロジェクトは[Amazon Software License](../../LICENSE)の下でライセンスされています。
