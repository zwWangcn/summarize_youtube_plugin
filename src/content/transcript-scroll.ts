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

export interface TranscriptScrollTargetState {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  containerTop: number;
  targetTop: number;
  targetHeight: number;
  minimumInset?: number;
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

/**
 * Resolve a target section position in the scroll container's coordinate space.
 * Short sections are centered so scroll-spy keeps them active; long sections
 * align near the top so their beginning remains visible.
 */
export function getTranscriptTargetScrollTop(
  state: TranscriptScrollTargetState,
): number {
  const minimumInset = state.minimumInset ?? 12;
  const targetInset = Math.max(
    minimumInset,
    (state.clientHeight - state.targetHeight) / 2,
  );
  const requested = state.scrollTop + state.targetTop - state.containerTop - targetInset;
  const maximum = Math.max(0, state.scrollHeight - state.clientHeight);
  return Math.max(0, Math.min(maximum, requested));
}
