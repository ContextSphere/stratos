import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@common": resolve("src/common"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@common": resolve("src/common"),
      },
    },
  },
  renderer: {
    server: {
      hmr: true,
    },
    resolve: {
      alias: {
        "@agentpanel/ui": resolve("../ui/src/index.ts"),
        "@renderer": resolve("src/renderer"),
        "@common": resolve("src/common"),
      },
    },
    plugins: [tailwindcss(), react()],
  },
});
