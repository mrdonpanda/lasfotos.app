export function resizeToMaxEdge(
  width: number,
  height: number,
  maxEdge = 1600,
): { width: number; height: number } | null {
  if (width <= 0 || height <= 0) return null;
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return null;
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
