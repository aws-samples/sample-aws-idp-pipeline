---
title: "前処理パイプライン"
description: "ファイルタイプ別の自動ルーティングと非同期前処理"
---

## 概要

文書がアップロードされると、Type Detection Lambdaがファイルタイプを検出し、必要な前処理タスクをSQSキューを通じて非同期で分配します。前処理が完了すると、Step Functionsワークフローが結果をマージしてAI分析ステージに渡します。

```
S3 Upload
  ↓ [EventBridge]
Type Detection Lambda
  ├─ OCR Queue        → PaddleOCR (Lambda/SageMaker)
  ├─ BDA Queue        → Bedrock Data Automation
  ├─ Transcribe Queue → AWS Transcribe
  ├─ WebCrawler Queue → Bedrock Agent Core
  └─ Workflow Queue   → Step Functions
                        ├─ Segment Prep（セグメント作成）
                        ├─ Check Preprocess Status（ポーリング）
                        ├─ Format Parser（テキスト抽出）
                        ├─ Segment Builder（結果マージ）
                        └─ → AI Analysis Pipeline
```

> AI分析パイプライン（Segment Analyzer、Document Summarizer）の詳細は[AI Analysis Pipeline](./analysis.md)を参照してください。

---

## ファイルタイプ別前処理ルーティング

| ファイルタイプ | 拡張子 | OCR | BDA | Transcribe | Format Parser | WebCrawler |
|---------------|--------|:---:|:---:|:----------:|:-------------:|:----------:|
| PDF | `.pdf` | O | O | - | A | - |
| 画像 | `.png` `.jpg` `.jpeg` `.gif` `.tiff` `.tif` `.webp` | O | O | - | - | - |
| 映像 | `.mp4` `.mov` `.avi` `.mkv` `.webm` | - | O | O | - | - |
| 音声 | `.mp3` `.wav` `.flac` `.m4a` | - | O | O | - | - |
| Word文書 | `.docx` `.doc` | - | - | - | A | - |
| プレゼンテーション | `.pptx` `.ppt` | - | - | - | A | - |
| テキスト | `.txt` `.md` | - | - | - | A | - |
| ウェブ | `.webreq` | - | - | - | - | A |
| CAD | `.dxf` | - | - | - | A | - |

- **A**（Automatic）：デフォルトで有効（自動実行）
- **O**（Optional）：文書アップロード時にユーザーが選択的に有効化
- **-**：該当なし

> OCR（`use_ocr`）、BDA（`use_bda`）、Transcribe（`use_transcribe`）はすべて文書アップロード時にユーザーが選択的に有効化できます。

---

## 前処理コンポーネント

### PaddleOCR

PDFと画像からテキストを抽出します。Lambda（CPU）またはSageMaker（GPU）のデュアルバックエンドをサポートします。

| 項目 | 値 |
|------|-----|
| 対象 | PDF、画像（DXF除外） |
| Lambdaモデル | `pp-ocrv5`（CPU、Rust） |
| SageMakerモデル | `paddleocr-vl`（GPU） |
| 出力 | `paddleocr/result.json`（ページごとのテキスト + ブロック座標） |

プロジェクトの言語設定に応じてOCR言語が自動マッピングされます（韓国語 → `korean`、日本語 → `japan` など）。

> 詳細は[PaddleOCR on SageMaker](./ocr.md)を参照してください。

### Bedrock Data Automation（BDA）

AWS Bedrock Data Automationを使用して文書構造（テーブル、レイアウト、画像）をマークダウン形式で分析します。映像の場合はチャプター分割と要約を実行します。

| 項目 | 値 |
|------|-----|
| 対象 | PDF、画像、映像、音声（オフィス文書/DXF/ウェブ除外） |
| 有効化 | `use_bda=true`（文書アップロード時に選択） |
| 出力 | `bda-output/`（マークダウン、画像、メタデータ） |

### AWS Transcribe

音声および映像ファイルから音声をテキストに変換します。タイムコード付きのセグメント単位トランスクリプトを生成します。

| 項目 | 値 |
|------|-----|
| 対象 | 映像（MP4、MOV、AVI、MKV、WebM）、音声（MP3、WAV、FLAC、M4A） |
| 有効化 | `use_transcribe=true`（文書アップロード時に選択） |
| 出力 | `transcribe/{workflow_id}-{timestamp}.json` |

### Format Parser

ファイルタイプに応じてさまざまなライブラリを使用してテキストを抽出します。Step Functionsワークフロー内で同期的に実行されます。

| ファイルタイプ | ライブラリ | 動作 |
|---------------|-----------|------|
| PDF | `pypdf` | ページごとのテキストレイヤー抽出（グラフィックストリッピング） |
| DOCX/DOC | LibreOffice → `pypdf` + `pypdfium2` | PDF変換後、ページごとのテキスト + PNG画像生成 |
| PPTX/PPT | `python-pptx` + LibreOffice → `pypdfium2` | スライドごとのテキスト + PNG画像生成 |
| TXT/MD | 直接読み取り | チャンク分割（15,000文字、500文字オーバーラップ） |
| DXF | `ezdxf` + `matplotlib` | レイアウトごとのテキスト抽出 + PNGレンダリング |

出力：`format-parser/result.json`

### WebCrawler

Bedrock Agent Coreベースのウェブクローリングエージェントが`.webreq`ファイルに指定されたURLをクロールします。

| 項目 | 値 |
|------|-----|
| 対象 | `.webreq`ファイル |
| 入力 | JSON（`{"url": "...", "instruction": "..."}`） |
| 出力 | `webcrawler/pages/page_XXXX.json`（マルチページ）または`webcrawler/content.md`（レガシー） |

---

## ファイルタイプ別詳細フロー

### PDF

```
PDFアップロード
  ↓
Type Detection
  ├─ OCR Queue → PaddleOCR → paddleocr/result.json（ページごとのテキスト、オプション）
  ├─ BDA Queue → BDA → bda-output/（マークダウン、オプション）
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep：ページごとにPNGレンダリング（pypdfium2、150 DPI）
      ├─ Check Preprocess Status：OCR/BDA完了ポーリング
      ├─ Format Parser：pypdfでテキストレイヤー抽出
      └─ Segment Builder：OCR + BDA + Format Parserをマージ
```

| 項目 | 値 |
|------|-----|
| セグメントタイプ | `PAGE`（ページごとに1つ） |
| セグメント数 | PDFページ数 |
| 画像 | ページごとのPNG（`preprocessed/page_XXXX.png`） |
| 自動前処理 | Format Parser |
| オプション前処理 | OCR、BDA |

### 画像

```
画像アップロード（PNG、JPG、TIFFなど）
  ↓
Type Detection
  ├─ OCR Queue → PaddleOCR → paddleocr/result.json（単一テキスト、オプション）
  ├─ BDA Queue → BDA → bda-output/（マークダウン、オプション）
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep：元画像を使用（コピーなし）
      ├─ Check Preprocess Status：OCR/BDA完了ポーリング
      └─ Segment Builder：OCR + BDAをマージ
```

| 項目 | 値 |
|------|-----|
| セグメントタイプ | `PAGE`（1つ） |
| セグメント数 | 1 |
| 画像 | 元ファイルURIを直接使用 |
| オプション前処理 | OCR、BDA |

### 映像（MP4/MOV/AVI/MKV/WebM）

```
映像アップロード
  ↓
Type Detection
  ├─ BDA Queue → BDA → チャプター分割 + 要約（オプション）
  ├─ Transcribe Queue → AWS Transcribe → トランスクリプト（オプション）
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep：VIDEOセグメント1つ作成
      ├─ Check Preprocess Status：BDA/Transcribe完了ポーリング
      └─ Segment Builder：BDAチャプター + Transcribeをマージ
```

| 項目 | 値 |
|------|-----|
| セグメントタイプ | `VIDEO`（BDA未使用時）または`CHAPTER`（BDAチャプター分割時） |
| セグメント数 | 1（BDA未使用）またはチャプター数（BDA使用） |
| 画像 | なし |
| オプション前処理 | BDA、Transcribe |

### 音声（MP3/WAV/FLAC/M4A）

```
音声アップロード
  ↓
Type Detection
  ├─ BDA Queue → BDA（オプション）
  ├─ Transcribe Queue → AWS Transcribe → トランスクリプト（オプション）
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep：AUDIOセグメント1つ作成
      ├─ Check Preprocess Status：BDA/Transcribe完了ポーリング
      └─ Segment Builder：Transcribe結果をマージ
```

| 項目 | 値 |
|------|-----|
| セグメントタイプ | `AUDIO` |
| セグメント数 | 1 |
| 画像 | なし |
| オプション前処理 | BDA、Transcribe |

### Word文書（DOCX/DOC）

```
DOCX/DOCアップロード
  ↓
Type Detection
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep：プレースホルダー1つ作成
      ├─ Format Parser：LibreOfficeでPDF変換 → ページごとのテキスト + PNG
      └─ Segment Builder：Format Parser結果でセグメントを上書き
```

| 項目 | 値 |
|------|-----|
| セグメントタイプ | `PAGE`（ページごとに1つ） |
| セグメント数 | LibreOffice変換後のPDFページ数 |
| 画像 | ページごとのPNG（`format-parser/slides/slide_XXXX.png` → `preprocessed/page_XXXX.png`） |
| 自動前処理 | Format Parser |
| 非同期前処理 | なし（すべての前処理スキップ） |

### プレゼンテーション（PPTX/PPT）

```
PPTX/PPTアップロード
  ↓
Type Detection
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep：プレースホルダー1つ作成
      ├─ Format Parser：python-pptxテキスト + LibreOffice PDF変換 → PNG
      └─ Segment Builder：Format Parser結果でセグメントを上書き
```

| 項目 | 値 |
|------|-----|
| セグメントタイプ | `PAGE`（スライドごとに1つ） |
| セグメント数 | スライド数 |
| 画像 | スライドごとのPNG（`format-parser/slides/slide_XXXX.png` → `preprocessed/page_XXXX.png`） |
| 自動前処理 | Format Parser |
| テキスト抽出 | スライドテキスト + テーブル + スピーカーノート |

### テキスト（TXT/MD）

```
TXT/MDアップロード
  ↓
Type Detection
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep：プレースホルダー1つ作成
      ├─ Format Parser：テキスト読み取り → チャンク分割
      └─ Segment Builder：Format Parser結果でセグメントを上書き
```

| 項目 | 値 |
|------|-----|
| セグメントタイプ | `TEXT`（チャンクごとに1つ） |
| セグメント数 | テキスト長に応じて自動決定 |
| 画像 | なし |
| 自動前処理 | Format Parser |
| チャンク設定 | 15,000文字単位、500文字オーバーラップ、文境界優先 |

### ウェブ（.webreq）

```
.webreqファイルアップロード（{"url": "...", "instruction": "..."}）
  ↓
Type Detection
  ├─ WebCrawler Queue → Bedrock Agent Core → ウェブクローリング
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep：WEBプレースホルダー1つ作成
      ├─ Check Preprocess Status：WebCrawler完了ポーリング
      └─ Segment Builder：WebCrawler結果でセグメントを上書き
```

| 項目 | 値 |
|------|-----|
| セグメントタイプ | `WEB`（ページごとに1つ） |
| セグメント数 | クロールされたページ数 |
| 画像 | なし |
| 自動前処理 | WebCrawler |
| 出力フィールド | `webcrawler_content`、`source_url`、`page_title` |

### CAD（DXF）

```
DXFファイルアップロード
  ↓
Type Detection
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep：プレースホルダー1つ作成
      ├─ Format Parser：ezdxfテキスト抽出 + matplotlib PNGレンダリング
      └─ Segment Builder：Format Parser結果でセグメントを上書き
```

| 項目 | 値 |
|------|-----|
| セグメントタイプ | `PAGE`（レイアウトごとに1つ） |
| セグメント数 | DXFレイアウト数（Model Space + Paper Space） |
| 画像 | レイアウトごとのPNG（`format-parser/slides/layout_XXXX.png`） |
| 自動前処理 | Format Parser |
| 抽出エンティティ | TEXT、MTEXT、ATTRIB、DIMENSION + レイヤー/ブロックメタデータ |

---

## Segment Builder

Segment Builderはすべての前処理結果を単一セグメントJSONにマージします。

### マージ優先順位

```
1. ベース構造：Segment Prep（preprocessor/metadata.json）
2. OCR結果マージ：paddleocr/result.json → paddleocr、paddleocr_blocks
3. BDA結果マージ：bda-output/ → bda_indexer、bda_image_uri
4. Format Parserマージ：format-parser/result.json → format_parser、image_uri
5. Transcribeマージ：transcribe/*.json → transcribe、transcribe_segments
6. WebCrawlerマージ：webcrawler/pages/*.json → webcrawler_content、source_url
```

### セグメント数決定ロジック

セグメント数はファイルタイプに応じて異なるソースから決定されます：

| ファイルタイプ | セグメント数決定ソース |
|---------------|---------------------|
| PDF | Segment Prep（PDFページ数） |
| 画像 | Segment Prep（常に1） |
| DOCX/DOC、PPTX/PPT、DXF | Format Parser（変換後のページ/スライド/レイアウト数） |
| TXT/MD | Format Parser（チャンク数） |
| 映像 | Segment Prep（1）またはBDA（チャプター数） |
| 音声 | Segment Prep（常に1） |
| ウェブ | WebCrawler（クロールページ数） |

> Segment Prepでプレースホルダーを作成した後、Segment Builderが実際の結果に基づいてセグメント数を調整し、`total_segments`を更新します。

---

## S3出力構造

```
s3://bucket/projects/{project_id}/documents/{document_id}/
  ├─ {original_file}                          # 元のアップロードファイル
  ├─ preprocessed/
  │   ├─ metadata.json                        # Segment Prepメタデータ
  │   ├─ page_0000.png                        # ページ画像（PDF、DOCX、PPTX、DXF）
  │   ├─ page_0001.png
  │   └─ ...
  ├─ paddleocr/
  │   └─ result.json                          # OCR結果（ページごとのテキスト + ブロック）
  ├─ bda-output/
  │   └─ {job_id}/
  │       ├─ job_metadata.json                # BDAジョブメタデータ
  │       ├─ standard_output/
  │       │   ├─ 0/result.json                # BDA分析結果（マークダウン）
  │       │   └─ 0/assets/                    # BDA抽出画像
  │       └─ ...
  ├─ format-parser/
  │   ├─ result.json                          # テキスト抽出結果
  │   └─ slides/                              # PPTX/DOCX/DXF画像
  │       ├─ slide_0000.png
  │       └─ ...
  ├─ transcribe/
  │   └─ {workflow_id}-{timestamp}.json       # Transcribe結果
  ├─ webcrawler/
  │   ├─ metadata.json                        # クローリングメタデータ
  │   └─ pages/
  │       ├─ page_0000.json                   # クロールページコンテンツ
  │       └─ ...
  └─ analysis/
      ├─ segment_0000.json                    # マージされたセグメントデータ
      ├─ segment_0001.json
      └─ ...
```

---

## 非同期前処理ステータス管理

前処理ステータスはDynamoDBワークフローレコードの`preprocess`フィールドで管理されます。

```json
{
  "preprocess": {
    "ocr": {"required": true, "status": "completed"},
    "bda": {"required": false, "status": "skipped"},
    "transcribe": {"required": false, "status": "skipped"},
    "webcrawler": {"required": false, "status": "skipped"}
  }
}
```

Step Functionsワークフローの`CheckPreprocessStatus` Lambdaが定期的にポーリングして、すべての必須前処理が完了したかを確認します。すべての必須前処理が`completed`または`skipped`ステータスになると、次のステージ（Format Parser → Segment Builder）に進みます。
