/**
 * Calculate audio level from an AnalyserNode.
 * Uses max frequency value with square root boosting for better visual responsiveness.
 */
export function calculateAudioLevel(
  analyser: AnalyserNode,
  dataArray: Uint8Array<ArrayBuffer>,
): number {
  analyser.getByteFrequencyData(dataArray);
  let max = 0;
  for (let i = 0; i < dataArray.length; i++) {
    if (dataArray[i] > max) max = dataArray[i];
  }
  const normalized = max / 255;
  return Math.pow(normalized, 0.5);
}
