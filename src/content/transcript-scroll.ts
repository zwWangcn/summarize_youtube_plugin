export type TranscriptLazyLoadDirection = "before" | "after";

export interface TranscriptScrollBoundaryState {
  deltaY: number;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  loadedStart: number;
  loadedEnd: number;
  totalChunks: number;
}

/** Resolve lazy loading from a wheel gesture, including when content cannot scroll yet. */
export function getTranscriptLazyLoadDirection(
  state: TranscriptScrollBoundaryState,
): TranscriptLazyLoadDirection | null {
  if (state.deltaY > 0) {
    const atBottom = state.scrollTop + state.clientHeight >= state.scrollHeight - 1;
    return atBottom && state.loadedEnd < state.totalChunks - 1 ? "after" : null;
  }
  if (state.deltaY < 0) {
    const atTop = state.scrollTop <= 1;
    return atTop && state.loadedStart > 0 ? "before" : null;
  }
  return null;
}
