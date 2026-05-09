import { useState, useRef, useCallback } from 'react';

export interface SpeechHook {
  supported:  boolean;
  listening:  boolean;
  transcript: string;
  start:      (onSubmit: (text: string) => void) => void;
  stop:       () => void;
}

export function useSpeech(): SpeechHook {
  const getSpeechRecog = () =>
    typeof window !== 'undefined'
      ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
      : null;

  const supported = !!getSpeechRecog();
  const [listening,  setListening]  = useState(false);
  const [transcript, setTranscript] = useState('');
  const recogRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    recogRef.current?.stop();
    recogRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback((onSubmit: (text: string) => void) => {
    const SpeechRec = getSpeechRecog();
    if (!SpeechRec) return;

    const recog = new SpeechRec();
    recog.continuous     = true;
    recog.interimResults = true;
    recog.lang           = 'en-US';
    recogRef.current     = recog;

    let finalText = '';

    recog.onresult = (e: any) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      setTranscript(finalText + interim);
      timerRef.current = setTimeout(() => {
        const text = (finalText + interim).trim();
        stop();
        setTranscript('');
        if (text) onSubmit(text);
      }, 2000);
    };

    recog.onerror = (e: any) => {
      if (e.error === 'not-allowed') {
        setTranscript('Microphone access denied — check browser permissions');
      }
      stop();
    };

    recog.onend = () => setListening(false);
    recog.start();
    setListening(true);
    setTranscript('');
    finalText = '';
  }, [stop]);

  return { supported, listening, transcript, start, stop };
}
