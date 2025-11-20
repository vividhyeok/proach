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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header className="text-center space-y-4 mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-200">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <p className="text-sm font-medium text-blue-700 tracking-wide">AI Presentation Coach</p>
          </div>
          <h1 className="text-5xl lg:text-6xl font-black bg-gradient-to-r from-slate-900 to-blue-600 bg-clip-text text-transparent">
            Proach
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            발표를 준비하고 연습하는 흐름을 직관적으로 관리하세요. 
            세션 관리부터 슬라이드별 리허설, AI 코칭까지 원활한 경험을 제공합니다.
          </p>
        </header>

        {/* Modern Step Indicator */}
        <div className="flex items-center justify-center mb-12">
          <div className="flex items-center">
            {['세션 관리', '슬라이드 연습'].map((label, index) => (
              <div key={label} className="flex items-center">
                <button
                  onClick={() => index === 0 ? setStep('list') : currentId && setStep('practice')}
                  className={`flex items-center gap-3 px-6 py-4 rounded-2xl transition-all duration-200 ${
                    activeStepIndex === index
                      ? 'bg-white shadow-lg border border-blue-100 text-blue-600'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                  }`}
                >
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
                    activeStepIndex === index
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}>
                    {index + 1}
                  </div>
                  <span className="font-semibold">{label}</span>
                </button>
                {index === 0 && (
                  <div className="w-12 h-0.5 bg-slate-200 mx-2" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Main Content Container */}
        <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
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