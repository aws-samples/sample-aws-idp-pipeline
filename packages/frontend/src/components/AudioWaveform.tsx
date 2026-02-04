import { useEffect, useRef } from 'react';

interface AudioWaveformProps {
  level: number; // 0-1
  color?: string;
  barCount?: number;
  className?: string;
}

export default function AudioWaveform({
  level,
  color = '#8b5cf6',
  barCount = 5,
  className = '',
}: AudioWaveformProps) {
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = barsRef.current;
    if (!container) return;

    const bars = container.children;
    for (let i = 0; i < bars.length; i++) {
      const el = bars[i] as HTMLElement;
      // Create variation per bar for a natural look
      const offset = Math.sin((i / barCount) * Math.PI);
      const height = Math.max(0.15, level * offset);
      el.style.transform = `scaleY(${height})`;
    }
  }, [level, barCount]);

  return (
    <div ref={barsRef} className={`flex items-center gap-0.5 h-6 ${className}`}>
      {Array.from({ length: barCount }).map((_, i) => (
        <div
          key={i}
          className="w-1 h-full rounded-full transition-transform duration-75"
          style={{
            backgroundColor: color,
            transformOrigin: 'center',
            transform: 'scaleY(0.15)',
          }}
        />
      ))}
    </div>
  );
}
