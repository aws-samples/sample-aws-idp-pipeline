---
title: "전처리 파이프라인"
description: "파일 유형별 자동 라우팅 및 비동기 전처리"
---

## 개요

문서가 업로드되면 Type Detection Lambda가 파일 유형을 감지하고, 필요한 전처리 작업을 SQS 큐를 통해 비동기로 분배합니다. 전처리가 완료되면 Step Functions 워크플로우가 결과를 병합하여 AI 분석 단계로 전달합니다.

```
S3 Upload
  ↓ [EventBridge]
Type Detection Lambda
  ├─ OCR Queue        → PaddleOCR (Lambda/SageMaker)
  ├─ BDA Queue        → Bedrock Data Automation
  ├─ Transcribe Queue → AWS Transcribe
  ├─ WebCrawler Queue → Bedrock Agent Core
  └─ Workflow Queue   → Step Functions
                        ├─ Segment Prep (세그먼트 생성)
                        ├─ Check Preprocess Status (폴링)
                        ├─ Format Parser (텍스트 추출)
                        ├─ Segment Builder (결과 병합)
                        └─ → AI Analysis Pipeline
```

> AI 분석 파이프라인(Segment Analyzer, Document Summarizer)에 대한 상세 내용은 [AI Analysis Pipeline](./analysis.md)을 참조하세요.

---

## 파일 유형별 전처리 라우팅

| 파일 유형 | 확장자 | OCR | BDA | Transcribe | Format Parser | WebCrawler |
|-----------|--------|:---:|:---:|:----------:|:-------------:|:----------:|
| PDF | `.pdf` | O | O | - | A | - |
| 이미지 | `.png` `.jpg` `.jpeg` `.gif` `.tiff` `.tif` `.webp` | O | O | - | - | - |
| 영상 | `.mp4` `.mov` `.avi` `.mkv` `.webm` | - | O | O | - | - |
| 음성 | `.mp3` `.wav` `.flac` `.m4a` | - | O | O | - | - |
| Word 문서 | `.docx` `.doc` | - | - | - | A | - |
| 프레젠테이션 | `.pptx` `.ppt` | - | - | - | A | - |
| 스프레드시트 | `.xlsx` `.xls` `.csv` | - | - | - | A | - |
| 텍스트 | `.txt` `.md` | - | - | - | A | - |
| 웹 | `.webreq` | - | - | - | - | A |
| CAD | `.dxf` | - | - | - | A | - |

- **A** (Automatic): 기본 활성화 (자동 실행)
- **O** (Optional): 문서 업로드 시 사용자가 선택적으로 활성화
- **-** : 해당 없음

> OCR(`use_ocr`), BDA(`use_bda`), Transcribe(`use_transcribe`)는 모두 문서 업로드 시 사용자가 선택적으로 활성화할 수 있습니다.

---

## 전처리 컴포넌트

### PaddleOCR

PDF와 이미지에서 텍스트를 추출합니다. Lambda(CPU) 또는 SageMaker(GPU) 듀얼 백엔드를 지원합니다.

| 항목 | 값 |
|------|-----|
| 대상 | PDF, 이미지 (DXF 제외) |
| Lambda 모델 | `pp-ocrv5`, `pp-structurev3` (CPU) |
| SageMaker 모델 | `paddleocr-vl` (GPU) |
| 출력 | `paddleocr/result.json` (페이지별 텍스트 + 블록 좌표) |

프로젝트 언어 설정에 따라 OCR 언어가 자동 매핑됩니다 (한국어 → `korean`, 일본어 → `japan` 등).

> 상세 내용은 [PaddleOCR on SageMaker](./ocr.md)를 참조하세요.

### Bedrock Data Automation (BDA)

AWS Bedrock Data Automation을 사용하여 문서 구조(테이블, 레이아웃, 이미지)를 마크다운 형태로 분석합니다. 영상의 경우 챕터 분할과 요약을 수행합니다.

| 항목 | 값 |
|------|-----|
| 대상 | PDF, 이미지, 영상, 음성 (오피스 문서/스프레드시트/DXF/웹 제외) |
| 활성화 | `use_bda=true` (문서 업로드 시 선택) |
| 출력 | `bda-output/` (마크다운, 이미지, 메타데이터) |

### AWS Transcribe

음성 및 영상 파일에서 음성을 텍스트로 변환합니다. 타임코드가 포함된 세그먼트 단위 트랜스크립트를 생성합니다.

| 항목 | 값 |
|------|-----|
| 대상 | 영상 (MP4, MOV, AVI, MKV, WebM), 음성 (MP3, WAV, FLAC, M4A) |
| 활성화 | `use_transcribe=true` (문서 업로드 시 선택) |
| 출력 | `transcribe/{workflow_id}-{timestamp}.json` |

### Format Parser

파일 유형에 따라 다양한 라이브러리를 사용하여 텍스트를 추출합니다. Step Functions 워크플로우 내에서 동기적으로 실행됩니다.

| 파일 유형 | 라이브러리 | 동작 |
|-----------|-----------|------|
| PDF | `pypdf` | 페이지별 텍스트 레이어 추출 (그래픽 스트리핑) |
| DOCX/DOC | LibreOffice → `pypdf` + `pypdfium2` | PDF 변환 후 페이지별 텍스트 + PNG 이미지 생성 |
| PPTX/PPT | `python-pptx` + LibreOffice → `pypdfium2` | 슬라이드별 텍스트 + PNG 이미지 생성 |
| XLSX | `openpyxl` | 시트별 마크다운 테이블 변환 |
| XLS | `xlrd` | 시트별 마크다운 테이블 변환 |
| CSV | `csv` (stdlib) | 단일 시트 마크다운 테이블 변환 |
| TXT/MD | 직접 읽기 | 청크 분할 (15,000자, 500자 오버랩) |
| DXF | `ezdxf` + `matplotlib` | 레이아웃별 텍스트 추출 + PNG 렌더링 |

출력: `format-parser/result.json`

### WebCrawler

Bedrock Agent Core 기반의 웹 크롤링 에이전트가 `.webreq` 파일에 지정된 URL을 크롤링합니다.

| 항목 | 값 |
|------|-----|
| 대상 | `.webreq` 파일 |
| 입력 | JSON (`{"url": "...", "instruction": "..."}`) |
| 출력 | `webcrawler/pages/page_XXXX.json` (다중 페이지) 또는 `webcrawler/content.md` (레거시) |

---

## 파일 유형별 상세 흐름

### PDF

```
PDF 업로드
  ↓
Type Detection
  ├─ OCR Queue → PaddleOCR → paddleocr/result.json (페이지별 텍스트, 옵션)
  ├─ BDA Queue → BDA → bda-output/ (마크다운, 옵션)
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: 페이지별 PNG 렌더링 (pypdfium2, 150 DPI)
      ├─ Check Preprocess Status: OCR/BDA 완료 폴링
      ├─ Format Parser: pypdf로 텍스트 레이어 추출
      └─ Segment Builder: OCR + BDA + Format Parser 병합
```

| 항목 | 값 |
|------|-----|
| 세그먼트 유형 | `PAGE` (페이지당 1개) |
| 세그먼트 수 | PDF 페이지 수 |
| 이미지 | 페이지별 PNG (`preprocessed/page_XXXX.png`) |
| 자동 전처리 | Format Parser |
| 옵션 전처리 | OCR, BDA |

### 이미지

```
이미지 업로드 (PNG, JPG, TIFF 등)
  ↓
Type Detection
  ├─ OCR Queue → PaddleOCR → paddleocr/result.json (단일 텍스트, 옵션)
  ├─ BDA Queue → BDA → bda-output/ (마크다운, 옵션)
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: 원본 이미지 사용 (복사 없음)
      ├─ Check Preprocess Status: OCR/BDA 완료 폴링
      └─ Segment Builder: OCR + BDA 병합
```

| 항목 | 값 |
|------|-----|
| 세그먼트 유형 | `PAGE` (1개) |
| 세그먼트 수 | 1 |
| 이미지 | 원본 파일 URI 직접 사용 |
| 옵션 전처리 | OCR, BDA |

### 영상 (MP4/MOV/AVI/MKV/WebM)

```
영상 업로드
  ↓
Type Detection
  ├─ BDA Queue → BDA → 챕터 분할 + 요약 (옵션)
  ├─ Transcribe Queue → AWS Transcribe → 트랜스크립트 (옵션)
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: VIDEO 세그먼트 1개 생성
      ├─ Check Preprocess Status: BDA/Transcribe 완료 폴링
      └─ Segment Builder: BDA 챕터 + Transcribe 병합
```

| 항목 | 값 |
|------|-----|
| 세그먼트 유형 | `VIDEO` (BDA 미사용 시) 또는 `CHAPTER` (BDA 챕터 분할 시) |
| 세그먼트 수 | 1 (BDA 미사용) 또는 챕터 수 (BDA 사용) |
| 이미지 | 없음 |
| 옵션 전처리 | BDA, Transcribe |

### 음성 (MP3/WAV/FLAC/M4A)

```
음성 업로드
  ↓
Type Detection
  ├─ BDA Queue → BDA (옵션)
  ├─ Transcribe Queue → AWS Transcribe → 트랜스크립트 (옵션)
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: AUDIO 세그먼트 1개 생성
      ├─ Check Preprocess Status: BDA/Transcribe 완료 폴링
      └─ Segment Builder: Transcribe 결과 병합
```

| 항목 | 값 |
|------|-----|
| 세그먼트 유형 | `AUDIO` |
| 세그먼트 수 | 1 |
| 이미지 | 없음 |
| 옵션 전처리 | BDA, Transcribe |

### Word 문서 (DOCX/DOC)

```
DOCX/DOC 업로드
  ↓
Type Detection
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: 플레이스홀더 1개 생성
      ├─ Format Parser: LibreOffice로 PDF 변환 → 페이지별 텍스트 + PNG
      └─ Segment Builder: Format Parser 결과로 세그먼트 덮어쓰기
```

| 항목 | 값 |
|------|-----|
| 세그먼트 유형 | `PAGE` (페이지당 1개) |
| 세그먼트 수 | LibreOffice 변환 후 PDF 페이지 수 |
| 이미지 | 페이지별 PNG (`format-parser/slides/slide_XXXX.png` → `preprocessed/page_XXXX.png`) |
| 자동 전처리 | Format Parser |
| 비동기 전처리 | 없음 (모든 전처리 스킵) |

### 프레젠테이션 (PPTX/PPT)

```
PPTX/PPT 업로드
  ↓
Type Detection
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: 플레이스홀더 1개 생성
      ├─ Format Parser: python-pptx 텍스트 + LibreOffice PDF 변환 → PNG
      └─ Segment Builder: Format Parser 결과로 세그먼트 덮어쓰기
```

| 항목 | 값 |
|------|-----|
| 세그먼트 유형 | `PAGE` (슬라이드당 1개) |
| 세그먼트 수 | 슬라이드 수 |
| 이미지 | 슬라이드별 PNG (`format-parser/slides/slide_XXXX.png` → `preprocessed/page_XXXX.png`) |
| 자동 전처리 | Format Parser |
| 텍스트 추출 | 슬라이드 텍스트 + 테이블 + 발표자 노트 |

### 스프레드시트 (XLSX/XLS/CSV)

```
XLSX/XLS/CSV 업로드
  ↓
Type Detection
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: 플레이스홀더 1개 생성
      ├─ Format Parser: 시트별 마크다운 테이블 변환
      └─ Segment Builder: Format Parser 결과로 세그먼트 덮어쓰기
```

| 항목 | 값 |
|------|-----|
| 세그먼트 유형 | `TEXT` (시트당 1개) |
| 세그먼트 수 | 시트 수 (CSV는 1개) |
| 이미지 | 없음 |
| 자동 전처리 | Format Parser |
| 출력 형식 | 마크다운 테이블 (`## Sheet: {name}\n\| col1 \| col2 \|...`) |

### 텍스트 (TXT/MD)

```
TXT/MD 업로드
  ↓
Type Detection
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: 플레이스홀더 1개 생성
      ├─ Format Parser: 텍스트 읽기 → 청크 분할
      └─ Segment Builder: Format Parser 결과로 세그먼트 덮어쓰기
```

| 항목 | 값 |
|------|-----|
| 세그먼트 유형 | `TEXT` (청크당 1개) |
| 세그먼트 수 | 텍스트 길이에 따라 자동 결정 |
| 이미지 | 없음 |
| 자동 전처리 | Format Parser |
| 청크 설정 | 15,000자 단위, 500자 오버랩, 문장 경계 우선 |

### 웹 (.webreq)

```
.webreq 파일 업로드 ({"url": "...", "instruction": "..."})
  ↓
Type Detection
  ├─ WebCrawler Queue → Bedrock Agent Core → 웹 크롤링
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: WEB 플레이스홀더 1개 생성
      ├─ Check Preprocess Status: WebCrawler 완료 폴링
      └─ Segment Builder: WebCrawler 결과로 세그먼트 덮어쓰기
```

| 항목 | 값 |
|------|-----|
| 세그먼트 유형 | `WEB` (페이지당 1개) |
| 세그먼트 수 | 크롤링된 페이지 수 |
| 이미지 | 없음 |
| 자동 전처리 | WebCrawler |
| 출력 필드 | `webcrawler_content`, `source_url`, `page_title` |

### CAD (DXF)

```
DXF 파일 업로드
  ↓
Type Detection
  └─ Workflow Queue → Step Functions
      ├─ Segment Prep: 플레이스홀더 1개 생성
      ├─ Format Parser: ezdxf 텍스트 추출 + matplotlib PNG 렌더링
      └─ Segment Builder: Format Parser 결과로 세그먼트 덮어쓰기
```

| 항목 | 값 |
|------|-----|
| 세그먼트 유형 | `PAGE` (레이아웃당 1개) |
| 세그먼트 수 | DXF 레이아웃 수 (Model Space + Paper Space) |
| 이미지 | 레이아웃별 PNG (`format-parser/slides/layout_XXXX.png`) |
| 자동 전처리 | Format Parser |
| 추출 항목 | TEXT, MTEXT, ATTRIB, DIMENSION 엔티티 + 레이어/블록 메타데이터 |

---

## Segment Builder

Segment Builder는 모든 전처리 결과를 단일 세그먼트 JSON으로 병합합니다.

### 병합 우선순위

```
1. 기본 구조: Segment Prep (preprocessor/metadata.json)
2. OCR 결과 병합: paddleocr/result.json → paddleocr, paddleocr_blocks
3. BDA 결과 병합: bda-output/ → bda_indexer, bda_image_uri
4. Format Parser 병합: format-parser/result.json → format_parser, image_uri
5. Transcribe 병합: transcribe/*.json → transcribe, transcribe_segments
6. WebCrawler 병합: webcrawler/pages/*.json → webcrawler_content, source_url
```

### 세그먼트 수 결정 로직

세그먼트 수는 파일 유형에 따라 다른 소스에서 결정됩니다:

| 파일 유형 | 세그먼트 수 결정 소스 |
|-----------|---------------------|
| PDF | Segment Prep (PDF 페이지 수) |
| 이미지 | Segment Prep (항상 1) |
| DOCX/DOC, PPTX/PPT, DXF | Format Parser (변환 후 페이지/슬라이드/레이아웃 수) |
| XLSX/XLS/CSV | Format Parser (시트 수) |
| TXT/MD | Format Parser (청크 수) |
| 영상 | Segment Prep (1) 또는 BDA (챕터 수) |
| 음성 | Segment Prep (항상 1) |
| 웹 | WebCrawler (크롤링 페이지 수) |

> Segment Prep에서 플레이스홀더 1개를 생성한 후, Segment Builder에서 실제 결과에 따라 세그먼트 수를 조정하고 `total_segments`를 업데이트합니다.

---

## S3 출력 구조

```
s3://bucket/projects/{project_id}/documents/{document_id}/
  ├─ {original_file}                          # 원본 업로드 파일
  ├─ preprocessed/
  │   ├─ metadata.json                        # Segment Prep 메타데이터
  │   ├─ page_0000.png                        # 페이지 이미지 (PDF, DOCX, PPTX, DXF)
  │   ├─ page_0001.png
  │   └─ ...
  ├─ paddleocr/
  │   └─ result.json                          # OCR 결과 (페이지별 텍스트 + 블록)
  ├─ bda-output/
  │   └─ {job_id}/
  │       ├─ job_metadata.json                # BDA 작업 메타데이터
  │       ├─ standard_output/
  │       │   ├─ 0/result.json                # BDA 분석 결과 (마크다운)
  │       │   └─ 0/assets/                    # BDA 추출 이미지
  │       └─ ...
  ├─ format-parser/
  │   ├─ result.json                          # 텍스트 추출 결과
  │   └─ slides/                              # PPTX/DOCX/DXF 이미지
  │       ├─ slide_0000.png
  │       └─ ...
  ├─ transcribe/
  │   └─ {workflow_id}-{timestamp}.json       # Transcribe 결과
  ├─ webcrawler/
  │   ├─ metadata.json                        # 크롤링 메타데이터
  │   └─ pages/
  │       ├─ page_0000.json                   # 크롤링 페이지 콘텐츠
  │       └─ ...
  └─ analysis/
      ├─ segment_0000.json                    # 병합된 세그먼트 데이터
      ├─ segment_0001.json
      └─ ...
```

---

## 비동기 전처리 상태 관리

전처리 상태는 DynamoDB 워크플로우 레코드의 `preprocess` 필드에서 관리됩니다.

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

Step Functions 워크플로우의 `CheckPreprocessStatus` Lambda가 주기적으로 폴링하여 모든 필수 전처리가 완료되었는지 확인합니다. 모든 필수 전처리가 `completed` 또는 `skipped` 상태가 되면 다음 단계(Format Parser → Segment Builder)로 진행합니다.
