export interface TraverseResult { day: number; illumination: number; reachable: boolean; }
export function traverseHorizon(days = 30): TraverseResult[] {
  return Array.from({ length: days }, (_, day) => {
    const illumination = 0.5 + 0.5 * Math.sin(day * 0.21 + 0.8);
    return { day, illumination, reachable: illumination > 0.28 };
  });
}
self.onmessage = (event: MessageEvent<number | undefined>) => self.postMessage(traverseHorizon(event.data ?? 30));
