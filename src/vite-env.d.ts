/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TEST_BUILD?: "true" | "false";
}

declare module "*.css?inline" {
  const content: string;
  export default content;
}
