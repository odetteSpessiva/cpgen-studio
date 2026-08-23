import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default defineConfig(async (configEnv) => {
  const resolvedViteConfig = await viteConfig(configEnv);

  return mergeConfig(resolvedViteConfig, {
    resolve: {
      conditions: ["browser"],
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./tests/setup.ts"],
      include: ["tests/**/*.test.{ts,tsx}"],
      exclude: ["node_modules", "dist", "src-tauri"],
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
        exclude: [
          "src-tauri/**",
          "public/monaco-editor/**",
          "dist/**",
          "**/*.d.ts",
        ],
      },
    },
  });
});
