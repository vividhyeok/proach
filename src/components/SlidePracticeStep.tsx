import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { usePresentations, Presentation } from '../hooks/usePresentations';
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { deepseekChat, extractJsonBlock } from '../utils/deepseek';
import { ElectronAPI } from '../types/electron';
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
  const [isFloatingWindow, setIsFloatingWindow] = useState(false);
  const [panel, setPanel] = useState<'sync' | 'alerts' | 'library'>('sync');
  const [editingTakeId, setEditingTakeId] = useState<string | null>(null);
  const [editingTranscript, setEditingTranscript] = useState('');
  const electronAPI: ElectronAPI | undefined = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const panelTabs = [
    { key: 'sync', label: '대본 싱크', desc: '녹음·실시간 듣기·정렬' },
    { key: 'alerts', label: '경고/알림', desc: '누락·과다 설명 감지' },
    { key: 'library', label: '자료·녹음', desc: '노트·정돈본·기록' },
  ] as const;
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

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
    };
  }, []);

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

  const enableFloatingWindow = async () => {
    if (!electronAPI) return;
    try {
      if (electronAPI.setWindowMode) {
        await electronAPI.setWindowMode('pip');
      } else if (electronAPI.setAlwaysOnTop) {
        await electronAPI.setAlwaysOnTop(true);
      }
      setIsFloatingWindow(true);
    } catch (error) {
      console.error('플로팅 모드 전환 실패:', error);
    }
  };

  const restoreWindowMode = async () => {
    if (!electronAPI) return;
    try {
      if (electronAPI.setWindowMode) {
        await electronAPI.setWindowMode('default');
      } else if (electronAPI.setAlwaysOnTop) {
        await electronAPI.setAlwaysOnTop(false);
      }
      setIsFloatingWindow(false);
    } catch (error) {
      console.error('기본 창 모드 복원 실패:', error);
    }
  };

  const handleOpenExternalPdf = async () => {
    if (!electronAPI || !presentation.pdfPath) {
      setPdfError('Electron 환경에서만 PDF 팝업을 열 수 있습니다.');
      return;
    }
    try {
      await electronAPI.openPdfInChrome(presentation.pdfPath);
      await enableFloatingWindow();
    } catch (error) {
      console.error('PDF 팝업 열기 실패:', error);
      setPdfError('PDF 팝업을 열 수 없습니다. 다시 시도해주세요.');
    }
  };

  useEffect(() => {
    if (!electronAPI || !presentation.pdfPath) return;
    enableFloatingWindow();
    return () => {
      restoreWindowMode();
    };
  }, [electronAPI, presentation.pdfPath]);

  const pdfFile = useMemo(() => {
    if (presentation.pdfData) return presentation.pdfData;
    if (presentation.pdfPath) {
      const normalized = presentation.pdfPath.startsWith('file://')
        ? presentation.pdfPath
        : `file://${presentation.pdfPath}`;
      return { url: normalized };
    }
    return undefined;
  }, [presentation.pdfData, presentation.pdfPath]);

  useEffect(() => {
    if (!presentation.pdfData && !presentation.pdfPath) {
      setPdfError('PDF 파일을 찾지 못했습니다. 세션을 다시 생성해주세요.');
    } else {
      setPdfError(null);
    }
  }, [presentation.pdfData, presentation.pdfPath]);

  const activeTranscript = useMemo(() => {
    if (realtimeTranscript.trim()) return realtimeTranscript.trim();
    if (latestTranscript.trim()) return latestTranscript.trim();
    const last = currentSlide.takes[currentSlide.takes.length - 1]?.transcript;
    return last?.trim() || '';
  }, [currentSlide.takes, latestTranscript, realtimeTranscript]);

  const warningItems = useMemo(() => {
    const items: { title: string; detail: string; level: 'info' | 'alert' | 'warning' }[] = [];
    const guide = guideScript?.trim();
    const transcript = activeTranscript;

    if (!transcript) {
      items.push({
        title: '아직 전사가 없습니다',
        detail: '녹음하거나 실시간 듣기를 켠 뒤 대본 싱크 탭에서 진행 상황을 확인하세요.',
        level: 'info',
      });
      return items;
    }

    if (guide) {
      const spokenWords = normalizeText(transcript);
      const guideWords = normalizeText(guide);
      if (guideWords.length) {
        const coverage = Math.min(100, Math.round((guideWords.filter(word => spokenWords.includes(word)).length / guideWords.length) * 100));
        const delta = spokenWords.length - guideWords.length;
        if (coverage < 60) {
          items.push({
            title: '건너뛴 내용이 감지됐어요',
            detail: `가이드 대비 커버리지가 약 ${coverage}%입니다. 핵심 문장을 빠르게 점검해 주세요.`,
            level: 'alert',
          });
        }
        if (delta > Math.max(6, guideWords.length * 0.2)) {
          items.push({
            title: '설명이 길어지고 있어요',
            detail: '불필요한 반복을 줄이고 키 포인트 위주로 정리해 보세요.',
            level: 'warning',
          });
        } else if (delta < -Math.max(6, guideWords.length * 0.2)) {
          items.push({
            title: '설명이 짧아요',
            detail: '강조해야 할 근거나 예시를 한두 문장 추가해 보세요.',
            level: 'warning',
          });
        }
      }
    }

    if (currentSlide.liveSyncPreview?.missingPoints) {
      items.push({
        title: '누락된 키워드가 있어요',
        detail: currentSlide.liveSyncPreview.missingPoints,
        level: 'alert',
      });
    }

    if (!guide) {
      items.push({
        title: '가이드 스크립트가 없어요',
        detail: 'Deepseek 정돈본을 생성하거나 노트에 주요 문장을 작성하면 싱크 정확도가 올라갑니다.',
        level: 'info',
      });
    }

    return items;
  }, [activeTranscript, currentSlide.liveSyncPreview?.missingPoints, guideScript, normalizeText]);


  return (
    <div className="p-8 md:p-10 space-y-6 bg-gradient-to-b from-white via-slate-50 to-white rounded-3xl">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-slate-500">Step 2 · 리허설 & 실시간 코칭</p>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900">{presentation.name}</h2>
          <p className="text-xs text-slate-500">PDF · {presentation.pdfName}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${isRealtimeListening ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
            {isRealtimeListening ? '실시간 음성 인식 연결됨' : '실시간 음성 인식 대기 중'}
          </span>
          <button
            onClick={onBack}
            className="text-sm px-3 py-2 rounded-xl border border-slate-200 text-slate-700 hover:border-blue-200 hover:text-blue-700 bg-white"
          >
            목록으로 돌아가기
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-6">
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700">PDF 실시간 확인</span>
                <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-600">슬라이드 {currentPage} / {numPages}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={handleOpenExternalPdf}
                  disabled={!electronAPI || !presentation.pdfPath}
                  className="px-3 py-2 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                >
                  PDF 팝업
                </button>
                <button
                  onClick={isFloatingWindow ? restoreWindowMode : enableFloatingWindow}
                  disabled={!electronAPI}
                  className={`px-3 py-2 rounded-lg border ${isFloatingWindow ? 'border-purple-200 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-700 hover:border-purple-200'}`}
                >
                  {isFloatingWindow ? '기본 창으로' : 'PIP 모드'}
                </button>
                <div className="flex items-center gap-2 text-sm">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:border-blue-200 disabled:opacity-40"
                  >
                    이전
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(numPages, prev + 1))}
                    disabled={currentPage === numPages}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:border-blue-200 disabled:opacity-40"
                  >
                    다음
                  </button>
                </div>
              </div>
            </div>
            <div className="bg-slate-100 rounded-xl p-3 min-h-[480px] flex items-center justify-center shadow-inner">
              {pdfError ? (
                <div className="text-red-600 text-center space-y-2">
                  <p className="font-semibold">{pdfError}</p>
                  <p className="text-sm text-slate-600">PDF 파일을 다시 업로드해주세요.</p>
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
                    width={560}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                </Document>
              )}
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1 shadow-sm">
              <p className="text-xs text-slate-500">현재 모드</p>
              <p className="text-base font-semibold text-slate-900">{practiceMode === 'final' ? '최종 리허설' : '대본 구축'}</p>
              <p className="text-xs text-slate-500">모드는 오른쪽 탭에서 바로 바꿀 수 있어요.</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1 shadow-sm">
              <p className="text-xs text-slate-500">음성 인식 상태</p>
              <p className="text-base font-semibold text-slate-900">{status}</p>
              <p className="text-xs text-slate-500">마이크/실시간 듣기 상태를 한눈에 확인합니다.</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1 shadow-sm">
              <p className="text-xs text-slate-500">가이드 스크립트</p>
              <p className="text-base font-semibold text-slate-900">{guideScript ? '준비됨' : '필요'}</p>
              <p className="text-xs text-slate-500">정돈본 생성 후 자동으로 싱크 정확도가 올라갑니다.</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {panelTabs.map(({ key, label, desc }) => (
              <button
                key={key}
                onClick={() => setPanel(key)}
                className={`px-4 py-3 rounded-xl border text-left transition-all ${panel === key ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-blue-200 hover:text-blue-700'}`}
              >
                <div className="text-sm font-semibold">{label}</div>
                <div className="text-[11px] text-slate-500">{desc}</div>
              </button>
            ))}
          </div>

          {panel === 'sync' && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-800">연습 모드 선택</span>
                    <span className="text-[11px] text-slate-500">싱크 정확도에 영향</span>
                  </div>
                  <p className="text-xs text-slate-500">대본 구축 → 최종 리허설 순서로 진행하면 Deepseek 비교가 자동 적용됩니다.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setPracticeMode('draft')}
                      className={`px-3 py-2 rounded-lg text-sm font-semibold ${practiceMode === 'draft' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:border-blue-200'}`}
                    >
                      대본 구축
                    </button>
                    <button
                      onClick={() => setPracticeMode('final')}
                      className={`px-3 py-2 rounded-lg text-sm font-semibold ${practiceMode === 'final' ? 'bg-purple-600 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:border-purple-200'}`}
                    >
                      최종 리허설
                    </button>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-800">음성 제어</span>
                    <span className={`text-xs px-2 py-1 rounded-full border ${isRecording ? 'border-red-300 text-red-600 bg-red-50' : 'border-slate-200 text-slate-600 bg-white'}`}>{isRecording ? '녹음 중' : '대기'}</span>
                  </div>
                  <p className="text-xs text-slate-500">녹음 종료 시 자동으로 ElevenLabs API에 텍스트 변환을 요청합니다.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={toggleRecording}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold ${isRecording ? 'bg-red-600 text-white' : 'bg-green-600 text-white'} disabled:opacity-50`}
                      disabled={isTranscribing}
                    >
                      {isRecording ? '녹음 중지' : '녹음 시작'}
                    </button>
                    <button
                      onClick={toggleRealtimeListening}
                      className={`px-3 py-2 rounded-lg text-sm font-semibold border ${isRealtimeListening ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-700 border-slate-200 hover:border-purple-200'}`}
                    >
                      {isRealtimeListening ? '실시간 듣기 중지' : '실시간 듣기 시작'}
                    </button>
                  </div>
                  <p className="text-[11px] text-purple-700 flex items-center gap-2">
                    {isTranscribing && <LoadingSpinner size="xs" color="purple" />} {status}
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">대본 싱크 미리보기</span>
                    <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600 text-xs">슬라이드 {currentPage}</span>
                  </div>
                  <button
                    onClick={handleManualLiveSync}
                    className="text-xs px-3 py-2 rounded-lg border border-purple-200 text-purple-700 hover:bg-purple-50 disabled:opacity-40"
                    disabled={!currentSlide.curatedScript}
                  >
                    {isLiveSyncAnalyzing && <LoadingSpinner size="xs" color="purple" />} Deepseek 싱크 맞추기
                  </button>
                </div>
                <p className="text-xs text-slate-500">실시간 듣기 또는 최종 리허설 녹음 시 전사가 도착하면 자동으로 싱크를 갱신합니다.</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-2">
                    <p className="text-xs text-slate-500">가이드/정돈본</p>
                    <div className="text-sm text-slate-800 min-h-[100px] whitespace-pre-wrap prose-sm prose" dangerouslySetInnerHTML={{ __html: getCurrentSentenceSyncedHtml || '<span class=\"text-slate-400\">정돈본을 생성하거나 노트를 작성하세요.</span>' }} />
                  </div>
                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>실시간 전사</span>
                      <span>{isRealtimeListening ? '수신 중' : '대기'}</span>
                    </div>
                    <div className="text-sm text-slate-800 min-h-[100px] bg-white border border-slate-200 rounded p-2 whitespace-pre-wrap max-h-36 overflow-y-auto">
                      {realtimeTranscript || latestTranscript || '아직 전사가 없습니다.'}
                    </div>
                    <p className="text-[11px] text-purple-700">
                      {alignmentFeedback || '최종 리허설 모드로 녹음하면 가이드 대비 피드백을 자동으로 표시합니다.'}
                    </p>
                  </div>
                </div>
                {currentSlide.liveSyncPreview && (
                  <div className="border border-purple-200 bg-purple-50 rounded-lg p-3 text-sm space-y-2">
                    <div className="flex items-center gap-2 text-purple-800 font-semibold">
                      <span>최근 싱크 결과</span>
                      <span className="text-xs text-purple-600">{new Date(currentSlide.liveSyncPreview.generatedAt).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-purple-900">{currentSlide.liveSyncPreview.alignmentSummary}</p>
                    {currentSlide.liveSyncPreview.missingPoints && <p className="text-purple-800">누락: {currentSlide.liveSyncPreview.missingPoints}</p>}
                    {currentSlide.liveSyncPreview.nextLines && currentSlide.liveSyncPreview.nextLines.length > 0 && (
                      <div className="text-xs text-purple-800 space-y-1">
                        <p className="font-semibold">다음 문장 제안</p>
                        <ul className="list-disc pl-4">
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

          {panel === 'alerts' && (
            <div className="space-y-4">
              <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-amber-900">경고/알림</span>
                  <span className="text-xs text-amber-700">대본 싱크 기준으로 자동 생성</span>
                </div>
                <div className="space-y-3">
                  {warningItems.map((warn, idx) => (
                    <div key={idx} className={`border rounded-lg p-3 text-sm ${warn.level === 'alert' ? 'border-red-200 bg-white' : warn.level === 'warning' ? 'border-amber-200 bg-white' : 'border-slate-200 bg-white'}`}>
                      <p className="font-semibold text-slate-900">{warn.title}</p>
                      <p className="text-slate-600 text-xs">{warn.detail}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">실시간 운영 체크리스트</span>
                  <span className="text-xs text-slate-500">한눈에 상태 점검</span>
                </div>
                <div className="grid sm:grid-cols-3 gap-2 text-xs text-slate-700">
                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                    <p className="font-semibold text-slate-900">PDF 확인</p>
                    <p>{pdfError ? 'PDF 로드 오류' : '정상 표시 중'}</p>
                  </div>
                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                    <p className="font-semibold text-slate-900">음성 인식</p>
                    <p>{isRealtimeListening ? '실시간 전사 중' : '녹음 기반 전사'}</p>
                  </div>
                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                    <p className="font-semibold text-slate-900">싱크 기준</p>
                    <p>{guideScript ? '가이드 확보' : '정돈본 생성 필요'}</p>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">경고가 뜨면 대본 싱크 탭에서 즉시 수정하고 다시 녹음해보세요.</p>
              </div>
            </div>
          )}

          {panel === 'library' && (
            <div className="space-y-4">
              <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">슬라이드 노트</span>
                    <span className="px-2 py-1 text-[11px] rounded bg-slate-100 text-slate-500">슬라이드 {currentPage}</span>
                  </div>
                  <button
                    onClick={handleUseCuratedAsNotes}
                    className="text-[11px] text-blue-700 hover:underline disabled:text-slate-400"
                    disabled={!currentSlide.curatedScript}
                  >
                    정돈본을 노트로 복사
                  </button>
                </div>
                <textarea
                  value={currentSlide.notes}
                  onChange={(e) => handleNotesChange(e.target.value)}
                  rows={4}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-800"
                  placeholder="이 슬라이드에서 강조할 키워드, 문장, 시간을 적어두세요."
                />
              </div>

              <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-800">Deepseek 정돈본</h4>
                  {scriptStatus && <LoadingText text={scriptStatus} isLoading={isScriptGenerating} />}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleGenerateCuratedScript}
                    className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-2"
                    disabled={selectedTakeIds.length === 0 && currentSlide.takes.length === 0}
                  >
                    {isScriptGenerating && <LoadingSpinner size="xs" color="purple" />} 정돈본 생성
                  </button>
                  <p className="text-xs text-slate-500">녹음된 트라이를 선택하면 선택본만으로 대본을 만들 수 있습니다.</p>
                </div>
                {currentSlide.curatedScript ? (
                  <div className="space-y-2 text-sm text-slate-800">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>업데이트</span>
                      {currentSlide.curatedScriptMeta?.generatedAt && <span>{new Date(currentSlide.curatedScriptMeta.generatedAt).toLocaleTimeString('ko-KR')}</span>}
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded p-3 max-h-40 overflow-y-auto whitespace-pre-wrap">
                      {currentSlide.curatedScript}
                    </div>
                    {currentSlide.curatedScriptMeta?.keyPoints && (
                      <div className="text-[11px] text-slate-600 space-y-1">
                        <p className="font-semibold text-slate-700">핵심 포인트</p>
                        <ul className="list-disc pl-4 space-y-1">
                          {currentSlide.curatedScriptMeta.keyPoints.map((point, idx) => (
                            <li key={idx}>{point}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <button
                      onClick={() => handleDownloadScript(currentSlide.curatedScript!, `${presentation.name}_슬라이드${currentPage}_대본.txt`)}
                      className="text-xs text-blue-700 underline"
                    >
                      TXT 다운로드
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">녹음 후 정돈본을 생성하면 이곳에 정리된 문장이 표시됩니다.</p>
                )}
              </div>

              <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-800">녹음 기록 ({currentSlide.takes.length})</h4>
                  <p className="text-[11px] text-slate-500">가이드로 지정해 싱크 기준을 명확히 하세요.</p>
                </div>
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  {currentSlide.takes.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-6">아직 녹음이 없습니다.</p>
                  ) : (
                    currentSlide.takes.map((take) => (
                      <div key={take.id} className="border border-slate-200 rounded-lg p-3 text-sm bg-slate-50 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1 text-xs text-slate-600">
                            <div className="font-semibold text-slate-800">
                              {take.mode === 'final' ? '최종 리허설' : '대본 구축'} {take.takeNumber ? `· ${take.takeNumber}트` : ''}
                            </div>
                            <div>{new Date(take.timestamp).toLocaleTimeString()}</div>
                            <div className="flex gap-2 text-[10px] flex-wrap">
                              {take.modelId && <span className="px-2 py-0.5 rounded bg-white border border-slate-200">{take.modelId}</span>}
                              {take.isBest && <span className="px-2 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-800">가이드</span>}
                            </div>
                          </div>
                          <div className="flex gap-2 flex-wrap justify-end">
                            <button
                              onClick={() => handlePlayPauseTake(take)}
                              className={`text-xs px-2 py-1 rounded border ${playingTakeId === take.id ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-700 border-slate-200'}`}
                            >
                              {playingTakeId === take.id ? '정지' : '재생'}
                            </button>
                            <button
                              onClick={() => handleEditTranscript(take.id)}
                              className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-700 bg-white"
                            >
                              수정
                            </button>
                            <button
                              onClick={() => handleDeleteTake(take.id)}
                              className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 bg-white"
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
                              className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-800 resize-none"
                              rows={3}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleSaveTranscript(take.id)}
                                className="text-xs px-3 py-1 rounded-lg bg-blue-600 text-white"
                              >
                                저장
                              </button>
                              <button
                                onClick={() => { setEditingTakeId(null); setEditingTranscript(''); }}
                                className="text-xs px-3 py-1 rounded-lg border border-slate-200 text-slate-700 bg-white"
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-slate-700 text-xs leading-relaxed">
                            {take.transcript ? (
                              take.transcript
                            ) : (
                              <span className="flex items-center gap-2 text-slate-500">
                                <LoadingSpinner size="xs" color="purple" /> 텍스트 변환 중...
                              </span>
                            )}
                          </p>
                        )}
                        {take.feedback && (
                          <p className="text-[11px] text-purple-700">{take.feedback}</p>
                        )}
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleMarkBest(take.id)}
                            className="text-[11px] text-blue-700 underline"
                          >
                            {take.isBest ? '가이드 지정 해제' : '이 녹음을 가이드로 사용'}
                          </button>
                          <label className="flex items-center gap-1 text-[11px] text-slate-600">
                            <input
                              type="checkbox"
                              checked={selectedTakeIds.includes(take.id)}
                              onChange={() => handleToggleTakeSelect(take.id)}
                              className="accent-purple-600"
                            />
                            정돈본 생성에 포함
                          </label>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-800">전체 프레젠테이션 대본</h4>
                  {fullScriptStatus && <LoadingText text={fullScriptStatus} isLoading={isFullScriptGenerating} />}
                </div>
                <button
                  onClick={handleGenerateFullScript}
                  className="w-full text-sm bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg disabled:opacity-40 flex items-center justify-center gap-2"
                  disabled={presentation.slides.filter(s => s.curatedScript).length === 0}
                >
                  {isFullScriptGenerating && <LoadingSpinner size="xs" color="purple" />} 전체 대본 생성
                </button>
                {presentation.fullScript ? (
                  <div className="text-xs text-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>생성일</span>
                      {presentation.fullScriptGeneratedAt && (
                        <span>{new Date(presentation.fullScriptGeneratedAt).toLocaleString()}</span>
                      )}
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded p-3 max-h-60 overflow-y-auto whitespace-pre-wrap">
                      {presentation.fullScript}
                    </div>
                    <button
                      onClick={() => handleDownloadScript(presentation.fullScript!, `${presentation.name}_전체_대본.txt`)}
                      className="text-xs text-blue-700 underline"
                    >
                      TXT 다운로드
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">각 슬라이드의 정돈본을 만든 뒤 전체 대본을 생성하면 리허설 흐름을 한눈에 볼 수 있습니다.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SlidePracticeStep;
