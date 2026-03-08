import { useEffect } from "react";
import { loader } from "@monaco-editor/react";

let remeasured = false;

/**
 * Waits for document fonts to finish loading, then calls Monaco's
 * remeasureFonts() once so async web fonts (e.g. DM Mono from Google Fonts)
 * are picked up correctly by all editor instances.
 */
export function useMonacoFontReady(): void {
  useEffect(() => {
    if (remeasured) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled || remeasured) return;
      remeasured = true;
      loader.init().then((monaco) => {
        monaco.editor.remeasureFonts();
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
}
