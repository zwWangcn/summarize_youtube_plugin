/** A per-video player choice takes precedence over the synced default. */
export function resolveBilingualEnabled(
  defaultEnabled: boolean,
  videoOverride: boolean | undefined,
): boolean {
  return videoOverride ?? defaultEnabled;
}
