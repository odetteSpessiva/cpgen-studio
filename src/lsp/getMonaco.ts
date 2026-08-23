import { loader } from "@monaco-editor/react";

let monacoInstance: typeof import("monaco-editor") | null = null;

export async function getMonaco() {
  if (!monacoInstance) {
    monacoInstance = await loader.init();
  }
  const instance = monacoInstance;
  if (!instance) {
    throw new Error("Failed to load Monaco");
  }
  return instance;
}
