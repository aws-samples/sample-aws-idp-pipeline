import { useEffect, useState, useRef } from 'react';

interface AnimatedAudioBarsProps {
  audioLevel: number;
  barCount?: number;
  color?: string;
  minHeight?: number;
  maxHeight?: number;
  isActive?: boolean;
  threshold?: number;
}

export function AnimatedAudioBars({
  audioLevel,
  barCount = 5,
  color = 'bg-white',
  minHeight = 4,
  maxHeight = 20,
  isActive = true,
  threshold = 0.3,
}: AnimatedAudioBarsProps) {
  const [heights, setHeights] = useState<number[]>(
    Array(barCount).fill(minHeight),
  );
  const audioLevelRef = useRef(audioLevel);
  audioLevelRef.current = audioLevel;

  useEffect(() => {
    if (!isActive) {
      setHeights(Array(barCount).fill(minHeight));
      return;
    }

    const interval = setInterval(() => {
      const rawLevel = audioLevelRef.current;
      // Apply threshold - ignore low levels (background noise)
      const level =
        rawLevel > threshold ? (rawLevel - threshold) / (1 - threshold) : 0;
      const newHeights = Array(barCount)
        .fill(0)
        .map(() => {
          const random = Math.random() * 0.5 + 0.5;
          const h = minHeight + level * random * (maxHeight - minHeight);
          return Math.min(maxHeight, Math.max(minHeight, h));
        });
      setHeights(newHeights);
    }, 100);

    return () => clearInterval(interval);
  }, [isActive, barCount, minHeight, maxHeight, threshold]);

  return (
    <div className="flex gap-0.5 items-center h-5">
      {heights.map((h, i) => (
        <div
          key={i}
          className={`w-1 ${color} rounded-full`}
          style={{
            height: `${h}px`,
            transition: 'height 100ms ease-out',
          }}
        />
      ))}
    </div>
  );
}
