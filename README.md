# Proach - AI Pitch Coach (React + TypeScript + Vite)

Proach는 현대 웹 스택만을 이용해 당신의 피치를 녹음하고, ElevenLabs의 Speech-to-Text API(SST 모델)로 실시간 텍스트 변환을 제공합니다. 추가로 Deepseek Chat API를 연동해 여러 번의 녹음본을 통합한 정돈된 대본 생성, 최종 리허설과의 싱크 분석, 다음 내용 프롬프트 출력을 지원합니다.

이 프로젝트는 Python/Flask 없이 100% 클라이언트 기반(React + Vite + Tailwind + TypeScript)으로 동작합니다.

---

## 기술 스택
- **UI/로직**: React, TypeScript
- **스타일링**: Tailwind CSS
- **빌드/번들러**: Vite
- **음성 인식**: ElevenLabs Speech-to-Text API ([elevenlabs-js](https://www.npmjs.com/package/@elevenlabs/elevenlabs-js))
- **대본/싱크 코칭**: Deepseek Chat API

---


## 사전 준비 사항
- Node.js (v18 이상 권장)
- npm (Node.js 설치시 자동 포함)
- [ElevenLabs API Key](https://elevenlabs.io/docs/api-reference/authentication)
- [Deepseek API Key](https://platform.deepseek.com/)

---

## 환경설정 및 실행 방법

1. `.env.example` 파일을 복사해 `.env`로 이름을 바꾼 뒤, 실제 ElevenLabs/Deepseek API 키를 입력하세요.
	```bash
	cp .env.example .env
	# 또는 윈도우에서는 파일 복사 후 이름 변경
	```
2. 의존성 설치
	```bash
	npm install
	```
3. 개발 서버 실행
	```bash
	npm run dev
	```

### 환경변수 설명 (최소 1개)
- `VITE_ELEVENLABS_API_KEY` : ElevenLabs API Key (반드시 입력)
- `VITE_DEEPSEEK_API_KEY` : Deepseek API Key (Deepseek 대본/싱크 기능 사용 시 필수)
- `VITE_DEEPSEEK_MODEL` : (선택) 사용할 Deepseek 모델명, 기본값 `deepseek-chat`
- `VITE_DEEPSEEK_API_URL` : (선택) API 엔드포인트 오버라이드

> 보안을 위해 `.env` 파일은 절대 커밋하지 마세요. 실제 키는 노출되지 않도록 관리하세요.

---

## 설치 및 환경설정

1. **프로젝트 복제 및 이동**
