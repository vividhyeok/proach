# Proach – PyQt6 Presentation Coach

Proach는 **슬라이드별 발표 연습**을 도와주는 데스크톱 코치입니다. 각 슬라이드마다 여러 번 녹음하고, 원하는 트(1트, 2트, N트)를 골라 **ElevenLabs Scribe v1**로 전사한 뒤, 간단한 규칙 기반 피드백을 받을 수 있습니다.

---

## 주요 기능 (MVP)

- **세션 관리**: 발표 한 번을 하나의 *세션*으로 관리하고, 세션 안에서 여러 슬라이드를 구성합니다. 메뉴의 **File → New session**으로 새 세션을 만들고, **File → Open session**으로 기존 `session.json`을 불러올 수 있습니다.
- **슬라이드별 녹음**: 각 슬라이드마다 여러 번(1트, 2트, 3트…) 녹음하고 WAV 파일로 저장합니다.
- **Scribe v1 전사**: 특정 트를 선택해 버튼 한 번으로 ElevenLabs Scribe v1에 전사 요청을 보내고, 결과 텍스트를 UI에서 바로 확인할 수 있습니다.
- **간단 피드백**: 슬라이드 노트에 적어둔 키워드가 얼마나 포함됐는지, 말한 시간이 너무 짧은지/긴지 등을 규칙 기반으로 체크해 줍니다.

향후에는 여러 트를 합쳐 **베스트 스크립트**를 만들고, 실전 모드에서 **실시간 전사 + 자동 슬라이드 넘김**까지 확장할 수 있도록 설계되어 있습니다.

---

## 화면 구성 개요

- **좌측 패널**
  - 슬라이드 리스트 (번호 + 제목) + [Add slide]/[Delete]
  - 선택된 슬라이드의 제목 편집, 노트/키워드 입력 영역
- **중앙 패널**
  - [녹음 시작] / [정지] 버튼
  - 현재 녹음 상태 표시 (Idle, Recording 등)
- **우측 패널**
  - 선택된 슬라이드의 Take 목록 (Take 번호 + 길이)
  - 선택한 Take의 전사 텍스트 뷰
  - [이 트 전사+분석] 버튼 및 분석 결과 뷰

---

## 내부 구조 (간단 설명)

- `core/models.py`
  - `Session`, `Slide`, `Take` 데이터 모델 정의
  - 슬라이드별/트별 관리, "슬라이드 3의 2트만 분석" 같은 요구를 쉽게 처리할 수 있도록 설계
- `core/recorder.py`
  - `sounddevice` 기반 마이크 녹음 로직
  - `Recorder.start(output_path)` / `Recorder.stop() -> duration_sec` 인터페이스 제공
- `core/transcriber.py`
  - ElevenLabs Python SDK를 사용해 Scribe v1 STT 호출
  - `.env`의 `ELEVENLABS_API_KEY`를 자동 로드
- `core/storage.py`
  - 세션/슬라이드/테이크 정보를 `sessions/<session_id>/session.json` 등으로 저장/로드
  - `slide_01_take_01.wav`, `slide_01_take_01.json` 같은 파일명 규칙 관리
- `core/analysis.py`
  - 노트 키워드 포함 여부, 길이(짧음/적당/김)를 간단히 평가하는 규칙 기반 분석 엔진
- `ui/main_window.py`, `ui/practice_view.py`
  - 위의 코어 모듈들을 PyQt6 UI로 묶어주는 역할

---

## Project Layout
```
Proach/
  proach/
    __init__.py
    main.py
    core/
      models.py
      recorder.py
      transcriber.py
      storage.py
      analysis.py
    ui/
      main_window.py
      practice_view.py
    sessions/
  .env.example
  requirements.txt
  README.md
```

## Getting Started

### 1. Git 저장소 가져오기 (clone)

원하는 폴더에서 다음 명령으로 저장소를 내려받습니다. (아래 URL은 예시이므로 실제 Git 리포지터리 주소로 바꿔 사용하세요.)

```powershell
git clone <YOUR_REPO_URL> Proach
cd Proach
```

### 2. 가상환경 생성 및 활성화 (Python 3.11 권장)

```powershell
python -m venv .venv
\.venv\Scripts\activate
```

### 3. 의존성 설치

```powershell
pip install -r requirements.txt
```

### 4. 환경변수 설정 (.env)

루트 폴더(`Proach/`)에서 예시 파일을 복사한 뒤, ElevenLabs API 키를 채웁니다.

```powershell
copy .env.example .env
```

`.env` 파일을 열어 다음 값을 채워 주세요.

```env
ELEVENLABS_API_KEY=여기에_본인_API_키
DEFAULT_LANGUAGE_CODE=kor
```

### 5. 애플리케이션 실행

항상 **루트 폴더(Proach)** 기준에서 모듈 실행을 해야 합니다.

```powershell
cd Proach   # 이미 그 안에 있다면 생략
\.venv\Scripts\activate   # 가상환경이 꺼져 있다면 다시 활성화
python -m proach.main
```

처음 실행 시 `proach/sessions/` 아래에 세션 폴더가 자동으로 생성됩니다. 좌측 리스트에서 슬라이드를 선택하고, 중앙의 [녹음 시작]/[정지] 버튼으로 슬라이드별 연습을 한 뒤, 우측에서 원하는 트를 골라 전사/분석을 실행할 수 있습니다.

## Tips & Next Steps

- 실제 연습 데이터(녹음 파일, 전사/분석 결과)는 기본적으로 `proach/sessions/<session_id>/` 아래에 저장됩니다. 필요하다면 `.gitignore`에 해당 경로를 추가해 Git에 올리지 않아도 됩니다.
- 규칙 기반 분석 로직은 `core/analysis.py`에 있습니다. 여기만 교체하면 LLM 기반 피드백으로 쉽게 확장할 수 있습니다.
- `ui/practice_view.py`를 확장하면, 범위 분석(예: 슬라이드 1~5의 마지막 트만 모아서 분석)이나 라이브 모드 UI를 추가해도 코어 로직과 잘 분리된 구조를 유지할 수 있습니다.
