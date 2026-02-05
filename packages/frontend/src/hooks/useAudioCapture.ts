import { useState, useRef, useCallback } from 'react';

const SAMPLE_RATE = 16000;
const CHUNK_INTERVAL_MS = 100;

// AudioWorklet processor code (inline as data URL)
const workletCode = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0];
      // Convert Float32 samples to Int16
      for (let i = 0; i < channelData.length; i++) {
        const s = Math.max(-1, Math.min(1, channelData[i]));
        this._buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }

      // Send chunks at regular intervals
      if (this._buffer.length >= ${(SAMPLE_RATE * CHUNK_INTERVAL_MS) / 1000}) {
        const samples = new Int16Array(this._buffer);
        this._buffer = [];
        this.port.postMessage({ type: 'audio', samples: samples.buffer }, [samples.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
`;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface UseAudioCaptureOptions {
  onAudioChunk: (base64Pcm: string) => void;
  onAudioLevel?: (level: number) => void;
}

export interface UseAudioCaptureReturn {
  isCapturing: boolean;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
  audioLevel: number;
}

export function useAudioCapture({
  onAudioChunk,
  onAudioLevel,
}: UseAudioCaptureOptions): UseAudioCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const onAudioChunkRef = useRef(onAudioChunk);
  const onAudioLevelRef = useRef(onAudioLevel);
  onAudioChunkRef.current = onAudioChunk;
  onAudioLevelRef.current = onAudioLevel;

  const startCapture = useCallback(async () => {
    if (audioContextRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    streamRef.current = stream;

    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    audioContextRef.current = audioContext;

    // Register the worklet processor
    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    await audioContext.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    const source = audioContext.createMediaStreamSource(stream);

    // AnalyserNode for audio level metering
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    source.connect(analyser);

    const workletNode = new AudioWorkletNode(
      audioContext,
      'pcm-capture-processor',
    );
    workletNodeRef.current = workletNode;

    workletNode.port.onmessage = (event) => {
      if (event.data.type === 'audio') {
        const base64 = arrayBufferToBase64(event.data.samples);
        onAudioChunkRef.current(base64);
      }
    };

    source.connect(workletNode);
    workletNode.connect(audioContext.destination);

    // Audio level animation loop
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let frameCount = 0;
    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      // Find max value for better responsiveness
      let max = 0;
      for (let i = 0; i < dataArray.length; i++) {
        if (dataArray[i] > max) max = dataArray[i];
      }
      // Normalize and apply curve for better visual response
      const normalized = max / 255;
      const boosted = Math.pow(normalized, 0.5); // Square root for more sensitivity at low levels
      setAudioLevel(boosted);
      // Call callback with audio level
      onAudioLevelRef.current?.(boosted);
      // Debug log every 60 frames (~1 second)
      frameCount++;
      if (frameCount % 60 === 0) {
        console.log('[AudioCapture] level:', boosted.toFixed(3), 'max:', max);
      }
      animFrameRef.current = requestAnimationFrame(updateLevel);
    };
    updateLevel();
    console.log('[AudioCapture] Started capture, analyser connected');

    setIsCapturing(true);
  }, []);

  const stopCapture = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }

    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    audioContextRef.current?.close();
    audioContextRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    analyserRef.current = null;
    setIsCapturing(false);
    setAudioLevel(0);
  }, []);

  return { isCapturing, startCapture, stopCapture, audioLevel };
}
