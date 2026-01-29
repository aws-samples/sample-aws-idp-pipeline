<h1 align="center">PaddleOCR on SageMaker</h1>

<p align="center">
  <strong>SageMaker非同期推論エンドポイントベースのPaddleOCR処理パイプライン</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/PaddleOCR-3.3.0-2B6CB0?logo=paddlepaddle&logoColor=white" alt="PaddleOCR">
  <img src="https://img.shields.io/badge/PaddlePaddle_GPU-3.2.2-2B6CB0?logo=paddlepaddle&logoColor=white" alt="PaddlePaddle">
  <img src="https://img.shields.io/badge/SageMaker-ml.g5.xlarge-FF9900?logo=amazon&logoColor=white" alt="SageMaker">
  <img src="https://img.shields.io/badge/GPU-NVIDIA_A10G_24GB-76B900?logo=nvidia&logoColor=white" alt="NVIDIA A10G">
  <img src="https://img.shields.io/badge/CUDA-11.8-76B900?logo=nvidia&logoColor=white" alt="CUDA">
</p>

<p align="center">
  <a href="OCR_en.md">English</a> | <a href="OCR_ko.md">한국어</a> | <strong>日本語</strong>
</p>

---

## 概要

SageMaker非同期推論エンドポイントでPaddleOCRを実行し、アップロードされた文書（PDF、画像）からテキストを抽出します。Auto-scaling 0→1構成でコストを最適化し、使用していない時は自動的にインスタンスが停止されます。

---

## アーキテクチャ

```
SQS (OCR Queue)
  → OCR Invoker Lambda
      ├─ Scale-out: DesiredInstanceCount → 1（即時）
      └─ InvokeEndpointAsync → SageMaker Endpoint
          → PaddleOCR推論
              ├─ 成功 → SNS (Success) → OCR Complete Handler → DynamoDB + S3
              └─ 失敗 → SNS (Error)  → OCR Complete Handler → DynamoDB

Scale-in（フォールバック）:
  CloudWatch Alarm（10分アイドル）
    → SNS (Scale-in) → Scale-in Handler Lambda
      → DesiredInstanceCount → 0
```

---

## SageMakerエンドポイント構成

| 項目 | 値 |
|------|-----|
| インスタンスタイプ | `ml.g5.xlarge` (NVIDIA A10G 24GB) |
| 最小インスタンス | 0 (Scale-to-zero) |
| 最大インスタンス | 1 |
| 最大同時呼び出し | 4 / インスタンス |
| 呼び出しタイムアウト | 3,600秒（1時間） |
| 最大レスポンスサイズ | 100MB |
| ベースイメージ | PyTorch 2.2.0 GPU (CUDA 11.8, Ubuntu 20.04) |

---

## Auto-scalingポリシー

### Scale-out（スケールアウト）

| 項目 | 値 |
|------|-----|
| トリガー | OCR Invoker Lambda |
| タイミング | SageMaker非同期推論呼び出し直前 |
| 方式 | `update_endpoint_weights_and_capacities` API直接呼び出し |
| 動作 | `DesiredInstanceCount: 0 → 1` |
| 応答時間 | 即時（API呼び出し） |
| 冪等性 | 既に1の場合は無視 |

OCR Invoker Lambdaが新しい文書を処理する必要がある時、SageMaker推論呼び出し前にエンドポイントをアクティベートします。インスタンスが0の状態から実際に推論可能になるまでコールドスタート時間が必要です。

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
文書到着 ─→ OCR Invokerが即座にScale-out (0 → 1)
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

> **注意**: `ml.g5.xlarge`のオンデマンドコストは約$1.41/時間です。Scale-to-zeroにより使用した時間のみ課金されます。

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
| 役割 | Scale-out + SageMaker非同期推論呼び出し |

### OCR Complete Handler

| 項目 | 値 |
|------|-----|
| 名前 | `idp-v2-ocr-complete-handler` |
| ランタイム | Python 3.14 |
| メモリ | 256MB |
| タイムアウト | 5分 |
| トリガー | SNS（Success + Errorトピック） |
| 役割 | 推論結果処理、S3保存、DynamoDBステータス更新 |

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

| トピック | 用途 | サブスクライバー |
|---------|------|-----------------|
| `idp-v2-ocr-success` | 推論成功通知 | OCR Complete Handler |
| `idp-v2-ocr-error` | 推論失敗通知 | OCR Complete Handler |
| `idp-v2-ocr-scale-in` | Scale-inアラーム通知 | Scale-in Handler |

---

## 対応OCRモデル

| モデル | 説明 | ユースケース |
|--------|------|-------------|
| **PP-OCRv5** | 高精度汎用テキスト抽出OCR | 一般文書、多言語テキスト |
| **PP-StructureV3** | テーブル・レイアウト検出を含む文書構造分析 | 表、フォーム、複雑なレイアウト |
| **PaddleOCR-VL** | ビジョン言語モデルベースの文書理解 | 複雑な文書、コンテキスト理解 |

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
| 画像 | `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp` |

---

## ライセンス

このプロジェクトは[Amazon Software License](../../LICENSE)の下でライセンスされています。
