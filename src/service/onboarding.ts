export const ONBOARDING_SEEN_KEY = "vas-player-onboarding-seen";

// The service worker serializes the read/write so two video tabs cannot both
// claim the automatic tour. A replay never changes this device-local flag.
let pendingClaim: Promise<unknown> = Promise.resolve();

export function claimPlayerOnboarding(): Promise<boolean> {
  const claim = pendingClaim.then(async () => {
    const stored = await chrome.storage.local.get(ONBOARDING_SEEN_KEY);
    if (stored[ONBOARDING_SEEN_KEY] === true) return false;
    await chrome.storage.local.set({ [ONBOARDING_SEEN_KEY]: true });
    return true;
  });
  pendingClaim = claim.catch(() => undefined);
  return claim;
}

/** Open the settings as a tab; opening the toolbar popup requires a gesture
 * on Chrome versions older than 127, which this extension still supports. */
export async function openAISetup(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "OPEN_AI_SETUP" });
  if (response?.opened !== true) throw new Error("Could not open AI settings");
}
