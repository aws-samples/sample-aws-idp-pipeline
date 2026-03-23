---
title: "PaddleOCR on SageMaker"
description: "SageMaker非同期推論エンドポイントベースのPaddleOCR処理パイプライン"
---

## 概要

OCRモデルの特性に応じて2つのバックエンドにルーティングする処理パイプラインです。

| バックエンド | モデル | 理由 |
|-------------|--------|------|
| **Lambda (CPU)** | PP-OCRv5 | 軽量モデル、GPU不要、高速起動 |
| **SageMaker (GPU)** | PaddleOCR-VL | Vision-Languageモデル、GPU必須 |

PP-OCRv5はCPUのみで十分高速に動作するため、SageMakerのコールドスタートなしでLambdaから直接処理します。Lambda ProcessorはRustで実装され、MNNベースのCPU推論を実行します。PaddleOCR-VLはテキスト領域ごとのVLM推論にGPUが必須のため、SageMakerで実行します。

---

## アーキテクチャ

```
SQS (OCR Queue)
  → Lambda (OCR Orchestrator) ─── モデルに応じてルーティング
      │
      ├─ [PP-OCRv5] ── CPUモデル
      │     → Lambda (OCR Processor, Python)
      │         → Lambda (Rust PaddleOCR, MNNベース推論)
      │             ├─ S3 (result.json保存)
      │             └─ DynamoDB (前処理ステータス更新)
      │
      └─ [PaddleOCR-VL] ── GPUモデル
            ├─ Scale-out: DesiredInstanceCount → 1
            └─ InvokeEndpointAsync → SageMaker Endpoint
                → PaddleOCR-VL推論
                    ├─ 成功 → SNS (Success) → OCR Complete Handler → DynamoDB + S3
                    └─ 失敗 → SNS (Error)  → OCR Complete Handler → DynamoDB

SageMaker Scale-in:
  CloudWatch Alarm（10分アイドル）
    → SNS (Scale-in) → Scale-in Handler Lambda
      → DesiredInstanceCount → 0
```

---

## 処理バックエンド

### Lambda (CPU) - PP-OCRv5

PP-OCRv5は2段階の呼び出し構造でLambdaから実行されます。Python Orchestrator LambdaがRust Lambdaを同期呼び出しし、MNNベースのCPU推論を実行します。SageMakerを経由せず、直接結果をS3に保存しDynamoDBステータスを更新します。

#### OCR Lambda Processor (Python)

| 項目 | 値 |
|------|-----|
| 関数名 | `idp-v2-ocr-lambda-processor` |
| ランタイム | Python 3.14 |
| メモリ | 256 MB |
| タイムアウト | 10分 |
| 役割 | Rust OCR Lambda呼び出し、レスポンス変換、S3結果保存、DynamoDBステータス更新 |

#### Rust PaddleOCR Lambda

| 項目 | 値 |
|------|-----|
| 関数名 | `idp-v2-paddle-ocr` |
| ランタイム | Rust (cargo-lambda-cdk) |
| アーキテクチャ | x86_64 |
| メモリ | 2048 MB |
| タイムアウト | 10分 |
| 推論 | MNNベースCPU推論 (PP-OCRv5) |

**処理フロー:**

```
OCR Orchestrator
  → OCR Lambda Processor (Python, 非同期呼び出し)
      → Rust PaddleOCR Lambda (同期呼び出し, RequestResponse)
          ├─ S3からファイルダウンロード
          ├─ MNNベースOCR推論実行
          └─ ページ結果返却
      ← Rustレスポンスを標準フォーマットに変換
      ├─ result.json S3保存
      └─ DynamoDBステータス更新 (COMPLETED/FAILED)
```

**SNSコールバック不要**: SageMaker非同期推論と異なり、Lambdaが直接結果を処理するためSNSトピックを経由しません。

### SageMaker (GPU) - PaddleOCR-VL

PaddleOCR-VLはVision-Languageモデルで、検出されたテキスト領域ごとにVLM推論を実行するためGPUが必須です。Auto-scaling 0→1構成でコストを最適化します。

| 項目 | 値 |
|------|-----|
| インスタンスタイプ | `ml.g5.xlarge` (NVIDIA A10G 24GB) |
| 最小インスタンス | 0 (Scale-to-zero) |
| 最大インスタンス | 1 |
| 最大同時呼び出し | 4 / インスタンス |
| 呼び出しタイムアウト | 3,600秒（1時間） |
| 最大レスポンスサイズ | 100MB |
| ベースイメージ | PyTorch 2.2.0 GPU (CUDA 11.8, Ubuntu 20.04) |

#### PaddleOCR-VLパフォーマンス特性

VLモデルは内部的に以下のように動作します:

```
画像入力
  → [ステップ1] レイアウト検出 (CPU/GPU) ── テキスト領域N個検出
  → [ステップ2] 領域ごとのVLM推論 (GPU) ── N回順次呼び出し
  → 結果マージ
```

テキスト領域がN個検出されると、VLMを**N回順次呼び出し**します。この構造的特性により:

- ページあたり約14秒（画像サイズに依存せず、領域数に比例）
- GPU使用率約25%（VLM推論間のCPU前後処理待ち）
- 単一GPUでマルチプロセス不可（VLMモデル~12GB、2つロードでOOM）

これらの制約により、PP-OCRv5のような軽量モデルはLambdaで処理してSageMakerコールドスタートを回避し、VLのみSageMakerで実行します。

---

## Auto-scalingポリシー

> SageMaker (PaddleOCR-VL) 専用ポリシーです。LambdaバックエンドはAWS Lambdaの自動スケーリングに従います。

### Scale-out（スケールアウト）

| 項目 | 値 |
|------|-----|
| トリガー | OCR Invoker Lambda |
| タイミング | SageMaker非同期推論呼び出し直前 |
| 方式 | `update_endpoint_weights_and_capacities` API直接呼び出し |
| 動作 | `DesiredInstanceCount: 0 → 1` |
| 応答時間 | 即時（API呼び出し） |
| 冪等性 | 既に1の場合は無視 |

OCR Invoker LambdaがVLモデルで処理する必要がある時、SageMaker推論呼び出し前にエンドポイントをアクティベートします。インスタンスが0の状態から実際に推論可能になるまでコールドスタート時間が必要です。

### Scale-in（スケールイン）

| 項目 | 値 |
|------|-----|
| トリガー | CloudWatch Alarm → SNS → Scale-in Handler Lambda |
| メトリクス | `ApproximateBacklogSizePerInstance` |
| 条件 | < 0.1（実質的にゼロ） |
| 評価期間 | 10分連続（1分間隔、10回） |
| 欠落データ | BREACHINGとして処理（アラーム発動） |
| 動作 | `DesiredInstanceCount: 1 → 0` |

10分間キューに処理すべき作業がない場合、CloudWatchアラームが発動し、SNSを通じてScale-in Handler Lambdaをトリガーしてインスタンスをゼロに縮小します。

### コスト最適化サマリー

```
文書到着 ─→ OCR Orchestratorがモデル確認
             ├─ [PP-OCRv5] → Lambda即時処理（コールドスタートなし）
             └─ [VL] → SageMaker Scale-out (0 → 1)
                        ↓
                    推論処理（コールドスタート含む）
                        ↓
                    処理完了 → SNS → OCR Complete Handler
                        ↓
                    10分間追加リクエストなし
                        ↓
                    CloudWatch Alarm発動 → Scale-in (1 → 0)
                        ↓
                    課金停止（インスタンス0）
```

:::note
`ml.g5.xlarge`のオンデマンドコストは約$1.41/時間です。Scale-to-zeroにより使用した時間のみ課金されます。PP-OCRv5はLambdaで実行されるため、SageMakerコストは発生しません。
:::

---

## Lambda関数

### OCR Invoker

| 項目 | 値 |
|------|-----|
| 名前 | `idp-v2-ocr-invoker` |
| ランタイム | Python 3.14 |
| メモリ | 256MB |
| タイムアウト | 1分 |
| トリガー | SQS（バッチサイズ: 1） |
| 役割 | モデル別ルーティング: Lambda非同期呼び出しまたはSageMaker Scale-out + 非同期推論呼び出し |

### OCR Lambda Processor

| 項目 | 値 |
|------|-----|
| 名前 | `idp-v2-ocr-lambda-processor` |
| ランタイム | Python 3.14 |
| メモリ | 256 MB |
| タイムアウト | 10分 |
| トリガー | Lambda非同期呼び出し（OCR Invokerから） |
| 役割 | Rust OCR Lambda呼び出し、レスポンス変換、S3結果保存、DynamoDBステータス更新 |
| 対象モデル | PP-OCRv5 |

### Rust PaddleOCR Lambda

| 項目 | 値 |
|------|-----|
| 名前 | `idp-v2-paddle-ocr` |
| ランタイム | Rust (cargo-lambda-cdk) |
| アーキテクチャ | x86_64 |
| メモリ | 2048 MB |
| タイムアウト | 10分 |
| トリガー | OCR Lambda Processorから同期呼び出し |
| 役割 | MNNベースPP-OCRv5 CPU推論 |

### OCR Complete Handler

| 項目 | 値 |
|------|-----|
| 名前 | `idp-v2-ocr-complete-handler` |
| ランタイム | Python 3.14 |
| メモリ | 256MB |
| タイムアウト | 5分 |
| トリガー | SNS（Success + Errorトピック） |
| 役割 | SageMaker推論結果処理、S3保存、DynamoDBステータス更新 |
| 対象モデル | PaddleOCR-VL（SageMaker経由） |

### Scale-in Handler

| 項目 | 値 |
|------|-----|
| 名前 | `idp-v2-ocr-scale-in` |
| ランタイム | Python 3.14 |
| メモリ | 128MB |
| タイムアウト | 30秒 |
| トリガー | SNS（CloudWatch Alarm） |
| 役割 | `DesiredInstanceCount → 0` |

---

## SNSトピック

> SageMaker (PaddleOCR-VL) パスでのみ使用されます。LambdaパスはSNSを使用しません。

| トピック | 用途 | サブスクライバー |
|---------|------|-----------------|
| `idp-v2-ocr-success` | 推論成功通知 | OCR Complete Handler |
| `idp-v2-ocr-error` | 推論失敗通知 | OCR Complete Handler |
| `idp-v2-ocr-scale-in` | Scale-inアラーム通知 | Scale-in Handler |

---

## 対応OCRモデル

| モデル | バックエンド | 説明 | ユースケース |
|--------|-------------|------|-------------|
| **PP-OCRv5** | Lambda (CPU, Rust) | 高精度汎用テキスト抽出OCR | 一般文書、多言語テキスト |
| **PaddleOCR-VL** | SageMaker (GPU) | ビジョン言語モデルベースの文書理解 | 複雑な文書、コンテキスト理解 |

---

## 対応言語

PaddleOCRは**80以上の言語**をサポートしています。

### 主要言語

| 言語 | コード | 言語 | コード |
|------|--------|------|--------|
| 中国語・英語 | `ch` | 韓国語 | `korean` |
| 英語 | `en` | 日本語 | `japan` |
| 繁体字中国語 | `chinese_cht` | フランス語 | `fr` |
| ドイツ語 | `de` | スペイン語 | `es` |
| イタリア語 | `it` | ポルトガル語 | `pt` |
| ロシア語 | `ru` | アラビア語 | `ar` |
| ヒンディー語 | `hi` | タイ語 | `th` |
| ベトナム語 | `vi` | トルコ語 | `tr` |

### ヨーロッパ言語

| 言語 | コード | 言語 | コード |
|------|--------|------|--------|
| アフリカーンス語 | `af` | アルバニア語 | `sq` |
| バスク語 | `eu` | ボスニア語 | `bs` |
| カタルーニャ語 | `ca` | クロアチア語 | `hr` |
| チェコ語 | `cs` | デンマーク語 | `da` |
| オランダ語 | `nl` | エストニア語 | `et` |
| フィンランド語 | `fi` | ガリシア語 | `gl` |
| ハンガリー語 | `hu` | アイスランド語 | `is` |
| インドネシア語 | `id` | アイルランド語 | `ga` |
| ラトビア語 | `lv` | リトアニア語 | `lt` |
| ルクセンブルク語 | `lb` | マレー語 | `ms` |
| マルタ語 | `mt` | マオリ語 | `mi` |
| ノルウェー語 | `no` | オック語 | `oc` |
| ポーランド語 | `pl` | ルーマニア語 | `ro` |
| ロマンシュ語 | `rm` | セルビア語（ラテン） | `rs_latin` |
| スロバキア語 | `sk` | スロベニア語 | `sl` |
| スウェーデン語 | `sv` | タガログ語 | `tl` |
| ウェールズ語 | `cy` | ラテン語 | `la` |

### キリル文字言語

| 言語 | コード | 言語 | コード |
|------|--------|------|--------|
| ロシア語 | `ru` | ウクライナ語 | `uk` |
| ベラルーシ語 | `be` | ブルガリア語 | `bg` |
| セルビア語（キリル） | `sr` | マケドニア語 | `mk` |
| モンゴル語 | `mn` | カザフ語 | `kk` |
| キルギス語 | `ky` | タジク語 | `tg` |
| タタール語 | `tt` | ウズベク語 | `uz` |
| アゼルバイジャン語 | `az` | モルドバ語 | `mo` |
| バシキール語 | `ba` | チュヴァシ語 | `cv` |
| マリ語 | `mhr` | ウドムルト語 | `udm` |
| コミ語 | `kv` | オセット語 | `os` |
| ブリヤート語 | `bua` | カルムイク語 | `xal` |
| トゥバ語 | `tyv` | サハ語 | `sah` |
| カラカルパク語 | `kaa` | アブハズ語 | `ab` |
| アディゲ語 | `ady` | カバルド語 | `kbd` |
| アヴァル語 | `av` | ダルグワ語 | `dar` |
| イングーシ語 | `inh` | チェチェン語 | `ce` |
| ラク語 | `lki` | レズギン語 | `lez` |
| タバサラン語 | `tab` | | |

### アラビア文字言語

| 言語 | コード | 言語 | コード |
|------|--------|------|--------|
| アラビア語 | `ar` | ペルシア語 | `fa` |
| ウイグル語 | `ug` | ウルドゥー語 | `ur` |
| パシュトー語 | `ps` | クルド語 | `ku` |
| シンド語 | `sd` | バローチー語 | `bal` |

### インド言語

| 言語 | コード | 言語 | コード |
|------|--------|------|--------|
| ヒンディー語 | `hi` | マラーティー語 | `mr` |
| ネパール語 | `ne` | タミル語 | `ta` |
| テルグ語 | `te` | ビハール語 | `bh` |
| マイティリー語 | `mai` | ボージュプリー語 | `bho` |
| マガヒー語 | `mah` | サドリー語 | `sck` |
| ネワール語 | `new` | コンカニ語 | `gom` |
| サンスクリット語 | `sa` | ハリヤーンヴィー語 | `bgc` |
| パーリ語 | `pi` | | |

### その他の言語

| 言語 | コード | 言語 | コード |
|------|--------|------|--------|
| ギリシャ語 | `el` | スワヒリ語 | `sw` |
| ケチュア語 | `qu` | 古英語 | `ang` |

---

## 対応ファイル形式

| 形式 | 拡張子 |
|------|--------|
| PDF | `.pdf` |
| 画像 | `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp`, `.webp` |
