import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { usePresentations, Presentation } from '../hooks/usePresentations';
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { deepseekChat, extractJsonBlock } from '../utils/deepseek';
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

// Web Speech API 타입 정의
declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

declare var SpeechRecognition: {
  prototype: SpeechRecognition;
  new(): SpeechRecognition;
};

interface SlidePracticeStepProps {
  presentation: Presentation;
  onBack: () => void;
}

const SlidePracticeStep: React.FC<SlidePracticeStepProps> = ({ presentation, onBack }) => {
  const { update } = usePresentations();
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState<number>(presentation.pageCount);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [practiceMode, setPracticeMode] = useState<'draft' | 'final'>('draft');
  const [alignmentFeedback, setAlignmentFeedback] = useState<string | null>(null);
  const [latestTranscript, setLatestTranscript] = useState<string>('');
  const [scriptStatus, setScriptStatus] = useState<string | null>(null);
  const [liveSyncStatus, setLiveSyncStatus] = useState<string | null>(null);
  const [fullScriptStatus, setFullScriptStatus] = useState<string | null>(null);
  const [panel, setPanel] = useState<'record' | 'ai' | 'history' | 'fullScript'>('record');
  const [editingTakeId, setEditingTakeId] = useState<string | null>(null);
  const [editingTranscript, setEditingTranscript] = useState('');
  // 다중 트라이 선택 상태
  const [selectedTakeIds, setSelectedTakeIds] = useState<string[]>([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);

  // 로딩 상태 확인 헬퍼 함수들
  const isStatusLoading = (statusText: string | null) => {
    if (!statusText) return false;
    return statusText.includes('중...') || statusText.includes('요청 중') || statusText.includes('분석 중');
  };

  const isTranscribing = status.includes('텍스트 변환 중') || status.includes('오디오 처리 중');
  const isScriptGenerating = isStatusLoading(scriptStatus);
  const isLiveSyncAnalyzing = isStatusLoading(liveSyncStatus);
  const isFullScriptGenerating = isStatusLoading(fullScriptStatus);

  // 로딩 스피너 컴포넌트
  const LoadingSpinner = ({ size = 'sm', color = 'purple' }: { size?: 'xs' | 'sm' | 'md'; color?: 'purple' | 'blue' | 'green' }) => {
    const sizeClasses = {
      xs: 'w-3 h-3',
      sm: 'w-4 h-4',
      md: 'w-6 h-6'
    };

    const colorClasses = {
      purple: 'border-purple-400',
      blue: 'border-blue-400',
      green: 'border-green-400'
    };

    return (
      <div className={`inline-block animate-spin rounded-full border-2 border-solid border-current border-r-transparent ${sizeClasses[size]} ${colorClasses[color]}`} />
    );
  };

  // 로딩 텍스트 컴포넌트
  const LoadingText = ({ text, isLoading }: { text: string; isLoading: boolean }) => (
    <div className="flex items-center gap-2">
      {isLoading && <LoadingSpinner size="xs" />}
      <span className={isLoading ? 'text-purple-300' : 'text-slate-400'}>{text}</span>
    </div>
  );

  // 트라이 체크박스 토글
  const handleToggleTakeSelect = (takeId: string) => {
    setSelectedTakeIds((prev) =>
      prev.includes(takeId)
        ? prev.filter((id) => id !== takeId)
        : [...prev, takeId]
    );
  };
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  // 오디오 재생 상태 관리
  const [playingTakeId, setPlayingTakeId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 실시간 음성 인식 상태
  const [isRealtimeListening, setIsRealtimeListening] = useState(false);
  const [realtimeTranscript, setRealtimeTranscript] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const currentSlide = presentation.slides[currentPage - 1] || {
    page: currentPage,
    notes: '',
    takes: []
  };

  const guideTake = currentSlide.takes.find(take => take.isBest);
  const guideScript = guideTake?.transcript || currentSlide.curatedScript || currentSlide.notes;

  // 유튜브 가사 스타일: 현재 문장만 하이라이트
  const getCurrentSentenceSyncedHtml = useMemo(() => {
    if (!guideScript) return '';
    // 문장 단위로 분할 (한글/영문 모두 지원)
    const sentences = guideScript.match(/[^.!?\n]+[.!?]?/g) || [guideScript];
    if (!latestTranscript && currentSentenceIndex === 0) {
      // 전사가 없으면 첫 문장만 하이라이트
      return sentences.map((s, i) =>
        i === 0
          ? `<mark style=\"background:#a78bfa;color:#4c1d95;font-weight:bold;\">${s}</mark>`
          : `<span>${s}</span>`
      ).join(' ');
    }
    // 실시간 싱크나 기존 전사를 기반으로 하이라이트
    const highlightIndex = currentSentenceIndex > 0 ? currentSentenceIndex : 0;
    return sentences.map((s, i) =>
      i === highlightIndex
        ? `<mark style=\"background:#a78bfa;color:#4c1d95;font-weight:bold;\">${s}</mark>`
        : `<span>${s}</span>`
    ).join(' ');
  }, [guideScript, latestTranscript, currentSentenceIndex]);

  const cloneSlidesWithCurrent = () => {
    const updatedSlides = [...presentation.slides];
    if (!updatedSlides[currentPage - 1]) {
      updatedSlides[currentPage - 1] = { page: currentPage, notes: '', takes: [] };
    }
    return updatedSlides;
  };

  useEffect(() => {
    setAlignmentFeedback(null);
    setLatestTranscript('');
    setScriptStatus(null);
    setLiveSyncStatus(null);
  }, [practiceMode, currentPage]);

  useEffect(() => {
    if (!presentation.pdfData) {
      setPdfError('PDF 데이터가 없습니다.');
    }
  }, [presentation.pdfData]);

  const handleLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPdfError(null);
    update(presentation.id, { pageCount: numPages });
  };

  const handleLoadError = (error: Error) => {
    console.error('PDF 로드 오류:', error);
    setPdfError('PDF 파일을 로드할 수 없습니다. 파일 형식을 확인해주세요.');
  };

  const handleStartRecording = async () => {
    console.log('🎤 Starting recording process...');
    if (!import.meta.env.VITE_ELEVENLABS_API_KEY) {
      console.error('❌ ElevenLabs API key not found');
      setStatus('Error: ElevenLabs API key is not set.');
      return;
    }

    setStatus('마이크 접근 요청 중...');
    try {
      console.log('🎙️ Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        }
      });
      console.log('✅ Microphone access granted');
      setIsRecording(true);
      setStatus(practiceMode === 'final' ? '최종 리허설 녹음 중...' : '대본 구축 녹음 중...');
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          console.log('📦 Audio chunk received:', event.data.size, 'bytes');
          audioChunks.current.push(event.data);
        }
      };

      mediaRecorder.current.onstop = handleStopRecording;
      mediaRecorder.current.start(1000);
      console.log('🎬 MediaRecorder started');
    } catch (error) {
      console.error("❌ Error accessing microphone:", error);
      setStatus('마이크 접근 실패');
    }
  };

  const handleStopRecording = async () => {
    console.log('🛑 Stopping recording...');
    if (mediaRecorder.current && isRecording) {
      console.log('🎬 Stopping MediaRecorder');
      mediaRecorder.current.stop();
      mediaRecorder.current.stream.getTracks().forEach(track => {
        console.log('🔇 Stopping track:', track.label);
        track.stop();
      });
      setIsRecording(false);
      setStatus('오디오 처리 중...');

      if (audioChunks.current.length > 0) {
        console.log('📦 Creating audio blob from', audioChunks.current.length, 'chunks');
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        console.log('🎵 Audio blob created:', audioBlob.size, 'bytes');
        await transcribeAudio(audioBlob);
      } else {
        console.warn('⚠️ No audio chunks recorded');
        setStatus('녹음된 오디오가 없습니다');
      }
    } else {
      console.warn('⚠️ No active recording to stop');
    }
  };

  const normalizeText = (text: string) => text
    .toLowerCase()
    .replace(/[^a-z0-9\uAC00-\uD7A3\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const generateAlignmentFeedback = (spoken: string, guide?: string) => {
    if (!guide || guide.trim().length === 0) {
      return '가이드 스크립트를 먼저 선택하거나 노트에 핵심 문장을 작성해 주세요.';
    }

    const spokenWords = normalizeText(spoken);
    const guideWords = normalizeText(guide);

    if (guideWords.length === 0) {
      return '가이드 스크립트가 비어있습니다. 노트를 채워주세요.';
    }

    const matchCount = guideWords.filter(word => spokenWords.includes(word)).length;
    const coverage = Math.min(100, Math.round((matchCount / guideWords.length) * 100));
    const delta = spokenWords.length - guideWords.length;
    const uniqueGuideWords = Array.from(new Set(guideWords.filter(word => word.length > 2)));
    const missingKeywords = uniqueGuideWords
      .filter(word => !spokenWords.includes(word))
      .slice(0, 3);

    let message = `가이드 대비 약 ${coverage}%를 커버했습니다. `;
    if (delta > 5) {
      message += '설명이 다소 길어졌어요. 핵심만 간결하게 정리해보세요.';
    } else if (delta < -5) {
      message += '설명이 짧았습니다. 강조할 포인트를 더 설명해보세요.';
    } else {
      message += '길이 밸런스가 좋습니다. 안정적인 흐름을 유지해보세요.';
    }

    if (missingKeywords.length) {
      message += ` 빠진 키워드: ${missingKeywords.join(', ')}`;
    }

    return message;
  };

  // 선택된 트라이만 Deepseek 입력용 포맷
  const formatTakesForPrompt = () => {
    const takes = selectedTakeIds.length > 0
      ? currentSlide.takes.filter(t => selectedTakeIds.includes(t.id))
      : currentSlide.takes;
    return takes
      .map((take, index) => {
        const label = `${index + 1}트 (${take.mode === 'final' ? '최종' : '대본'}${take.modelId ? ` · ${take.modelId}` : ''})`;
        return `${label}\n${take.transcript || '[텍스트 없음]'}`;
      })
      .join('\n----\n');
  };

  const handleGenerateCuratedScript = async () => {
    if (!currentSlide.takes.length) {
      setScriptStatus('녹음본이 없습니다. 한 번 이상 녹음해 주세요.');
      return;
    }

    setScriptStatus('Deepseek에 대본 정리를 요청 중...');
    try {
      const prompt = formatTakesForPrompt();
      console.log('Sending prompt to Deepseek:', prompt);
      const content = await deepseekChat([
        {
          role: 'system',
          content: '당신은 발표 코치입니다. 여러 번의 녹음 텍스트를 취합해 구조화된 최종 스크립트를 제안합니다.',
        },
        {
          role: 'user',
          content:
            '다음은 같은 슬라이드를 설명한 여러 번의 녹음 텍스트입니다. ' +
            '중복을 제거하고 핵심을 유지한 정돈된 대본을 한국어로 작성해 주세요. ' +
            '응답은 JSON으로 주세요. keys: script (문단 형태), keyPoints (문장 배열), coachNote (한줄 팁).\n\n' +
            prompt,
        },
      ], { responseFormat: 'json', temperature: 0.35 });

      console.log('Deepseek response:', content);
      const parsed = extractJsonBlock(content);
      console.log('Parsed JSON:', parsed);
      const curatedScript = parsed?.script || content;
      console.log('Final curatedScript:', curatedScript);

      if (!curatedScript || curatedScript.trim().length === 0) {
        setScriptStatus('대본 생성에 실패했습니다. 다시 시도해주세요.');
        return;
      }

      const keyPoints: string[] | undefined = parsed?.keyPoints || parsed?.outline;

      const updatedSlides = cloneSlidesWithCurrent();
      updatedSlides[currentPage - 1] = {
        ...updatedSlides[currentPage - 1],
        curatedScript: curatedScript.trim(),
        curatedScriptMeta: {
          generatedAt: Date.now(),
          sourceTakeIds: currentSlide.takes.map((take) => take.id),
          keyPoints,
        },
      };
      update(presentation.id, { slides: updatedSlides });
      console.log('Updated slides:', updatedSlides[currentPage - 1]);
      setScriptStatus('정돈된 대본이 저장되었습니다.');
    } catch (error) {
      console.error('Deepseek script error:', error);
      setScriptStatus(`오류: ${(error as Error).message}`);
    }
  };

  const runLiveSyncAnalysis = async (
    spoken: string,
    script: string,
    baseSlides?: Presentation['slides'],
  ) => {
    if (!spoken.trim()) {
      setLiveSyncStatus('비교할 전사가 없습니다.');
      return;
    }
    setLiveSyncStatus('Deepseek 싱크 분석 중...');
    try {
      const content = await deepseekChat([
        {
          role: 'system',
          content: '당신은 발표 리허설 코치입니다. 실시간 전사와 이상적인 대본을 비교해 다음 대본을 제안합니다.',
        },
        {
          role: 'user',
          content:
            '이상적인 대본과 실제 발화를 비교해 주세요. ' +
            'JSON으로 {"alignmentSummary": "..", "missingPoints": "..", "nextLines": [".."]} 형태로 답변하세요.\n' +
            `대본:\n${script}\n\n실제 발화:\n${spoken}`,
        },
      ], { responseFormat: 'json', temperature: 0.2 });

      const parsed = extractJsonBlock(content);
      const summary = parsed?.alignmentSummary || parsed?.summary || content;
      const missingRaw = parsed?.missingPoints || parsed?.missingKeywords || parsed?.delta;
      const nextLinesRaw = parsed?.nextLines || parsed?.nextPhrases || parsed?.nextScript;

      const missingAsText = Array.isArray(missingRaw)
        ? missingRaw.join(', ')
        : (missingRaw as string | undefined);
      const nextLines = Array.isArray(nextLinesRaw)
        ? nextLinesRaw
        : typeof nextLinesRaw === 'string'
          ? nextLinesRaw.split(/\n+/).filter(Boolean)
          : undefined;

      const slidesSource = baseSlides ?? presentation.slides;
      const updatedSlides = [...slidesSource];
      if (!updatedSlides[currentPage - 1]) {
        updatedSlides[currentPage - 1] = { page: currentPage, notes: '', takes: [] };
      }
      updatedSlides[currentPage - 1] = {
        ...updatedSlides[currentPage - 1],
        liveSyncPreview: {
          alignmentSummary: summary,
          missingPoints: missingAsText,
          nextLines,
          generatedAt: Date.now(),
        },
      };
      update(presentation.id, { slides: updatedSlides });
      setAlignmentFeedback(missingAsText ? `${summary} · ${missingAsText}` : summary);
      setLiveSyncStatus('싱크 분석 완료');
    } catch (error) {
      console.error('Deepseek live sync error:', error);
      setLiveSyncStatus(`오류: ${(error as Error).message}`);
    }
  };

  const handleManualLiveSync = () => {
    if (!currentSlide.curatedScript) {
      setLiveSyncStatus('먼저 Deepseek 대본을 생성해 주세요.');
      return;
    }
    const latest = latestTranscript || currentSlide.takes[currentSlide.takes.length - 1]?.transcript || '';
    if (!latest) {
      setLiveSyncStatus('비교할 전사가 없습니다. 녹음 후 다시 시도하세요.');
      return;
    }
    runLiveSyncAnalysis(latest, currentSlide.curatedScript);
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    console.log('🎤 Starting transcription for audio blob:', audioBlob.size, 'bytes');
    setStatus('텍스트 변환 중...');
    try {
      const elevenlabs = new ElevenLabsClient({
        apiKey: import.meta.env.VITE_ELEVENLABS_API_KEY as string,
      });

      const modelId = practiceMode === 'final' ? 'scribe_v2' : 'scribe_v1';
      console.log('📡 Calling ElevenLabs API with model:', modelId);

      const transcriptionResult = await elevenlabs.speechToText.convert({
        file: audioBlob,
        modelId,
        languageCode: 'ko',
      });

      console.log('📥 ElevenLabs response:', transcriptionResult);

      if (transcriptionResult && typeof transcriptionResult === 'object') {
        let fullText = '';

        if ('utterances' in transcriptionResult && Array.isArray((transcriptionResult as any).utterances)) {
          fullText = (transcriptionResult as any).utterances.map((u: any) => u.text).join(' ');
          console.log('📝 Extracted text from utterances:', fullText);
        } else if ('text' in transcriptionResult) {
          fullText = (transcriptionResult as any).text;
          console.log('📝 Extracted text from text field:', fullText);
        } else if (typeof transcriptionResult === 'string') {
          fullText = transcriptionResult;
          console.log('📝 Extracted text from string response:', fullText);
        }

        if (fullText) {
          console.log('✅ Full text extracted, creating take:', fullText.substring(0, 100) + '...');
          const feedback = practiceMode === 'final'
            ? generateAlignmentFeedback(fullText, guideScript)
            : undefined;

          const newTake = {
            id: Date.now().toString(),
            timestamp: Date.now(),
            audioUrl: URL.createObjectURL(audioBlob),
            transcript: fullText,
            isBest: false,
            mode: practiceMode,
            modelId,
            takeNumber: currentSlide.takes.length + 1,
            feedback,
          };

          console.log('💾 Saving new take:', newTake.id, 'take number:', newTake.takeNumber);

          const slidesWithNewTake = cloneSlidesWithCurrent();
          slidesWithNewTake[currentPage - 1].takes.push(newTake);

          update(presentation.id, { slides: slidesWithNewTake });
          setStatus('녹음 완료!');
          setLatestTranscript(fullText);
          setAlignmentFeedback(feedback ?? null);

          if (practiceMode === 'final' && currentSlide.curatedScript) {
            await runLiveSyncAnalysis(fullText, currentSlide.curatedScript, slidesWithNewTake);
          }

          console.log('✅ Take saved successfully, total takes now:', slidesWithNewTake[currentPage - 1].takes.length);
        } else {
          console.error('❌ No text extracted from transcription result');
          setStatus('음성 인식 실패 - 변환된 텍스트 없음');
        }
      } else {
        console.error('❌ Invalid transcription result format:', transcriptionResult);
        setStatus('음성 인식 실패 - 응답 형식 오류');
      }
    } catch (error) {
      console.error("❌ Transcription error:", error);
      setStatus('텍스트 변환 실패');
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      handleStopRecording();
    } else {
      handleStartRecording();
    }
  };

  const handleMarkBest = (takeId: string) => {
    const updatedSlides = cloneSlidesWithCurrent();

    const currentTakes = updatedSlides[currentPage - 1].takes;
    const target = currentTakes.find(t => t.id === takeId);
    const willBeBest = target ? !target.isBest : true;

    updatedSlides[currentPage - 1].takes = currentTakes.map(take => ({
      ...take,
      isBest: take.id === takeId ? willBeBest : false,
    }));

    update(presentation.id, { slides: updatedSlides });
  };

  // 오디오 재생/정지 토글
  const handlePlayPauseTake = (take: any) => {
    if (playingTakeId === take.id) {
      // 정지
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlayingTakeId(null);
      audioRef.current = null;
    } else {
      // 새로 재생
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      const audio = new window.Audio(take.audioUrl);
      audioRef.current = audio;
      setPlayingTakeId(take.id);
      audio.play();
      audio.onended = () => {
        setPlayingTakeId(null);
        audioRef.current = null;
      };
    }
  };

  const handleDeleteTake = (takeId: string) => {
    const updatedSlides = cloneSlidesWithCurrent();
    const currentTakes = updatedSlides[currentPage - 1].takes.filter(t => t.id !== takeId);

    updatedSlides[currentPage - 1].takes = currentTakes.map((take, index) => ({
      ...take,
      takeNumber: index + 1,
    }));

    if (editingTakeId === takeId) {
      setEditingTakeId(null);
      setEditingTranscript('');
    }

    const latest = currentTakes.reduce((latestTake, take) =>
      take.timestamp > (latestTake?.timestamp ?? 0) ? take : latestTake,
    undefined as typeof currentTakes[number] | undefined);

    setLatestTranscript(latest?.transcript ?? '');

    update(presentation.id, { slides: updatedSlides });
  };

  const handleEditTranscript = (takeId: string) => {
    setEditingTakeId(takeId);
    setEditingTranscript(currentSlide.takes.find(t => t.id === takeId)?.transcript || '');
  };

  const handleSaveTranscript = (takeId: string) => {
    const updatedSlides = cloneSlidesWithCurrent();
    const currentTakes = updatedSlides[currentPage - 1].takes.map(take =>
      take.id === takeId ? { ...take, transcript: editingTranscript } : take
    );

    updatedSlides[currentPage - 1].takes = currentTakes;
    update(presentation.id, { slides: updatedSlides });

    const latest = currentTakes.reduce((latestTake, take) =>
      take.timestamp > (latestTake?.timestamp ?? 0) ? take : latestTake,
    undefined as typeof currentTakes[number] | undefined);
    if (latest && latest.id === takeId) {
      setLatestTranscript(editingTranscript);
    }

    setEditingTakeId(null);
    setEditingTranscript('');
  };

  const handleGenerateFullScript = async () => {
    const slidesWithScripts = presentation.slides.filter(slide => slide.curatedScript);
    if (slidesWithScripts.length === 0) {
      setFullScriptStatus('정돈된 대본이 있는 슬라이드가 없습니다. 먼저 각 슬라이드에서 대본을 생성해 주세요.');
      return;
    }

    setFullScriptStatus('전체 프레젠테이션 대본 생성 중...');
    try {
      const fullScriptContent = slidesWithScripts
        .map((slide) => `슬라이드 ${slide.page}:\n${slide.curatedScript}`)
        .join('\n\n----\n\n');

      const content = await deepseekChat([
        {
          role: 'system',
          content: '당신은 발표 코치입니다. 전체 프레젠테이션의 슬라이드별 대본을 종합해 일관성 있고 자연스러운 전체 발표 대본을 만듭니다.',
        },
        {
          role: 'user',
          content:
            '다음은 각 슬라이드의 정돈된 대본입니다. 이를 종합해 전체 프레젠테이션에 적합한 자연스러운 발표 대본을 만들어 주세요. ' +
            '슬라이드 간 전환을 자연스럽게 연결하고, 전체적인 흐름을 고려하세요.\n\n' +
            fullScriptContent,
        },
      ], { responseFormat: 'text', temperature: 0.3 });

      const updatedPresentation = {
        ...presentation,
        fullScript: content.trim(),
        fullScriptGeneratedAt: Date.now(),
      };
      update(presentation.id, updatedPresentation);
      setFullScriptStatus('전체 프레젠테이션 대본이 생성되었습니다.');
    } catch (error) {
      console.error('Full script generation error:', error);
      setFullScriptStatus(`오류: ${(error as Error).message}`);
    }
  };

  // 실시간 음성 인식 시작/중지
  const toggleRealtimeListening = () => {
    if (isRealtimeListening) {
      stopRealtimeListening();
    } else {
      startRealtimeListening();
    }
  };

  const stopRealtimeListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsRealtimeListening(false);
    setStatus('실시간 발표 연습 중지됨');
  };

  const startRealtimeListening = () => {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      alert('이 브라우저는 실시간 음성 인식을 지원하지 않습니다.');
      return;
    }

    // 실시간 발표 연습에서는 별도의 녹음 없이 진행
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = true;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.lang = 'ko-KR'; // 한국어 설정

    recognitionRef.current.onstart = () => {
      setIsRealtimeListening(true);
      setRealtimeTranscript('');
      setStatus('실시간 발표 연습 중...');
    };

    recognitionRef.current.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      const currentTranscript = finalTranscript + interimTranscript;
      setRealtimeTranscript(currentTranscript);

      // 실시간 싱크 업데이트
      if (currentTranscript.trim() && guideScript) {
        // 실시간으로 싱크 맞추기 (간단 버전)
        const sentences = guideScript.match(/[^.!?\n]+[.!?]?/g) || [guideScript];
        const norm = (t: string) => t.replace(/[^\w가-힣\s]/g, '').toLowerCase();
        const transcriptNorm = norm(currentTranscript);
        let bestIdx = 0;
        let bestScore = 0;

        sentences.forEach((sent, idx) => {
          const sentNorm = norm(sent);
          const sentWords = sentNorm.split(/\s+/).filter(Boolean);
          const transcriptWords = transcriptNorm.split(/\s+/).filter(Boolean);
          const matchCount = sentWords.filter(w => transcriptWords.includes(w)).length;
          if (matchCount > bestScore) {
            bestScore = matchCount;
            bestIdx = idx;
          }
        });

        // 현재 문장 인덱스 업데이트
        setCurrentSentenceIndex(bestIdx);
      }
    };

    recognitionRef.current.onend = () => {
      setIsRealtimeListening(false);
      setStatus('실시간 발표 연습 완료');

      // 실시간 전사 결과를 녹음본으로 저장
      if (realtimeTranscript.trim()) {
        saveRealtimeTranscriptAsTake(realtimeTranscript);
      }
    };

    recognitionRef.current.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      setStatus(`음성 인식 오류: ${event.error}`);
      setIsRealtimeListening(false);
    };

    recognitionRef.current.start();
  };

  const saveRealtimeTranscriptAsTake = (transcript: string) => {
    console.log('🎙️ Saving realtime transcript:', transcript.substring(0, 100) + '...');
    if (!transcript.trim()) {
      console.warn('⚠️ Empty transcript, skipping save');
      return;
    }

    const feedback = practiceMode === 'final' && guideScript
      ? generateAlignmentFeedback(transcript, guideScript)
      : undefined;

    const newTake = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      audioUrl: '', // 실시간 모드에서는 오디오 파일 없음
      transcript: transcript.trim(),
      isBest: false,
      mode: practiceMode,
      modelId: 'realtime-speech-api', // 실시간 음성 API 표시
      takeNumber: currentSlide.takes.length + 1,
      feedback,
    };

    console.log('💾 Creating realtime take:', newTake.id, 'take number:', newTake.takeNumber);

    const slidesWithNewTake = cloneSlidesWithCurrent();
    slidesWithNewTake[currentPage - 1].takes.push(newTake);

    console.log('📝 Updating presentation with new take, total takes will be:', slidesWithNewTake[currentPage - 1].takes.length);

    update(presentation.id, { slides: slidesWithNewTake });
    setLatestTranscript(transcript);
    setAlignmentFeedback(feedback ?? null);

    if (practiceMode === 'final' && currentSlide.curatedScript) {
      runLiveSyncAnalysis(transcript, currentSlide.curatedScript, slidesWithNewTake);
    }

    console.log('✅ Realtime take saved successfully');
  };

  const handleUseCuratedAsNotes = () => {
    if (!currentSlide.curatedScript) return;
    const updatedSlides = cloneSlidesWithCurrent();
    updatedSlides[currentPage - 1].notes = currentSlide.curatedScript;
    update(presentation.id, { slides: updatedSlides });
  };

  const handleDownloadScript = (script: string, filename: string) => {
    const blob = new Blob([script], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleNotesChange = (notes: string) => {
    const updatedSlides = cloneSlidesWithCurrent();
    updatedSlides[currentPage - 1].notes = notes;
    update(presentation.id, { slides: updatedSlides });
  };

  const pdfFile = presentation.pdfData;

  return (
    <div className="p-8 md:p-10 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm text-slate-400">Step 2 · 슬라이드 연습</p>
          <h2 className="text-2xl md:text-3xl font-bold text-white">{presentation.name}</h2>
          <p className="text-xs text-slate-500">PDF · {presentation.pdfName}</p>
        </div>
        <button
          onClick={onBack}
          className="text-sm px-3 py-2 rounded-xl border border-slate-700 text-slate-300 hover:text-white hover:border-purple-400"
        >
          목록으로 돌아가기
        </button>
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
        <div className="space-y-4">
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <span className="px-2 py-1 rounded-full bg-purple-500/20 text-purple-100">슬라이드 {currentPage}</span>
                <span className="px-2 py-1 rounded-full bg-slate-800 text-slate-300">총 {numPages}p</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-40"
                >
                  이전
                </button>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(numPages, prev + 1))}
                  disabled={currentPage === numPages}
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-40"
                >
                  다음
                </button>
              </div>
            </div>
            <div className="bg-white rounded-xl p-2 min-h-[480px] flex items-center justify-center shadow-inner">
              {pdfError ? (
                <div className="text-red-500 text-center">
                  <p>{pdfError}</p>
                  <p className="text-sm text-gray-600 mt-2">PDF 파일을 다시 업로드해주세요.</p>
                </div>
              ) : (
                <Document
                  file={pdfFile}
                  onLoadSuccess={handleLoadSuccess}
                  onLoadError={handleLoadError}
                  loading={
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                      <LoadingSpinner size="md" color="blue" />
                      <p className="text-gray-600 text-sm">PDF 로딩 중...</p>
                    </div>
                  }
                >
                  <Page
                    pageNumber={currentPage}
                    width={540}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                </Document>
              )}
            </div>
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: 'record', label: '녹음 · 노트' },
              { key: 'ai', label: 'AI 코칭' },
              { key: 'history', label: '녹음 기록' },
              { key: 'fullScript', label: '전체 대본' }
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPanel(key as typeof panel)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold border transition ${
                  panel === key
                    ? 'border-purple-400 bg-purple-500/15 text-purple-100'
                    : 'border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {panel === 'record' && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-slate-300 mb-2 font-semibold">연습 모드</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPracticeMode('draft')}
                    className={`px-3 py-3 rounded-xl text-sm border transition text-left ${practiceMode === 'draft'
                      ? 'bg-purple-600/80 border-purple-400 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-300'}`}
                  >
                    <div className="font-semibold">1~N트 대본 구축</div>
                    <p className="text-[11px] text-purple-100/80">Scribe v1 · 소음 환경 대응</p>
                  </button>
                  <button
                    onClick={() => setPracticeMode('final')}
                    className={`px-3 py-3 rounded-xl text-sm border transition text-left ${practiceMode === 'final'
                      ? 'bg-purple-600/80 border-purple-400 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-300'}`}
                  >
                    <div className="font-semibold">최종 리허설</div>
                    <p className="text-[11px] text-purple-100/80">Scribe v2 Realtime</p>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={practiceMode === 'draft' ? toggleRecording : toggleRealtimeListening}
                    disabled={
                      practiceMode === 'draft'
                        ? status.includes('처리') || status.includes('변환') || isRealtimeListening
                        : isRecording
                    }
                    className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                      practiceMode === 'draft'
                        ? (isRecording
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-purple-600 hover:bg-purple-700')
                        : (isRealtimeListening
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-green-600 hover:bg-green-700')
                    }`}
                  >
                    {practiceMode === 'draft' ? (
                      isTranscribing ? (
                        <>
                          <LoadingSpinner size="xs" color="purple" />
                          처리 중...
                        </>
                      ) : isRecording ? (
                        '녹음 중지'
                      ) : (
                        '녹음 시작'
                      )
                    ) : isRealtimeListening ? (
                      '실시간 중지'
                    ) : (
                      '실시간 연습'
                    )}
                  </button>
                </div>
                {!guideScript && practiceMode === 'final' && (
                  <p className="text-slate-400 text-sm text-center">
                    최종 리허설에서는 대본이 필요합니다. 먼저 녹음하거나 노트를 작성하세요.
                  </p>
                )}
                <p className="text-slate-400 text-sm">
                  <LoadingText text={`상태: ${status}`} isLoading={isTranscribing} />
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300">슬라이드 노트</label>
                <textarea
                  value={currentSlide.notes}
                  onChange={(e) => handleNotesChange(e.target.value)}
                  className="w-full h-32 bg-slate-900 border border-slate-800 rounded-xl p-3 text-white resize-none"
                  placeholder="이 슬라이드에서 말할 주요 포인트를 적어보세요..."
                />
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-slate-300">가이드 스크립트</h4>
                {guideScript ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 leading-relaxed">
                    {guideScript}
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs">
                    노트에 주요 문장을 적거나 녹음 목록에서 "가이드로 사용"을 눌러 최종 리허설 참고 스크립트를 지정하세요.
                  </p>
                )}
              </div>

              {currentSlide.curatedScript && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <h4 className="text-sm font-medium text-slate-300">Deepseek 정돈본 저장됨</h4>
                    {currentSlide.curatedScriptMeta?.generatedAt && (
                      <span>
                        {new Date(currentSlide.curatedScriptMeta.generatedAt).toLocaleTimeString('ko-KR')}
                      </span>
                    )}
                  </div>
                  <div className="bg-slate-900 border border-purple-600/30 rounded-xl p-3 text-xs text-slate-200 leading-relaxed space-y-2">
                    <p className="text-[11px] text-purple-200">AI 코칭 탭에서 만든 정돈본이 여기에도 보관됩니다.</p>
                    <div className="max-h-28 overflow-y-auto whitespace-pre-wrap border border-slate-800 rounded-lg p-2 bg-slate-950/60">
                      {currentSlide.curatedScript}
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <button
                        onClick={handleUseCuratedAsNotes}
                        className="px-3 py-1 rounded-lg border border-purple-500/60 text-purple-100 hover:bg-purple-700/40"
                      >
                        이 내용을 노트에 붙여넣기
                      </button>
                      <button
                        onClick={() => handleDownloadScript(currentSlide.curatedScript!, `${presentation.name}_슬라이드${currentPage}_대본.txt`)}
                        className="px-3 py-1 rounded-lg border border-green-500/60 text-green-100 hover:bg-green-700/40"
                      >
                        TXT 다운로드
                      </button>
                      <button
                        onClick={() => setPanel('ai')}
                        className="px-3 py-1 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800"
                      >
                        AI 대본 정리 보기
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {practiceMode === 'final' && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-slate-300">실시간 코칭</h4>
                  <div className="bg-slate-900 border border-purple-600/30 rounded-xl p-3 space-y-2">
                    <div className="flex flex-col md:flex-row gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-400 mb-1">대본 미리보기</p>
                        <div className="bg-slate-950 border border-slate-800 rounded p-2 text-xs text-slate-200 whitespace-pre-wrap max-h-40 overflow-y-auto">
                          {guideScript
                            ? <span dangerouslySetInnerHTML={{ __html: getCurrentSentenceSyncedHtml }} />
                            : '가이드 스크립트가 없습니다.'}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-400 mb-1">실시간 전사</p>
                        <div className="text-sm text-slate-100 min-h-[60px] bg-slate-950 border border-slate-800 rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
                          {realtimeTranscript || latestTranscript || '아직 전사가 없습니다.'}
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-purple-300 mt-2">
                      {alignmentFeedback || '가이드 대비 피드백은 최종 리허설 녹음 후 제공됩니다.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {panel === 'ai' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-200">Deepseek 대본 정리</h4>
                {scriptStatus && (
                  <LoadingText text={scriptStatus} isLoading={isScriptGenerating} />
                )}
              </div>

              {currentSlide.curatedScript && (
                <div className="text-[11px] text-slate-300 bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-purple-200 font-semibold">정돈본 보관 위치</span>
                    {currentSlide.curatedScriptMeta?.generatedAt && (
                      <span className="text-slate-400">{new Date(currentSlide.curatedScriptMeta.generatedAt).toLocaleTimeString('ko-KR')}</span>
                    )}
                  </div>
                  <p>정리된 대본은 이 탭과 녹음/노트 탭의 "Deepseek 정돈본" 영역에서 다시 확인할 수 있습니다.</p>
                </div>
              )}

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <button
                  onClick={handleGenerateCuratedScript}
                  className="w-full text-sm bg-purple-700/80 hover:bg-purple-700 text-white py-2 rounded-lg disabled:opacity-40 flex items-center justify-center gap-2"
                  disabled={selectedTakeIds.length === 0 && currentSlide.takes.length === 0}
                  title={selectedTakeIds.length > 0 ? `선택된 ${selectedTakeIds.length}개 트라이로 대본 생성` : '전체 트라이로 대본 생성'}
                >
                  {isScriptGenerating && <LoadingSpinner size="xs" color="purple" />}
                  {selectedTakeIds.length > 0 ? `선택 트라이(${selectedTakeIds.length})로 정돈 대본 생성` : 'N트 기반 정돈 대본 생성'}
                </button>
                {currentSlide.curatedScript ? (
                  <div className="text-xs text-slate-200 space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>최종본 업데이트</span>
                      {currentSlide.curatedScriptMeta?.generatedAt && (
                        <span>{new Date(currentSlide.curatedScriptMeta.generatedAt).toLocaleTimeString()}</span>
                      )}
                    </div>
                    <div className="bg-slate-950 border border-slate-800 rounded p-3 max-h-36 overflow-y-auto whitespace-pre-wrap">
                      {currentSlide.curatedScript}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => handleDownloadScript(currentSlide.curatedScript!, `${presentation.name}_슬라이드${currentPage}_대본.txt`)}
                        className="px-3 py-1 rounded-lg border border-green-500/60 text-green-100 hover:bg-green-700/40 text-xs"
                      >
                        TXT 다운로드
                      </button>
                    </div>
                    {currentSlide.curatedScriptMeta?.keyPoints && (
                      <div>
                        <p className="text-[10px] text-slate-400 mb-1">핵심 포인트</p>
                        <ul className="list-disc pl-4 space-y-1">
                          {currentSlide.curatedScriptMeta.keyPoints.map((point, idx) => (
                            <li key={idx}>{point}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 text-center">
                    대본 정리를 실행하면 정돈된 스크립트와 핵심 포인트가 여기에 나타납니다.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <button
                  onClick={handleManualLiveSync}
                  className="w-full text-xs border border-purple-500/60 text-purple-200 py-2 rounded-lg disabled:opacity-40 flex items-center justify-center gap-2"
                  disabled={!currentSlide.curatedScript}
                >
                  {isLiveSyncAnalyzing && <LoadingSpinner size="xs" color="purple" />}
                  Deepseek 싱크 맞추기
                </button>
                {liveSyncStatus && (
                  <LoadingText text={liveSyncStatus} isLoading={isLiveSyncAnalyzing} />
                )}
                <div className="text-[11px] text-slate-400 bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-1">
                  <p className="text-purple-200 font-semibold">싱크 사용 가이드</p>
                  <p>1) 정돈된 대본을 만든 뒤, 최종 리허설로 녹음하면 자동으로 비교합니다.</p>
                  <p>2) 이미 녹음한 전사가 있으면 "Deepseek 싱크 맞추기" 버튼으로 즉시 다시 비교할 수 있습니다.</p>
                  <p>3) 정합 요약·누락 포인트·다음 문장 제안은 아래 미리보기 카드에 저장됩니다.</p>
                </div>
                {currentSlide.liveSyncPreview && (
                  <div className="bg-purple-950/40 border border-purple-700/40 rounded p-3 text-[11px] space-y-2">
                    <div>
                      <p className="text-purple-200 font-semibold">정합 요약</p>
                      <p className="text-slate-100">{currentSlide.liveSyncPreview.alignmentSummary}</p>
                    </div>
                    {currentSlide.liveSyncPreview.missingPoints && (
                      <p className="text-slate-300">누락: {currentSlide.liveSyncPreview.missingPoints}</p>
                    )}
                    {currentSlide.liveSyncPreview.nextLines && currentSlide.liveSyncPreview.nextLines.length > 0 && (
                      <div>
                        <p className="text-purple-200 font-semibold">다음 내용 미리보기</p>
                        <ul className="list-decimal pl-4 space-y-1 text-slate-100">
                          {currentSlide.liveSyncPreview.nextLines.map((line, idx) => (
                            <li key={idx}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {panel === 'history' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-200">녹음 기록 ({currentSlide.takes.length})</h4>
                <p className="text-[11px] text-slate-400">가이드로 지정해 최종 리허설 비교 기준을 만들 수 있어요.</p>
              </div>
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {currentSlide.takes.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-6">
                    아직 녹음이 없습니다
                  </p>
                ) : (
                  currentSlide.takes.map((take) => (
                    <div key={take.id} className="bg-slate-900 p-3 rounded-xl text-sm border border-slate-800 space-y-2 flex gap-2 items-start">
                      <input
                        type="checkbox"
                        checked={selectedTakeIds.includes(take.id)}
                        onChange={() => handleToggleTakeSelect(take.id)}
                        className="mt-1 accent-purple-500"
                        title="이 트라이를 정돈본 생성에 포함"
                      />
                      <div className="flex-1 space-y-2">
                        <div className="flex justify-between items-start gap-2">
                          <div className="text-xs text-slate-400 space-y-1">
                            <div className="font-semibold text-slate-200">
                              {take.mode === 'final' ? '최종 리허설' : '대본 구축'} {take.takeNumber ? `· ${take.takeNumber}트` : ''}
                            </div>
                            <div>{new Date(take.timestamp).toLocaleTimeString()}</div>
                            <div className="flex gap-2 text-[10px]">
                              {take.modelId && <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">{take.modelId}</span>}
                              {take.isBest && <span className="px-2 py-0.5 rounded bg-purple-800 border border-purple-500 text-purple-100">가이드</span>}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handlePlayPauseTake(take)}
                              className={`text-xs px-2 py-1 rounded ${playingTakeId === take.id ? 'bg-red-700 text-white' : 'bg-purple-900 text-purple-400 hover:text-purple-300'}`}
                            >
                              {playingTakeId === take.id ? '정지' : '재생'}
                            </button>
                            <button
                              onClick={() => handleEditTranscript(take.id)}
                              className="text-slate-300 hover:text-white text-xs bg-slate-800 px-2 py-1 rounded"
                            >
                              수정
                            </button>
                            <button
                              onClick={() => handleDeleteTake(take.id)}
                              className="text-red-300 hover:text-white text-xs bg-red-900/80 px-2 py-1 rounded"
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                        {editingTakeId === take.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={editingTranscript}
                            onChange={(e) => setEditingTranscript(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white resize-none"
                            rows={3}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveTranscript(take.id)}
                              className="text-xs px-3 py-1 rounded-lg bg-purple-700 text-white"
                            >
                              저장
                            </button>
                            <button
                              onClick={() => { setEditingTakeId(null); setEditingTranscript(''); }}
                              className="text-xs px-3 py-1 rounded-lg border border-slate-700 text-slate-200"
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-slate-300 text-xs leading-relaxed">
                          {take.transcript ? (
                            take.transcript
                          ) : (
                            <span className="flex items-center gap-2 text-slate-400">
                              <LoadingSpinner size="xs" color="purple" />
                              텍스트 변환 중...
                            </span>
                          )}
                        </p>
                      )}
                        {take.feedback && (
                        <p className="text-[11px] text-purple-200">
                          {take.feedback}
                        </p>
                      )}
                        <button
                          onClick={() => handleMarkBest(take.id)}
                          className="text-[11px] text-purple-300 hover:text-white underline"
                        >
                          {take.isBest ? '가이드 지정 해제' : '이 녹음을 가이드로 사용'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {panel === 'fullScript' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-200">전체 프레젠테이션 대본</h4>
                {fullScriptStatus && (
                  <LoadingText text={fullScriptStatus} isLoading={isFullScriptGenerating} />
                )}
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <button
                  onClick={handleGenerateFullScript}
                  className="w-full text-sm bg-purple-700/80 hover:bg-purple-700 text-white py-2 rounded-lg disabled:opacity-40 flex items-center justify-center gap-2"
                  disabled={presentation.slides.filter(s => s.curatedScript).length === 0}
                >
                  {isFullScriptGenerating && <LoadingSpinner size="xs" color="purple" />}
                  전체 프레젠테이션 대본 생성
                </button>

                {presentation.fullScript ? (
                  <div className="text-xs text-slate-200 space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>전체 대본 생성일</span>
                      {presentation.fullScriptGeneratedAt && (
                        <span>{new Date(presentation.fullScriptGeneratedAt).toLocaleString()}</span>
                      )}
                    </div>
                    <div className="bg-slate-950 border border-slate-800 rounded p-3 max-h-80 overflow-y-auto whitespace-pre-wrap">
                      {presentation.fullScript}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDownloadScript(presentation.fullScript!, `${presentation.name}_전체_대본.txt`)}
                        className="px-3 py-1 rounded-lg border border-green-500/60 text-green-100 hover:bg-green-700/40 text-xs"
                      >
                        TXT 다운로드
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 text-center">
                    전체 대본을 생성하면 모든 슬라이드의 정돈본을 종합한 자연스러운 발표 대본이 여기에 나타납니다.
                  </p>
                )}
              </div>

              <div className="text-[11px] text-slate-400 bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-1">
                <p className="text-purple-200 font-semibold">전체 대본 사용 가이드</p>
                <p>1) 각 슬라이드에서 먼저 정돈본을 생성하세요.</p>
                <p>2) "전체 프레젠테이션 대본 생성" 버튼으로 모든 슬라이드를 종합한 대본을 만듭니다.</p>
                <p>3) 생성된 대본을 보며 전체 발표 흐름을 연습할 수 있습니다.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SlidePracticeStep;
