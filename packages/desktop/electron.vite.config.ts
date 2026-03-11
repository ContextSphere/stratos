import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    // Bundle the workspace core package into the main process output so
    // packaged builds do not depend on copying its dist files into app.asar.
    plugins: [externalizeDepsPlugin({ exclude: ["@stratosapp/core"] })],
    resolve: {
      alias: {
        "@stratosapp/core": resolve("../core/src/index.ts"),
        "@common": resolve("src/common"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@stratosapp/core": resolve("../core/src/index.ts"),
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
        "@stratosapp/ui": resolve("../ui/src/index.ts"),
        "@renderer": resolve("src/renderer"),
        "@common": resolve("src/common"),
      },
    },
    plugins: [tailwindcss(), react()],
  },
});
