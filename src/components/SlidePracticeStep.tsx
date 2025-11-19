import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { usePresentations, Presentation } from '../hooks/usePresentations';
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { deepseekChat, extractJsonBlock } from '../utils/deepseek';
// public 폴더의 워커 파일을 직접 지정
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

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
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  // 현재 슬라이드 데이터 초기화
  const currentSlide = presentation.slides[currentPage - 1] || {
    page: currentPage,
    notes: '',
    takes: []
  };

  const guideTake = currentSlide.takes.find(take => take.isBest);
  const guideScript = guideTake?.transcript || currentSlide.curatedScript || currentSlide.notes;

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
    console.log('PDF 로드 성공:', numPages, '페이지');
    setNumPages(numPages);
    setPdfError(null);
    update(presentation.id, { pageCount: numPages });
  };

  const handleLoadError = (error: Error) => {
    console.error('PDF 로드 오류:', error);
    setPdfError('PDF 파일을 로드할 수 없습니다. 파일 형식을 확인해주세요.');
  };

  // 녹음 관련 함수들
  const handleStartRecording = async () => {
    if (!import.meta.env.VITE_ELEVENLABS_API_KEY) {
      setStatus('Error: ElevenLabs API key is not set.');
      return;
    }

    setStatus('마이크 접근 요청 중...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        } 
      });
      setIsRecording(true);
      setStatus(practiceMode === 'final' ? '최종 리허설 녹음 중...' : '대본 구축 녹음 중...');
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.current.push(event.data);
        }
      };

      mediaRecorder.current.onstop = handleStopRecording;
      mediaRecorder.current.start(1000); // 1초마다 데이터 수집
    } catch (error) {
      console.error("Error accessing microphone:", error);
      setStatus('마이크 접근 실패');
    }
  };

  const handleStopRecording = async () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      setStatus('오디오 처리 중...');
      
      if (audioChunks.current.length > 0) {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        await transcribeAudio(audioBlob);
      } else {
        setStatus('녹음된 오디오가 없습니다');
      }
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

  const formatTakesForPrompt = () =>
    currentSlide.takes
      .map((take, index) => {
        const label = `${index + 1}트 (${take.mode === 'final' ? '최종' : '대본'}${take.modelId ? ` · ${take.modelId}` : ''})`;
        return `${label}\n${take.transcript || '[텍스트 없음]'}`;
      })
      .join('\n----\n');

  const handleGenerateCuratedScript = async () => {
    if (!currentSlide.takes.length) {
      setScriptStatus('녹음본이 없습니다. 한 번 이상 녹음해 주세요.');
      return;
    }

    setScriptStatus('Deepseek에 대본 정리를 요청 중...');
    try {
      const prompt = formatTakesForPrompt();
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

      const parsed = extractJsonBlock(content);
      const curatedScript = parsed?.script || content;
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
    setStatus('텍스트 변환 중...');
    try {
      const elevenlabs = new ElevenLabsClient({
        apiKey: import.meta.env.VITE_ELEVENLABS_API_KEY as string,
      });

      const modelId = practiceMode === 'final' ? 'scribe_v2' : 'scribe_v1';
      const transcriptionResult = await elevenlabs.speechToText.convert({
        file: audioBlob,
        modelId,
        languageCode: 'ko',
      });

      console.log('음성 인식 결과:', transcriptionResult);

      // 응답 형식 확인 및 처리
      if (transcriptionResult && typeof transcriptionResult === 'object') {
        let fullText = '';
        
        // 다양한 응답 형식 처리
        if ('utterances' in transcriptionResult && Array.isArray((transcriptionResult as any).utterances)) {
          fullText = (transcriptionResult as any).utterances.map((u: any) => u.text).join(' ');
        } else if ('text' in transcriptionResult) {
          fullText = (transcriptionResult as any).text;
        } else if (typeof transcriptionResult === 'string') {
          fullText = transcriptionResult;
        }

        if (fullText) {
          // 현재 슬라이드에 녹음 추가
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

          const slidesWithNewTake = cloneSlidesWithCurrent();
          slidesWithNewTake[currentPage - 1].takes.push(newTake);

          update(presentation.id, { slides: slidesWithNewTake });
          setStatus('녹음 완료!');
          setLatestTranscript(fullText);
          setAlignmentFeedback(feedback ?? null);

          if (practiceMode === 'final' && currentSlide.curatedScript) {
            await runLiveSyncAnalysis(fullText, currentSlide.curatedScript, slidesWithNewTake);
          }
        } else {
          setStatus('음성 인식 실패 - 변환된 텍스트 없음');
        }
      } else {
        setStatus('음성 인식 실패 - 응답 형식 오류');
      }
    } catch (error) {
      console.error("Transcription error:", error);
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

  const handleNotesChange = (notes: string) => {
    const updatedSlides = cloneSlidesWithCurrent();
    updatedSlides[currentPage - 1].notes = notes;
    update(presentation.id, { slides: updatedSlides });
  };

  const pdfFile = presentation.pdfData;

  return (
    <div className="flex flex-col min-h-[80vh] gap-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-purple-400">
          {presentation.name} - 슬라이드 연습
        </h2>
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white underline"
        >
          발표 목록으로
        </button>
      </div>

      <div className="flex gap-6 flex-1">
        {/* PDF 뷰어 */}
        <div className="flex-1 bg-gray-800 rounded-lg p-4">
          <div className="bg-white rounded p-2 min-h-[500px] flex items-center justify-center">
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
                loading={<div className="text-gray-600">PDF 로딩 중...</div>}
              >
                <Page
                  pageNumber={currentPage}
                  width={500}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />
              </Document>
            )}
          </div>
          {!pdfError && (
            <div className="flex items-center justify-between text-sm text-gray-300 mt-4">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 rounded bg-gray-900 border border-gray-700 disabled:opacity-40"
              >
                이전 슬라이드
              </button>
              <span className="text-gray-400">
                {currentPage} / {numPages}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(numPages, prev + 1))}
                disabled={currentPage === numPages}
                className="px-3 py-1 rounded bg-gray-900 border border-gray-700 disabled:opacity-40"
              >
                다음 슬라이드
              </button>
            </div>
          )}
        </div>

        {/* 녹음 및 노트 패널 */}
        <div className="w-96 bg-gray-800 rounded-lg p-4 space-y-6">
          <h3 className="text-lg font-semibold mb-4 text-purple-300">
            슬라이드 {currentPage} - 연습
          </h3>

          <div>
            <p className="text-sm text-gray-300 mb-2 font-semibold">연습 모드</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPracticeMode('draft')}
                className={`px-3 py-2 rounded text-sm border transition ${practiceMode === 'draft'
                  ? 'bg-purple-600 border-purple-400 text-white'
                  : 'bg-gray-900 border-gray-700 text-gray-300'}`}
              >
                1~N트 대본 구축
                <span className="block text-[10px] text-gray-200">Scribe v1 · 소음 환경 대응</span>
              </button>
              <button
                onClick={() => setPracticeMode('final')}
                className={`px-3 py-2 rounded text-sm border transition ${practiceMode === 'final'
                  ? 'bg-purple-600 border-purple-400 text-white'
                  : 'bg-gray-900 border-gray-700 text-gray-300'}`}
              >
                최종 리허설
                <span className="block text-[10px] text-gray-200">Scribe v2 Realtime</span>
              </button>
            </div>
          </div>

          {/* 녹음 컨트롤 */}
          <div>
            <button
              onClick={toggleRecording}
              disabled={status.includes('처리') || status.includes('변환')}
              className={`w-full py-3 rounded-lg text-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                isRecording
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-purple-600 hover:bg-purple-700'
              }`}
            >
              {isRecording ? '녹음 중지' : '녹음 시작'}
            </button>
            <p className="text-gray-400 text-sm mt-2">상태: {status}</p>
          </div>

          {/* 노트 입력 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              슬라이드 노트
            </label>
            <textarea
              value={currentSlide.notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              className="w-full h-32 bg-gray-900 border border-gray-700 rounded p-3 text-white resize-none"
              placeholder="이 슬라이드에서 말할 주요 포인트를 적어보세요..."
            />
          </div>

          <div>
            <h4 className="text-sm font-medium text-gray-300 mb-2">가이드 스크립트</h4>
            {guideScript ? (
              <div className="bg-gray-900 border border-gray-700 rounded p-3 text-xs text-gray-200 leading-relaxed">
                {guideScript}
              </div>
            ) : (
              <p className="text-gray-500 text-xs">
                노트에 주요 문장을 적거나 녹음 목록에서 "가이드로 사용"을 눌러 최종 리허설 참고 스크립트를 지정하세요.
              </p>
            )}
          </div>

          {practiceMode === 'final' && (
            <div>
              <h4 className="text-sm font-medium text-gray-300 mb-2">실시간 코칭</h4>
              <div className="bg-gray-900 border border-purple-600/30 rounded p-3 space-y-2">
                <p className="text-xs text-gray-400">마지막 전사</p>
                <p className="text-sm text-gray-100 min-h-[60px]">
                  {latestTranscript || '아직 녹음 데이터가 없습니다.'}
                </p>
                <p className="text-xs text-purple-300">
                  {alignmentFeedback || '가이드 대비 피드백은 최종 리허설 녹음 후 제공됩니다.'}
                </p>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-300">Deepseek 대본 어시스턴트</h4>
              {scriptStatus && (
                <span className="text-[11px] text-gray-400">{scriptStatus}</span>
              )}
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded p-3 space-y-3">
              <button
                onClick={handleGenerateCuratedScript}
                className="w-full text-sm bg-purple-700/80 hover:bg-purple-700 text-white py-2 rounded disabled:opacity-40"
                disabled={currentSlide.takes.length === 0}
              >
                N트 기반 정돈 대본 생성
              </button>
              {currentSlide.curatedScript ? (
                <div className="text-xs text-gray-200 space-y-2">
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>최종본 업데이트</span>
                    {currentSlide.curatedScriptMeta?.generatedAt && (
                      <span>{new Date(currentSlide.curatedScriptMeta.generatedAt).toLocaleTimeString()}</span>
                    )}
                  </div>
                  <div className="bg-gray-950 border border-gray-800 rounded p-3 max-h-36 overflow-y-auto whitespace-pre-wrap">
                    {currentSlide.curatedScript}
                  </div>
                  {currentSlide.curatedScriptMeta?.keyPoints && (
                    <div>
                      <p className="text-[10px] text-gray-400 mb-1">핵심 포인트</p>
                      <ul className="list-disc pl-4 space-y-1">
                        {currentSlide.curatedScriptMeta.keyPoints.map((point, idx) => (
                          <li key={idx}>{point}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-500 text-center">
                  대본 정리를 실행하면 정돈된 스크립트와 핵심 포인트가 여기에 나타납니다.
                </p>
              )}

              <div className="space-y-2">
                <button
                  onClick={handleManualLiveSync}
                  className="w-full text-xs border border-purple-500/60 text-purple-200 py-2 rounded disabled:opacity-40"
                  disabled={!currentSlide.curatedScript}
                >
                  Deepseek 싱크 맞추기
                </button>
                {liveSyncStatus && (
                  <p className="text-[11px] text-gray-400 text-center">{liveSyncStatus}</p>
                )}
                {currentSlide.liveSyncPreview && (
                  <div className="bg-purple-950/40 border border-purple-700/40 rounded p-2 text-[11px] space-y-2">
                    <div>
                      <p className="text-purple-200 font-semibold">정합 요약</p>
                      <p className="text-gray-100">{currentSlide.liveSyncPreview.alignmentSummary}</p>
                    </div>
                    {currentSlide.liveSyncPreview.missingPoints && (
                      <p className="text-gray-300">누락: {currentSlide.liveSyncPreview.missingPoints}</p>
                    )}
                    {currentSlide.liveSyncPreview.nextLines && currentSlide.liveSyncPreview.nextLines.length > 0 && (
                      <div>
                        <p className="text-purple-200 font-semibold">다음 내용 미리보기</p>
                        <ul className="list-decimal pl-4 space-y-1 text-gray-100">
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
          </div>

          {/* 녹음 기록 */}
          <div>
            <h4 className="text-sm font-medium text-gray-300 mb-2">
              녹음 기록 ({currentSlide.takes.length})
            </h4>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {currentSlide.takes.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">
                  아직 녹음이 없습니다
                </p>
              ) : (
                currentSlide.takes.map((take) => (
                  <div key={take.id} className="bg-gray-900 p-3 rounded text-sm border border-gray-800">
                    <div className="flex justify-between items-start mb-2">
                      <div className="text-xs text-gray-400 space-y-1">
                        <div className="font-semibold text-gray-200">
                          {take.mode === 'final' ? '최종 리허설' : '대본 구축'} {take.takeNumber ? `· ${take.takeNumber}트` : ''}
                        </div>
                        <div>{new Date(take.timestamp).toLocaleTimeString()}</div>
                        <div className="flex gap-2 text-[10px]">
                          {take.modelId && <span className="px-2 py-0.5 rounded bg-gray-800 border border-gray-700">{take.modelId}</span>}
                          {take.isBest && <span className="px-2 py-0.5 rounded bg-purple-800 border border-purple-500 text-purple-100">가이드</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const audio = new Audio(take.audioUrl);
                          audio.play();
                        }}
                        className="text-purple-400 hover:text-purple-300 text-xs bg-purple-900 px-2 py-1 rounded"
                      >
                        재생
                      </button>
                    </div>
                    <p className="text-gray-300 text-xs leading-relaxed">
                      {take.transcript || '텍스트 변환 중...'}
                    </p>
                    {take.feedback && (
                      <p className="text-[11px] text-purple-200 mt-2">
                        {take.feedback}
                      </p>
                    )}
                    <button
                      onClick={() => handleMarkBest(take.id)}
                      className="mt-2 text-[11px] text-purple-300 hover:text-white underline"
                    >
                      {take.isBest ? '가이드 지정 해제' : '이 녹음을 가이드로 사용'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SlidePracticeStep;
