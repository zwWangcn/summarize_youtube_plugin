export const POPUP_TAB_IDS = ["general", "subtitles", "controls", "ai"] as const;

export type PopupTabId = (typeof POPUP_TAB_IDS)[number];

export function isPopupTabId(value: string | undefined): value is PopupTabId {
  return POPUP_TAB_IDS.includes(value as PopupTabId);
}

export function getAdjacentPopupTab(current: PopupTabId, key: string): PopupTabId | null {
  const currentIndex = POPUP_TAB_IDS.indexOf(current);
  if (key === "Home") return POPUP_TAB_IDS[0];
  if (key === "End") return POPUP_TAB_IDS[POPUP_TAB_IDS.length - 1];
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const offset = key === "ArrowRight" ? 1 : -1;
  return POPUP_TAB_IDS[(currentIndex + offset + POPUP_TAB_IDS.length) % POPUP_TAB_IDS.length];
}
