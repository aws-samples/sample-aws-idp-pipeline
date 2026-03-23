---
title: "PaddleOCR on SageMaker"
description: "SageMaker 비동기 추론 엔드포인트 기반 PaddleOCR 처리 파이프라인"
---

## 개요

OCR 모델 특성에 따라 두 가지 백엔드로 라우팅하는 처리 파이프라인입니다.

| 백엔드 | 모델 | 이유 |
|--------|------|------|
| **Lambda (CPU)** | PP-OCRv5 | 경량 모델, GPU 불필요, 빠른 시작 |
| **SageMaker (GPU)** | PaddleOCR-VL | Vision-Language 모델, GPU 필수 |

PP-OCRv5는 CPU만으로 충분히 빠르게 동작하므로 SageMaker 콜드 스타트 없이 Lambda에서 직접 처리합니다. Lambda Processor는 Rust로 구현되어 MNN 기반 CPU 추론을 수행합니다. PaddleOCR-VL은 텍스트 영역별 VLM 추론에 GPU가 필수적이므로 SageMaker에서 실행합니다.

---

## 아키텍처

```
SQS (OCR Queue)
  → Lambda (OCR Orchestrator) ─── 모델에 따라 라우팅
      │
      ├─ [PP-OCRv5] ── CPU 모델
      │     → Lambda (OCR Processor, Python)
      │         → Lambda (Rust PaddleOCR, MNN 기반 추론)
      │             ├─ S3 (result.json 저장)
      │             └─ DynamoDB (전처리 상태 업데이트)
      │
      └─ [PaddleOCR-VL] ── GPU 모델
            ├─ Scale-out: DesiredInstanceCount → 1
            └─ InvokeEndpointAsync → SageMaker Endpoint
                → PaddleOCR-VL 추론
                    ├─ 성공 → SNS (Success) → OCR Complete Handler → DynamoDB + S3
                    └─ 실패 → SNS (Error)  → OCR Complete Handler → DynamoDB

SageMaker Scale-in:
  CloudWatch Alarm (10분 유휴)
    → SNS (Scale-in) → Scale-in Handler Lambda
      → DesiredInstanceCount → 0
```

---

## 처리 백엔드

### Lambda (CPU) - PP-OCRv5

PP-OCRv5는 2단계 호출 구조로 Lambda에서 실행됩니다. Python Orchestrator Lambda가 Rust Lambda를 동기 호출하여 MNN 기반 CPU 추론을 수행합니다. SageMaker 경유 없이 직접 결과를 S3에 저장하고 DynamoDB 상태를 업데이트합니다.

#### OCR Lambda Processor (Python)

| 항목 | 값 |
|------|-----|
| 함수 이름 | `idp-v2-ocr-lambda-processor` |
| 런타임 | Python 3.14 |
| 메모리 | 256 MB |
| 타임아웃 | 10분 |
| 역할 | Rust OCR Lambda 호출, 응답 변환, S3 결과 저장, DynamoDB 상태 업데이트 |

#### Rust PaddleOCR Lambda

| 항목 | 값 |
|------|-----|
| 함수 이름 | `idp-v2-paddle-ocr` |
| 런타임 | Rust (cargo-lambda-cdk) |
| 아키텍처 | x86_64 |
| 메모리 | 2048 MB |
| 타임아웃 | 10분 |
| 추론 | MNN 기반 CPU 추론 (PP-OCRv5) |

**처리 흐름:**

```
OCR Orchestrator
  → OCR Lambda Processor (Python, 비동기 호출)
      → Rust PaddleOCR Lambda (동기 호출, RequestResponse)
          ├─ S3에서 파일 다운로드
          ├─ MNN 기반 OCR 추론 실행
          └─ 페이지 결과 반환
      ← Rust 응답을 표준 포맷으로 변환
      ├─ result.json S3 저장
      └─ DynamoDB 상태 업데이트 (COMPLETED/FAILED)
```

**SNS 콜백 불필요**: SageMaker 비동기 추론과 달리 Lambda가 직접 결과를 처리하므로 SNS 토픽을 경유하지 않습니다.

### SageMaker (GPU) - PaddleOCR-VL

PaddleOCR-VL은 Vision-Language 모델로, 검출된 텍스트 영역마다 VLM 추론을 수행하므로 GPU가 필수입니다. Auto-scaling 0→1 구성으로 비용을 최적화합니다.

| 항목 | 값 |
|------|-----|
| 인스턴스 타입 | `ml.g5.xlarge` (NVIDIA A10G 24GB) |
| 최소 인스턴스 | 0 (Scale-to-zero) |
| 최대 인스턴스 | 1 |
| 최대 동시 호출 | 4 / 인스턴스 |
| 호출 타임아웃 | 3,600초 (1시간) |
| 응답 최대 크기 | 100MB |
| 베이스 이미지 | PyTorch 2.2.0 GPU (CUDA 11.8, Ubuntu 20.04) |

#### PaddleOCR-VL 성능 특성

VL 모델은 내부적으로 다음과 같이 동작합니다:

```
이미지 입력
  → [1단계] 레이아웃 검출 (CPU/GPU) ── 텍스트 영역 N개 검출
  → [2단계] 영역별 VLM 추론 (GPU)  ── N번 순차 호출
  → 결과 병합
```

텍스트 영역이 N개 검출되면 VLM을 **N번 순차 호출**하며, 이 구조적 특성으로 인해:

- 페이지당 약 14초 소요 (이미지 크기와 무관, 영역 수에 비례)
- GPU 사용률 약 25% (VLM 추론 간 CPU 전후처리 대기)
- 단일 GPU에서 멀티프로세스 불가 (VLM 모델 ~12GB, 2개 로드 시 OOM)

이러한 제약으로 PP-OCRv5 같은 경량 모델은 Lambda에서 처리하여 SageMaker 콜드 스타트를 회피하고, VL만 SageMaker에서 실행합니다.

---

## Auto-scaling 정책

> SageMaker (PaddleOCR-VL) 전용 정책입니다. Lambda 백엔드는 AWS Lambda의 자동 스케일링을 따릅니다.

### Scale-out (확장)

| 항목 | 값 |
|------|-----|
| 트리거 | OCR Invoker Lambda |
| 시점 | SageMaker 비동기 추론 호출 직전 |
| 방식 | `update_endpoint_weights_and_capacities` API 직접 호출 |
| 동작 | `DesiredInstanceCount: 0 → 1` |
| 응답 시간 | 즉시 (API 호출) |
| 멱등성 | 이미 1인 경우 무시 |

OCR Invoker Lambda가 VL 모델로 처리해야 할 때, SageMaker 추론 호출 전에 엔드포인트를 활성화합니다. 인스턴스가 0인 상태에서 실제 추론이 가능해질 때까지 콜드 스타트 시간이 소요됩니다.

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
문서 도착 ─→ OCR Orchestrator가 모델 확인
             ├─ [PP-OCRv5] → Lambda 즉시 처리 (콜드 스타트 없음)
             └─ [VL] → SageMaker Scale-out (0 → 1)
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

:::note
`ml.g5.xlarge` 기준 온디맨드 비용은 시간당 약 $1.41입니다. Scale-to-zero로 사용한 시간만 과금됩니다. PP-OCRv5는 Lambda에서 실행되므로 SageMaker 비용이 발생하지 않습니다.
:::

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
| 역할 | 모델별 라우팅: Lambda 비동기 호출 또는 SageMaker Scale-out + 비동기 추론 호출 |

### OCR Lambda Processor

| 항목 | 값 |
|------|-----|
| 이름 | `idp-v2-ocr-lambda-processor` |
| 런타임 | Python 3.14 |
| 메모리 | 256 MB |
| 타임아웃 | 10분 |
| 트리거 | Lambda 비동기 호출 (OCR Invoker) |
| 역할 | Rust OCR Lambda 호출, 응답 변환, S3 결과 저장, DynamoDB 상태 업데이트 |
| 대상 모델 | PP-OCRv5 |

### Rust PaddleOCR Lambda

| 항목 | 값 |
|------|-----|
| 이름 | `idp-v2-paddle-ocr` |
| 런타임 | Rust (cargo-lambda-cdk) |
| 아키텍처 | x86_64 |
| 메모리 | 2048 MB |
| 타임아웃 | 10분 |
| 트리거 | OCR Lambda Processor에서 동기 호출 |
| 역할 | MNN 기반 PP-OCRv5 CPU 추론 |

### OCR Complete Handler

| 항목 | 값 |
|------|-----|
| 이름 | `idp-v2-ocr-complete-handler` |
| 런타임 | Python 3.14 |
| 메모리 | 256MB |
| 타임아웃 | 5분 |
| 트리거 | SNS (Success + Error 토픽) |
| 역할 | SageMaker 추론 결과 처리, S3 저장, DynamoDB 상태 업데이트 |
| 대상 모델 | PaddleOCR-VL (SageMaker 경유) |

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

> SageMaker (PaddleOCR-VL) 경로에서만 사용됩니다. Lambda 경로는 SNS를 사용하지 않습니다.

| 토픽 | 용도 | 구독자 |
|------|------|--------|
| `idp-v2-ocr-success` | 추론 성공 알림 | OCR Complete Handler |
| `idp-v2-ocr-error` | 추론 실패 알림 | OCR Complete Handler |
| `idp-v2-ocr-scale-in` | Scale-in 알람 알림 | Scale-in Handler |

---

## 지원 OCR 모델

| 모델 | 백엔드 | 설명 | 용도 |
|------|--------|------|------|
| **PP-OCRv5** | Lambda (CPU, Rust) | 높은 정확도의 범용 텍스트 추출 OCR | 일반 문서, 다국어 텍스트 |
| **PaddleOCR-VL** | SageMaker (GPU) | Vision-Language 모델 기반 문서 이해 | 복잡한 문서, 맥락적 이해 |

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
| 이미지 | `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp`, `.webp` |
