import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { usePresentations, Presentation } from '../hooks/usePresentations';
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// PDF.js 워커 설정 - CDN 사용
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

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
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  // 현재 슬라이드 데이터 초기화
  const currentSlide = presentation.slides[currentPage - 1] || { 
    page: currentPage, 
    notes: '', 
    takes: [] 
  };

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
      setStatus('녹음 중...');
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

  const transcribeAudio = async (audioBlob: Blob) => {
    setStatus('텍스트 변환 중...');
    try {
      const elevenlabs = new ElevenLabsClient({
        apiKey: import.meta.env.VITE_ELEVENLABS_API_KEY as string,
      });

      const transcriptionResult = await elevenlabs.speechToText.convert({
        file: audioBlob,
        modelId: 'scribe_v1',
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
          const newTake = {
            id: Date.now().toString(),
            timestamp: Date.now(),
            audioUrl: URL.createObjectURL(audioBlob),
            transcript: fullText,
            isBest: false
          };

          const updatedSlides = [...presentation.slides];
          if (!updatedSlides[currentPage - 1]) {
            updatedSlides[currentPage - 1] = { page: currentPage, notes: '', takes: [] };
          }
          updatedSlides[currentPage - 1].takes.push(newTake);

          update(presentation.id, { slides: updatedSlides });
          setStatus('녹음 완료!');
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

  const handleNotesChange = (notes: string) => {
    const updatedSlides = [...presentation.slides];
    if (!updatedSlides[currentPage - 1]) {
      updatedSlides[currentPage - 1] = { page: currentPage, notes: '', takes: [] };
    }
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
        </div>

        {/* 녹음 및 노트 패널 */}
        <div className="w-80 bg-gray-800 rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-4 text-purple-300">
            슬라이드 {currentPage} - 연습
          </h3>

          {/* 녹음 컨트롤 */}
          <div className="mb-6">
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
          <div className="mb-6">
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
                  <div key={take.id} className="bg-gray-900 p-3 rounded text-sm">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-gray-400 text-xs">
                        {new Date(take.timestamp).toLocaleTimeString()}
                      </span>
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
