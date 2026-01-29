<h1 align="center">PaddleOCR on SageMaker</h1>

<p align="center">
  <strong>SageMaker 비동기 추론 엔드포인트 기반 PaddleOCR 처리 파이프라인</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/PaddleOCR-3.3.0-2B6CB0?logo=paddlepaddle&logoColor=white" alt="PaddleOCR">
  <img src="https://img.shields.io/badge/PaddlePaddle_GPU-3.2.2-2B6CB0?logo=paddlepaddle&logoColor=white" alt="PaddlePaddle">
  <img src="https://img.shields.io/badge/SageMaker-ml.g5.xlarge-FF9900?logo=amazon&logoColor=white" alt="SageMaker">
  <img src="https://img.shields.io/badge/GPU-NVIDIA_A10G_24GB-76B900?logo=nvidia&logoColor=white" alt="NVIDIA A10G">
  <img src="https://img.shields.io/badge/CUDA-11.8-76B900?logo=nvidia&logoColor=white" alt="CUDA">
</p>

<p align="center">
  <a href="../../README.md">English</a> | <strong>한국어</strong> | <a href="OCR_ja.md">日本語</a>
</p>

---

## 개요

SageMaker 비동기 추론 엔드포인트에서 PaddleOCR을 실행하여, 업로드된 문서(PDF, 이미지)에서 텍스트를 추출합니다. Auto-scaling 0→1 구성으로 비용을 최적화하며, 사용하지 않을 때 자동으로 인스턴스가 종료됩니다.

---

## 아키텍처

```
SQS (OCR Queue)
  → OCR Invoker Lambda
      ├─ Scale-out: DesiredInstanceCount → 1 (즉시)
      └─ InvokeEndpointAsync → SageMaker Endpoint
          → PaddleOCR 추론
              ├─ 성공 → SNS (Success) → OCR Complete Handler → DynamoDB + S3
              └─ 실패 → SNS (Error)  → OCR Complete Handler → DynamoDB

Scale-in (Fallback):
  CloudWatch Alarm (10분 유휴)
    → SNS (Scale-in) → Scale-in Handler Lambda
      → DesiredInstanceCount → 0
```

---

## SageMaker 엔드포인트 구성

| 항목 | 값 |
|------|-----|
| 인스턴스 타입 | `ml.g5.xlarge` (NVIDIA A10G 24GB) |
| 최소 인스턴스 | 0 (Scale-to-zero) |
| 최대 인스턴스 | 1 |
| 최대 동시 호출 | 4 / 인스턴스 |
| 호출 타임아웃 | 3,600초 (1시간) |
| 응답 최대 크기 | 100MB |
| 베이스 이미지 | PyTorch 2.2.0 GPU (CUDA 11.8, Ubuntu 20.04) |

---

## Auto-scaling 정책

### Scale-out (확장)

| 항목 | 값 |
|------|-----|
| 트리거 | OCR Invoker Lambda |
| 시점 | SageMaker 비동기 추론 호출 직전 |
| 방식 | `update_endpoint_weights_and_capacities` API 직접 호출 |
| 동작 | `DesiredInstanceCount: 0 → 1` |
| 응답 시간 | 즉시 (API 호출) |
| 멱등성 | 이미 1인 경우 무시 |

OCR Invoker Lambda가 새 문서를 처리해야 할 때, SageMaker 추론 호출 전에 엔드포인트를 활성화합니다. 인스턴스가 0인 상태에서 실제 추론이 가능해질 때까지 콜드 스타트 시간이 소요됩니다.

### Scale-in (축소)

| 항목 | 값 |
|------|-----|
| 트리거 | CloudWatch Alarm → SNS → Scale-in Handler Lambda |
| 메트릭 | `ApproximateBacklogSizePerInstance` |
| 조건 | < 0.1 (실질적으로 0) |
| 평가 기간 | 10분 연속 (1분 간격, 10회) |
| 누락 데이터 | BREACHING으로 처리 (알람 발동) |
| 동작 | `DesiredInstanceCount: 1 → 0` |

10분간 대기열에 처리할 작업이 없으면 CloudWatch 알람이 발동되어 SNS를 통해 Scale-in Handler Lambda를 트리거하고, 인스턴스를 0으로 축소합니다.

### 비용 최적화 요약

```
문서 도착 ─→ OCR Invoker가 즉시 Scale-out (0 → 1)
             ↓
         추론 처리 (콜드 스타트 포함)
             ↓
         처리 완료 → SNS → OCR Complete Handler
             ↓
         10분간 추가 요청 없음
             ↓
         CloudWatch Alarm 발동 → Scale-in (1 → 0)
             ↓
         과금 중지 (인스턴스 0)
```

> **참고**: `ml.g5.xlarge` 기준 온디맨드 비용은 시간당 약 $1.41입니다. Scale-to-zero로 사용한 시간만 과금됩니다.

---

## Lambda 함수

### OCR Invoker

| 항목 | 값 |
|------|-----|
| 이름 | `idp-v2-ocr-invoker` |
| 런타임 | Python 3.14 |
| 메모리 | 256MB |
| 타임아웃 | 1분 |
| 트리거 | SQS (배치 크기: 1) |
| 역할 | Scale-out + SageMaker 비동기 추론 호출 |

### OCR Complete Handler

| 항목 | 값 |
|------|-----|
| 이름 | `idp-v2-ocr-complete-handler` |
| 런타임 | Python 3.14 |
| 메모리 | 256MB |
| 타임아웃 | 5분 |
| 트리거 | SNS (Success + Error 토픽) |
| 역할 | 추론 결과 처리, S3 저장, DynamoDB 상태 업데이트 |

### Scale-in Handler

| 항목 | 값 |
|------|-----|
| 이름 | `idp-v2-ocr-scale-in` |
| 런타임 | Python 3.14 |
| 메모리 | 128MB |
| 타임아웃 | 30초 |
| 트리거 | SNS (CloudWatch Alarm) |
| 역할 | `DesiredInstanceCount → 0` |

---

## SNS 토픽

| 토픽 | 용도 | 구독자 |
|------|------|--------|
| `idp-v2-ocr-success` | 추론 성공 알림 | OCR Complete Handler |
| `idp-v2-ocr-error` | 추론 실패 알림 | OCR Complete Handler |
| `idp-v2-ocr-scale-in` | Scale-in 알람 알림 | Scale-in Handler |

---

## 지원 OCR 모델

| 모델 | 설명 | 용도 |
|------|------|------|
| **PP-OCRv5** | 높은 정확도의 범용 텍스트 추출 OCR | 일반 문서, 다국어 텍스트 |
| **PP-StructureV3** | 테이블 및 레이아웃 감지 포함 문서 구조 분석 | 표, 양식, 복잡한 레이아웃 |
| **PaddleOCR-VL** | 비전-언어 모델 기반 문서 이해 | 복잡한 문서, 맥락적 이해 |

---

## 지원 언어

PaddleOCR은 **80개 이상의 언어**를 지원합니다.

### 주요 언어

| 언어 | 약어 | 언어 | 약어 |
|------|------|------|------|
| Chinese & English | `ch` | Korean | `korean` |
| English | `en` | Japanese | `japan` |
| Traditional Chinese | `chinese_cht` | French | `fr` |
| German | `de` | Spanish | `es` |
| Italian | `it` | Portuguese | `pt` |
| Russian | `ru` | Arabic | `ar` |
| Hindi | `hi` | Thai | `th` |
| Vietnamese | `vi` | Turkish | `tr` |

### 유럽 언어

| 언어 | 약어 | 언어 | 약어 |
|------|------|------|------|
| Afrikaans | `af` | Albanian | `sq` |
| Basque | `eu` | Bosnian | `bs` |
| Catalan | `ca` | Croatian | `hr` |
| Czech | `cs` | Danish | `da` |
| Dutch | `nl` | Estonian | `et` |
| Finnish | `fi` | Galician | `gl` |
| Hungarian | `hu` | Icelandic | `is` |
| Indonesian | `id` | Irish | `ga` |
| Latvian | `lv` | Lithuanian | `lt` |
| Luxembourgish | `lb` | Malay | `ms` |
| Maltese | `mt` | Maori | `mi` |
| Norwegian | `no` | Occitan | `oc` |
| Polish | `pl` | Romanian | `ro` |
| Romansh | `rm` | Serbian (Latin) | `rs_latin` |
| Slovak | `sk` | Slovenian | `sl` |
| Swedish | `sv` | Tagalog | `tl` |
| Welsh | `cy` | Latin | `la` |

### 키릴 문자 언어

| 언어 | 약어 | 언어 | 약어 |
|------|------|------|------|
| Russian | `ru` | Ukrainian | `uk` |
| Belarusian | `be` | Bulgarian | `bg` |
| Serbian (Cyrillic) | `sr` | Macedonian | `mk` |
| Mongolian | `mn` | Kazakh | `kk` |
| Kyrgyz | `ky` | Tajik | `tg` |
| Tatar | `tt` | Uzbek | `uz` |
| Azerbaijani | `az` | Moldovan | `mo` |
| Bashkir | `ba` | Chuvash | `cv` |
| Mari | `mhr` | Udmurt | `udm` |
| Komi | `kv` | Ossetian | `os` |
| Buriat | `bua` | Kalmyk | `xal` |
| Tuvinian | `tyv` | Sakha | `sah` |
| Karakalpak | `kaa` | Abkhaz | `ab` |
| Adyghe | `ady` | Kabardian | `kbd` |
| Avar | `av` | Dargwa | `dar` |
| Ingush | `inh` | Chechen | `ce` |
| Lak | `lki` | Lezgian | `lez` |
| Tabasaran | `tab` | |  |

### 아랍 문자 언어

| 언어 | 약어 | 언어 | 약어 |
|------|------|------|------|
| Arabic | `ar` | Persian | `fa` |
| Uyghur | `ug` | Urdu | `ur` |
| Pashto | `ps` | Kurdish | `ku` |
| Sindhi | `sd` | Balochi | `bal` |

### 인도 언어

| 언어 | 약어 | 언어 | 약어 |
|------|------|------|------|
| Hindi | `hi` | Marathi | `mr` |
| Nepali | `ne` | Tamil | `ta` |
| Telugu | `te` | Bihari | `bh` |
| Maithili | `mai` | Bhojpuri | `bho` |
| Magahi | `mah` | Sadri | `sck` |
| Newar | `new` | Konkani | `gom` |
| Sanskrit | `sa` | Haryanvi | `bgc` |
| Pali | `pi` | |  |

### 기타 언어

| 언어 | 약어 | 언어 | 약어 |
|------|------|------|------|
| Greek | `el` | Swahili | `sw` |
| Quechua | `qu` | Old English | `ang` |

---

## 지원 파일 형식

| 형식 | 확장자 |
|------|--------|
| PDF | `.pdf` |
| 이미지 | `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp` |
