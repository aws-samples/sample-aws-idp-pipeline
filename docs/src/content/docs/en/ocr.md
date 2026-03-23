---
title: "PaddleOCR on SageMaker"
description: "PaddleOCR Processing Pipeline on SageMaker Async Inference Endpoint"
---

## Overview

A processing pipeline that routes OCR tasks to two backends based on model characteristics.

| Backend | Models | Reason |
|---------|--------|--------|
| **Lambda (CPU)** | PP-OCRv5 | Lightweight model, no GPU needed, fast startup |
| **SageMaker (GPU)** | PaddleOCR-VL | Vision-Language model, GPU required |

PP-OCRv5 runs fast enough on CPU alone, so it is processed directly on Lambda without SageMaker cold start overhead. The Lambda processor is implemented in Rust for optimized memory usage. PaddleOCR-VL requires GPU for per-region VLM inference and runs on SageMaker.

---

## Architecture

```
SQS (OCR Queue)
  → Lambda (OCR Orchestrator) ─── Routes by model
      │
      ├─ [PP-OCRv5] ── CPU model
      │     → Lambda (OCR Processor, Python)
      │         → Lambda (Rust PaddleOCR, MNN-based inference)
      │             ├─ S3 (save result.json)
      │             └─ DynamoDB (update preprocess status)
      │
      └─ [PaddleOCR-VL] ── GPU model
            ├─ Scale-out: DesiredInstanceCount → 1
            └─ InvokeEndpointAsync → SageMaker Endpoint
                → PaddleOCR-VL inference
                    ├─ Success → SNS (Success) → OCR Complete Handler → DynamoDB + S3
                    └─ Failure → SNS (Error)  → OCR Complete Handler → DynamoDB

SageMaker Scale-in:
  CloudWatch Alarm (10 min idle)
    → SNS (Scale-in) → Scale-in Handler Lambda
      → DesiredInstanceCount → 0
```

---

## Processing Backends

### Lambda (CPU) - PP-OCRv5

PP-OCRv5 runs on Lambda via a two-stage invocation: a Python orchestrator Lambda invokes a Rust Lambda that performs MNN-based CPU inference. Results are written directly to S3 and DynamoDB status is updated without going through SageMaker.

#### OCR Lambda Processor (Python)

| Item | Value |
|------|-------|
| Function Name | `idp-v2-ocr-lambda-processor` |
| Runtime | Python 3.14 |
| Memory | 256 MB |
| Timeout | 10 min |
| Role | Invoke Rust OCR Lambda, transform response, save results to S3, update DynamoDB |

#### Rust PaddleOCR Lambda

| Item | Value |
|------|-------|
| Function Name | `idp-v2-paddle-ocr` |
| Runtime | Rust (cargo-lambda-cdk) |
| Architecture | x86_64 |
| Memory | 2048 MB |
| Timeout | 10 min |
| Inference | MNN-based CPU inference (PP-OCRv5) |

**Processing Flow:**

```
OCR Orchestrator
  → OCR Lambda Processor (Python, async invoke)
      → Rust PaddleOCR Lambda (sync invoke, RequestResponse)
          ├─ Download file from S3
          ├─ Run MNN-based OCR inference
          └─ Return page results
      ← Transform Rust response to standard format
      ├─ Save result.json to S3
      └─ Update DynamoDB status (COMPLETED/FAILED)
```

**No SNS callback needed**: Unlike SageMaker async inference, the Lambda handles results directly, so no SNS topic is involved.

### SageMaker (GPU) - PaddleOCR-VL

PaddleOCR-VL is a Vision-Language model that performs VLM inference for each detected text region, requiring GPU. Auto-scaling 0→1 configuration optimizes cost.

| Item | Value |
|------|-------|
| Instance Type | `ml.g5.xlarge` (NVIDIA A10G 24GB) |
| Min Instances | 0 (Scale-to-zero) |
| Max Instances | 1 |
| Max Concurrent Invocations | 4 / instance |
| Invocation Timeout | 3,600s (1 hour) |
| Max Response Size | 100MB |
| Base Image | PyTorch 2.2.0 GPU (CUDA 11.8, Ubuntu 20.04) |

#### PaddleOCR-VL Performance Characteristics

The VL model internally works as follows:

```
Image input
  → [Step 1] Layout detection (CPU/GPU) ── Detect N text regions
  → [Step 2] Per-region VLM inference (GPU) ── N sequential calls
  → Merge results
```

When N text regions are detected, the VLM is called **N times sequentially**. Due to this structural characteristic:

- ~14s per page (independent of image size, proportional to region count)
- ~25% GPU utilization (CPU pre/post-processing waits between VLM inferences)
- Multi-process not possible on single GPU (VLM model ~12GB, OOM with 2 instances)

These constraints are why lightweight models run on Lambda to avoid SageMaker cold start, while only VL remains on SageMaker where GPU is required.

---

## Auto-scaling Policy

> SageMaker (PaddleOCR-VL) only. The Lambda backend follows AWS Lambda's automatic scaling.

### Scale-out

| Item | Value |
|------|-------|
| Trigger | OCR Invoker Lambda |
| Timing | Just before SageMaker async inference invocation |
| Method | Direct `update_endpoint_weights_and_capacities` API call |
| Action | `DesiredInstanceCount: 0 → 1` |
| Response Time | Immediate (API call) |
| Idempotent | No-op if already at 1 |

When the OCR Invoker Lambda needs to process a document with the VL model, it activates the endpoint before invoking inference. Cold start time is required from 0 instances until the instance becomes available.

### Scale-in

| Item | Value |
|------|-------|
| Trigger | CloudWatch Alarm → SNS → Scale-in Handler Lambda |
| Metric | `ApproximateBacklogSizePerInstance` |
| Condition | < 0.1 (effectively zero) |
| Evaluation Period | 10 consecutive minutes (1-min intervals, 10 periods) |
| Missing Data | Treated as BREACHING (triggers alarm) |
| Action | `DesiredInstanceCount: 1 → 0` |

When no work remains in the queue for 10 minutes, the CloudWatch alarm fires, triggering the Scale-in Handler Lambda via SNS to reduce instances to zero.

### Cost Optimization Summary

```
Document arrives ─→ OCR Orchestrator checks model
                    ├─ [PP-OCRv5] → Lambda processes immediately (no cold start)
                    └─ [VL] → SageMaker Scale-out (0 → 1)
                               ↓
                           Inference processing (including cold start)
                               ↓
                           Processing complete → SNS → OCR Complete Handler
                               ↓
                           No additional requests for 10 minutes
                               ↓
                           CloudWatch Alarm fires → Scale-in (1 → 0)
                               ↓
                           Billing stops (0 instances)
```

:::note
On-demand cost for `ml.g5.xlarge` is approximately $1.41/hour. With Scale-to-zero, you only pay for the time actually used. PP-OCRv5 runs on Lambda, so no SageMaker cost is incurred.
:::

---

## Lambda Functions

### OCR Invoker

| Item | Value |
|------|-------|
| Name | `idp-v2-ocr-invoker` |
| Runtime | Python 3.14 |
| Memory | 256MB |
| Timeout | 1 min |
| Trigger | SQS (batch size: 1) |
| Role | Route by model: Lambda async invoke or SageMaker Scale-out + async inference |

### OCR Lambda Processor

| Item | Value |
|------|-------|
| Name | `idp-v2-ocr-lambda-processor` |
| Runtime | Python 3.14 |
| Memory | 256 MB |
| Timeout | 10 min |
| Trigger | Lambda async invoke (from OCR Invoker) |
| Role | Invoke Rust OCR Lambda, transform response, save results to S3, update DynamoDB |
| Target Models | PP-OCRv5 |

### Rust PaddleOCR Lambda

| Item | Value |
|------|-------|
| Name | `idp-v2-paddle-ocr` |
| Runtime | Rust (cargo-lambda-cdk) |
| Architecture | x86_64 |
| Memory | 2048 MB |
| Timeout | 10 min |
| Trigger | Sync invoke from OCR Lambda Processor |
| Role | MNN-based PP-OCRv5 CPU inference |

### OCR Complete Handler

| Item | Value |
|------|-------|
| Name | `idp-v2-ocr-complete-handler` |
| Runtime | Python 3.14 |
| Memory | 256MB |
| Timeout | 5 min |
| Trigger | SNS (Success + Error topics) |
| Role | Process SageMaker inference results, save to S3, update DynamoDB status |
| Target Models | PaddleOCR-VL (via SageMaker) |

### Scale-in Handler

| Item | Value |
|------|-------|
| Name | `idp-v2-ocr-scale-in` |
| Runtime | Python 3.14 |
| Memory | 128MB |
| Timeout | 30s |
| Trigger | SNS (CloudWatch Alarm) |
| Role | `DesiredInstanceCount → 0` |

---

## SNS Topics

> Used only by the SageMaker (PaddleOCR-VL) path. The Lambda path does not use SNS.

| Topic | Purpose | Subscriber |
|-------|---------|------------|
| `idp-v2-ocr-success` | Inference success notification | OCR Complete Handler |
| `idp-v2-ocr-error` | Inference failure notification | OCR Complete Handler |
| `idp-v2-ocr-scale-in` | Scale-in alarm notification | Scale-in Handler |

---

## Supported OCR Models

| Model | Backend | Description | Use Case |
|-------|---------|-------------|----------|
| **PP-OCRv5** | Lambda (CPU, Rust) | High-accuracy general-purpose text extraction OCR | General documents, multilingual text |
| **PaddleOCR-VL** | SageMaker (GPU) | Vision-language model for document understanding | Complex documents, contextual understanding |

---

## Supported Languages

PaddleOCR supports **80+ languages**.

### Primary Languages

| Language | Code | Language | Code |
|----------|------|----------|------|
| Chinese & English | `ch` | Korean | `korean` |
| English | `en` | Japanese | `japan` |
| Traditional Chinese | `chinese_cht` | French | `fr` |
| German | `de` | Spanish | `es` |
| Italian | `it` | Portuguese | `pt` |
| Russian | `ru` | Arabic | `ar` |
| Hindi | `hi` | Thai | `th` |
| Vietnamese | `vi` | Turkish | `tr` |

### European Languages

| Language | Code | Language | Code |
|----------|------|----------|------|
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

### Cyrillic Languages

| Language | Code | Language | Code |
|----------|------|----------|------|
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
| Tabasaran | `tab` | | |

### Arabic Script Languages

| Language | Code | Language | Code |
|----------|------|----------|------|
| Arabic | `ar` | Persian | `fa` |
| Uyghur | `ug` | Urdu | `ur` |
| Pashto | `ps` | Kurdish | `ku` |
| Sindhi | `sd` | Balochi | `bal` |

### Indic Languages

| Language | Code | Language | Code |
|----------|------|----------|------|
| Hindi | `hi` | Marathi | `mr` |
| Nepali | `ne` | Tamil | `ta` |
| Telugu | `te` | Bihari | `bh` |
| Maithili | `mai` | Bhojpuri | `bho` |
| Magahi | `mah` | Sadri | `sck` |
| Newar | `new` | Konkani | `gom` |
| Sanskrit | `sa` | Haryanvi | `bgc` |
| Pali | `pi` | | |

### Other Languages

| Language | Code | Language | Code |
|----------|------|----------|------|
| Greek | `el` | Swahili | `sw` |
| Quechua | `qu` | Old English | `ang` |

---

## Supported File Formats

| Format | Extensions |
|--------|-----------|
| PDF | `.pdf` |
| Images | `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp`, `.webp` |
