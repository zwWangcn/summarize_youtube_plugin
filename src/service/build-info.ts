import manifest from "../manifest.json";

/** Build-time flag. Explicit true/false overrides the development-mode default. */
export const IS_TEST_BUILD = import.meta.env.VITE_TEST_BUILD === "true" ||
  (import.meta.env.VITE_TEST_BUILD !== "false" && import.meta.env.MODE === "development");
export const BUILD_VERSION = manifest.version;
