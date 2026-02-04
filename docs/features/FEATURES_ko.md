<h1 align="center">Features</h1>

<p align="center">
  <strong>Sample AWS IDP Pipeline 주요 기능 소개</strong>
</p>

<p align="center">
  <a href="FEATURES_en.md">English</a> | <strong>한국어</strong> | <a href="FEATURES_ja.md">日本語</a>
</p>

---

## 1. 프로젝트 관리

프로젝트 단위로 문서와 분석 결과를 관리합니다.

- 프로젝트 생성/수정/삭제
- 언어 설정 (한국어, 영어, 일본어)
- 문서 분석 프롬프트 커스터마이징
- 프로젝트별 색상 테마

<p align="center">
  <img src="../assets/features-project.gif" alt="Project Management" width="800">
</p>

---

## 2. 문서 업로드 및 전처리

다양한 형식의 파일을 업로드하면 자동으로 파일 타입을 감지하고 적절한 전처리 파이프라인으로 라우팅합니다. 문서(PDF, DOC, TXT), 이미지(PNG, JPG, GIF, TIFF), 영상(MP4, MOV, AVI), 음성(MP3, WAV, FLAC) 파일을 최대 500MB까지 지원합니다.

- 드래그 앤 드롭 / 다중 파일 업로드
- 자동 파일 타입 감지 및 파이프라인 라우팅
- PaddleOCR (SageMaker) 텍스트 추출
- Bedrock Data Automation 문서 구조 분석 (선택)
- PDF 텍스트 레이어 추출 (pypdf)
- 음성/영상 트랜스크립션 (AWS Transcribe)

| 파일 타입 | 지원 포맷 | 전처리 |
|-----------|-----------|--------|
| 문서 | PDF, DOC, TXT | PaddleOCR + BDA (선택) + PDF 텍스트 추출 |
| 이미지 | PNG, JPG, GIF, TIFF | PaddleOCR + BDA (선택) |
| 영상 | MP4, MOV, AVI | AWS Transcribe + BDA (선택) |
| 음성 | MP3, WAV, FLAC | AWS Transcribe |

<p align="center">
  <img src="../assets/features-upload.gif" alt="Document Upload" width="800">
</p>

---

## 3. AI 분석 파이프라인

업로드된 문서는 Step Functions 워크플로우를 통해 자동으로 분석됩니다. Strands SDK 기반의 ReAct Agent가 세그먼트별로 반복적 질문-응답 방식의 심층 분석을 수행합니다.

- 세그먼트별 심층 분석 (Claude Sonnet 4.5 Vision ReAct Agent)
- 영상 분석 (TwelveLabs Pegasus 1.2)
- 문서 요약 생성 (Claude Haiku 4.5)
- 벡터 임베딩 및 저장 (Nova Embed 1024d → LanceDB)
- 재분석 / Q&A 재생성 / Q&A 추가 및 삭제

```
문서 업로드
  → 전처리 (OCR, BDA, Transcribe)
    → 세그먼트 분할
      → Distributed Map (최대 30 동시 실행)
        → ReAct Agent 분석 (세그먼트별)
          → 벡터 임베딩 → LanceDB 저장
      → 문서 요약 생성
```

> 상세 분석 흐름은 [AI Analysis Pipeline](../analysis/ANALYSIS_ko.md)을 참고하세요.

<p align="center">
  <img src="../assets/features-analysis.gif" alt="AI Analysis Pipeline" width="800">
</p>

---

## 4. 실시간 알림

워크플로우 진행 상태를 WebSocket을 통해 실시간으로 프론트엔드에 전달합니다. DynamoDB Streams가 상태 변경을 감지하고, Redis에서 활성 연결을 조회하여 WebSocket API로 이벤트를 푸시합니다.

- 단계별 시작/완료/에러 알림
- 세그먼트 분석 진행률 (X/Y 완료)
- 워크플로우 시작/완료/에러 알림
- 아티팩트 및 세션 생성 이벤트

<p align="center">
  <img src="../assets/features-realtime.gif" alt="Real-time Notifications" width="800">
</p>

---

## 5. 워크플로우 상세 보기

분석이 완료된 문서의 세그먼트별 결과를 상세하게 확인할 수 있습니다.

- 세그먼트별 OCR / BDA / PDF 텍스트 / AI 분석 결과 확인
- 영상 세그먼트 타임코드 기반 보기
- 트랜스크립션 세그먼트 확인
- Q&A 재생성 (커스텀 지시사항 적용)
- Q&A 추가 및 삭제
- 전체 문서 재분석

<p align="center">
  <img src="../assets/features-workflow-detail.gif" alt="Workflow Detail" width="800">
</p>

---

## 6. AI 채팅 (Agent Core)

Bedrock Agent Core 기반의 대화형 AI 인터페이스입니다. IDP Agent와 Research Agent가 MCP Gateway를 통해 문서 검색, 아티팩트 생성 등의 도구를 활용하며, 프로젝트에 업로드된 문서를 기반으로 질의응답을 수행합니다.

### 대화 기능

- 스트리밍 응답 및 도구 사용 과정 실시간 표시
- 이미지/문서 첨부 (멀티모달 입력)
- 마크다운 렌더링 및 코드 하이라이팅
- 세션 관리 (생성/이름변경/삭제, 대화 이력 보존)

### 하이브리드 검색

채팅 중 AI Agent가 자동으로 프로젝트 문서를 검색합니다.

- 벡터 검색 + 전문 검색 (FTS)
- 한국어 형태소 분석 (Kiwi)
- Cohere Rerank v3.5 결과 리랭킹

### 커스텀 에이전트

프로젝트별로 맞춤 에이전트를 생성하여 특화된 분석을 수행할 수 있습니다.

- 에이전트 이름 및 시스템 프롬프트 설정
- 에이전트 생성/수정/삭제
- 대화 중 에이전트 전환

### MCP 도구

| 도구 | 설명 |
|------|------|
| search_documents | 프로젝트 문서 하이브리드 검색 |
| save/load/edit_markdown | 마크다운 파일 생성 및 편집 |
| create_pdf, extract_pdf_text/tables | PDF 생성 및 텍스트/테이블 추출 |
| create_docx, extract_docx_text/tables | Word 문서 생성 및 텍스트/테이블 추출 |
| generate_image | AI 이미지 생성 |
| code_interpreter | Python 코드 실행 |

<p align="center">
  <img src="../assets/features-chat.gif" alt="AI Chat" width="800">
</p>

---

## 7. 아티팩트 관리

AI 채팅 중 에이전트가 생성한 파일(PDF, DOCX, 이미지, 마크다운 등)을 아티팩트 갤러리에서 관리합니다.

- 아티팩트 목록 조회 및 검색
- 인라인 미리보기 (이미지, PDF, 마크다운, HTML, DOCX)
- 다운로드 및 삭제
- 프로젝트별 필터링
- 원본 프로젝트로 이동

<p align="center">
  <img src="../assets/features-artifacts.gif" alt="Artifacts Management" width="800">
</p>

---

## 라이선스

이 프로젝트는 [Amazon Software License](../../LICENSE)의 하에 라이선스됩니다.
