import { useState, useRef, useCallback } from 'react';

function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

export interface UseAudioPlaybackReturn {
  isPlaying: boolean;
  enqueueAudio: (base64Pcm: string, sampleRate: number) => void;
  stop: () => void;
  audioLevel: number;
}

export function useAudioPlayback(): UseAudioPlaybackReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);

  const getAudioContext = useCallback(() => {
    if (
      !audioContextRef.current ||
      audioContextRef.current.state === 'closed'
    ) {
      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
    }
    return audioContextRef.current;
  }, []);

  const startLevelMeter = useCallback(() => {
    if (animFrameRef.current) return;
    const analyser = analyserRef.current;
    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const update = () => {
      analyser.getByteFrequencyData(dataArray);
      // Use max value for better responsiveness
      let max = 0;
      for (let i = 0; i < dataArray.length; i++) {
        if (dataArray[i] > max) max = dataArray[i];
      }
      const normalized = max / 255;
      const boosted = Math.pow(normalized, 0.5);
      setAudioLevel(boosted);
      animFrameRef.current = requestAnimationFrame(update);
    };
    update();
  }, []);

  const stopLevelMeter = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    setAudioLevel(0);
  }, []);

  const enqueueAudio = useCallback(
    (base64Pcm: string, sampleRate: number) => {
      const ctx = getAudioContext();
      const analyser = analyserRef.current;
      if (!analyser) return;

      const int16 = base64ToInt16Array(base64Pcm);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      const buffer = ctx.createBuffer(1, float32.length, sampleRate);
      buffer.copyToChannel(float32, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);

      // Schedule gapless playback
      const now = ctx.currentTime;
      const startTime = Math.max(now, nextStartTimeRef.current);
      nextStartTimeRef.current = startTime + buffer.duration;

      activeSourcesRef.current++;
      if (!isPlaying) {
        setIsPlaying(true);
        startLevelMeter();
      }

      source.onended = () => {
        activeSourcesRef.current--;
        if (activeSourcesRef.current <= 0) {
          activeSourcesRef.current = 0;
          setIsPlaying(false);
          stopLevelMeter();
        }
      };

      source.start(startTime);
    },
    [getAudioContext, isPlaying, startLevelMeter, stopLevelMeter],
  );

  const stop = useCallback(() => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    nextStartTimeRef.current = 0;
    activeSourcesRef.current = 0;
    setIsPlaying(false);
    stopLevelMeter();
  }, [stopLevelMeter]);

  return { isPlaying, enqueueAudio, stop, audioLevel };
}
