import React, { useState } from 'react';
import PresentationListStep from './components/PresentationListStep';
import SlidePracticeStep from './components/SlidePracticeStep';
import { usePresentations } from './hooks/usePresentations';

const App: React.FC = () => {
  const { presentations } = usePresentations();
  const [step, setStep] = useState<'list' | 'practice'>('list');
  const [currentId, setCurrentId] = useState<string | null>(null);

  const currentPresentation = currentId
    ? presentations.find(p => p.id === currentId)
    : undefined;

  const activeStepIndex = step === 'list' ? 0 : 1;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <header className="text-center space-y-2 mb-8">
          <p className="text-sm uppercase tracking-[0.3em] text-purple-300/70">AI Presentation Coach</p>
          <h1 className="text-5xl font-black text-white">Proach</h1>
          <p className="text-slate-400 max-w-2xl mx-auto">
            발표를 준비하고 연습하는 흐름을 한눈에 정리했습니다. 세션 관리부터 슬라이드별 리허설, AI 코칭까지 단계별로 이동하세요.
          </p>
        </header>

        <div className="flex items-center justify-center gap-3 mb-8">
          {['세션 관리', '슬라이드 연습'].map((label, index) => (
            <div
              key={label}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                activeStepIndex === index
                  ? 'border-purple-400 bg-purple-500/10 text-purple-100 shadow-[0_10px_40px_-25px_rgba(168,85,247,0.9)]'
                  : 'border-slate-700 text-slate-400'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-purple-400" aria-hidden />
              <span className="text-sm font-semibold">{index + 1}. {label}</span>
            </div>
          ))}
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-3xl shadow-2xl shadow-purple-900/20 overflow-hidden">
          {step === 'list' && (
            <PresentationListStep
              onSelect={id => { setCurrentId(id); setStep('practice'); }}
            />
          )}
          {step === 'practice' && currentPresentation && (
            <SlidePracticeStep
              presentation={currentPresentation}
              onBack={() => setStep('list')}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
