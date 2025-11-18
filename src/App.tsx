import { useState, useRef } from 'react';
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [status, setStatus] = useState('Idle');
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const handleStartRecording = async () => {
    if (!import.meta.env.VITE_ELEVENLABS_API_KEY) {
      setStatus('Error: ElevenLabs API key is not set.');
      return;
    }
    setStatus('Requesting microphone access...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsRecording(true);
      setStatus('Recording...');
      mediaRecorder.current = new MediaRecorder(stream);
      mediaRecorder.current.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };
      mediaRecorder.current.onstop = handleStopRecording;
      mediaRecorder.current.start();
    } catch (error) {
      console.error("Error accessing microphone:", error);
      setStatus('Error: Could not access microphone.');
    }
  };

  const handleStopRecording = async () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      // Stop all media tracks to release the microphone
      mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      setStatus('Processing audio...');
      
      const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
      audioChunks.current = []; // Reset for next recording

      await transcribeAudio(audioBlob);
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    setStatus('Transcribing...');
    try {
      const elevenlabs = new ElevenLabsClient({
        apiKey: import.meta.env.VITE_ELEVENLABS_API_KEY
      });

      const transcriptionResult = await elevenlabs.speechToText.convert({
        file: audioBlob,
        modelId: "scribe_v1",
      });

      if (transcriptionResult && transcriptionResult.utterances) {
        const fullText = transcriptionResult.utterances.map(u => u.text).join(' ');
        setTranscription(fullText);
        setStatus('Transcription complete!');
      } else {
        setTranscription('No speech detected or error in transcription.');
        setStatus('Transcription complete!');
      }

    } catch (error) {
      console.error("Transcription error:", error);
      setStatus('Error during transcription.');
      setTranscription('Failed to transcribe audio. See console for details.');
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      // onstop will trigger the rest of the logic
      mediaRecorder.current?.stop();
    } else {
      handleStartRecording();
    }
  };

  return (
    <div className="bg-gray-900 text-white min-h-screen flex flex-col items-center justify-center font-sans">
      <div className="w-full max-w-3xl p-8 space-y-8">
        <header className="text-center">
          <h1 className="text-5xl font-bold text-purple-400">Proach</h1>
          <p className="text-gray-400 mt-2">Your AI-Powered Pitch Coach</p>
        </header>

        <main className="bg-gray-800 rounded-lg shadow-lg p-8">
          <div className="flex flex-col items-center space-y-6">
            <button
              onClick={toggleRecording}
              className={`px-8 py-4 rounded-full text-lg font-semibold transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-purple-500 ${
                isRecording
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-purple-600 hover:bg-purple-700'
              }`}
            >
              {isRecording ? 'Stop Recording' : 'Start Recording'}
            </button>
            <p className="text-gray-400">Status: {status}</p>
          </div>

          {transcription && (
            <div className="mt-8 pt-6 border-t border-gray-700">
              <h2 className="text-2xl font-semibold text-purple-300 mb-4">Transcription</h2>
              <div className="bg-gray-900 rounded-md p-4 text-gray-300 whitespace-pre-wrap">
                {transcription}
              </div>
            </div>
          )}
        </main>
        
        <footer className="text-center text-gray-500 text-sm">
          <p>Powered by Vite, React, Tailwind CSS, and ElevenLabs</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
