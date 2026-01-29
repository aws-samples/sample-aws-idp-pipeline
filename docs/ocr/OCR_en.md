<h1 align="center">PaddleOCR on SageMaker</h1>

<p align="center">
  <strong>PaddleOCR Processing Pipeline on SageMaker Async Inference Endpoint</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/PaddleOCR-3.3.0-2B6CB0?logo=paddlepaddle&logoColor=white" alt="PaddleOCR">
  <img src="https://img.shields.io/badge/PaddlePaddle_GPU-3.2.2-2B6CB0?logo=paddlepaddle&logoColor=white" alt="PaddlePaddle">
  <img src="https://img.shields.io/badge/SageMaker-ml.g5.xlarge-FF9900?logo=amazon&logoColor=white" alt="SageMaker">
  <img src="https://img.shields.io/badge/GPU-NVIDIA_A10G_24GB-76B900?logo=nvidia&logoColor=white" alt="NVIDIA A10G">
  <img src="https://img.shields.io/badge/CUDA-11.8-76B900?logo=nvidia&logoColor=white" alt="CUDA">
</p>

<p align="center">
  <strong>English</strong> | <a href="OCR_ko.md">한국어</a> | <a href="OCR_ja.md">日本語</a>
</p>

---

## Overview

Runs PaddleOCR on a SageMaker async inference endpoint to extract text from uploaded documents (PDF, images). Auto-scaling 0→1 configuration optimizes cost by automatically shutting down instances when idle.

---

## Architecture

```
SQS (OCR Queue)
  → OCR Invoker Lambda
      ├─ Scale-out: DesiredInstanceCount → 1 (immediate)
      └─ InvokeEndpointAsync → SageMaker Endpoint
          → PaddleOCR inference
              ├─ Success → SNS (Success) → OCR Complete Handler → DynamoDB + S3
              └─ Failure → SNS (Error)  → OCR Complete Handler → DynamoDB

Scale-in (Fallback):
  CloudWatch Alarm (10 min idle)
    → SNS (Scale-in) → Scale-in Handler Lambda
      → DesiredInstanceCount → 0
```

---

## SageMaker Endpoint Configuration

| Item | Value |
|------|-------|
| Instance Type | `ml.g5.xlarge` (NVIDIA A10G 24GB) |
| Min Instances | 0 (Scale-to-zero) |
| Max Instances | 1 |
| Max Concurrent Invocations | 4 / instance |
| Invocation Timeout | 3,600s (1 hour) |
| Max Response Size | 100MB |
| Base Image | PyTorch 2.2.0 GPU (CUDA 11.8, Ubuntu 20.04) |

---

## Auto-scaling Policy

### Scale-out

| Item | Value |
|------|-------|
| Trigger | OCR Invoker Lambda |
| Timing | Just before SageMaker async inference invocation |
| Method | Direct `update_endpoint_weights_and_capacities` API call |
| Action | `DesiredInstanceCount: 0 → 1` |
| Response Time | Immediate (API call) |
| Idempotent | No-op if already at 1 |

When the OCR Invoker Lambda needs to process a new document, it activates the endpoint before invoking inference. Cold start time is required from 0 instances until the instance becomes available for inference.

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
Document arrives ─→ OCR Invoker immediately scales out (0 → 1)
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

> **Note**: On-demand cost for `ml.g5.xlarge` is approximately $1.41/hour. With Scale-to-zero, you only pay for the time actually used.

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
| Role | Scale-out + SageMaker async inference invocation |

### OCR Complete Handler

| Item | Value |
|------|-------|
| Name | `idp-v2-ocr-complete-handler` |
| Runtime | Python 3.14 |
| Memory | 256MB |
| Timeout | 5 min |
| Trigger | SNS (Success + Error topics) |
| Role | Process inference results, save to S3, update DynamoDB status |

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

| Topic | Purpose | Subscriber |
|-------|---------|------------|
| `idp-v2-ocr-success` | Inference success notification | OCR Complete Handler |
| `idp-v2-ocr-error` | Inference failure notification | OCR Complete Handler |
| `idp-v2-ocr-scale-in` | Scale-in alarm notification | Scale-in Handler |

---

## Supported OCR Models

| Model | Description | Use Case |
|-------|-------------|----------|
| **PP-OCRv5** | High-accuracy general-purpose text extraction OCR | General documents, multilingual text |
| **PP-StructureV3** | Document structure analysis with table and layout detection | Tables, forms, complex layouts |
| **PaddleOCR-VL** | Vision-language model for document understanding | Complex documents, contextual understanding |

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
| Images | `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp` |

---

## License

This project is licensed under the [Amazon Software License](../../LICENSE).
