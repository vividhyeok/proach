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

  return (
    <div className="bg-gray-900 text-white min-h-screen font-sans p-6">
      <div className="max-w-4xl mx-auto">
        <header className="py-8 text-center">
          <h1 className="text-5xl font-bold text-purple-400">Proach</h1>
          <p className="text-gray-400 mt-2">Your AI-Powered Presentation Coach</p>
        </header>

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
  );
};

export default App;
