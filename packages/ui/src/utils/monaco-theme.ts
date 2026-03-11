import { loader } from "@monaco-editor/react";

/**
 * Initialize and define Monaco themes for Stratos.
 * cursor-dark: dark Cursor-style theme
 * cursor-light: light counterpart
 */
export function defineMonacoTheme(): void {
  loader
    .init()
    .then((monaco) => {
      monaco.editor.defineTheme("cursor-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "6A9955" },
          { token: "keyword", foreground: "C586C0" },
          { token: "string", foreground: "CE9178" },
          { token: "number", foreground: "B5CEA8" },
          { token: "type", foreground: "4EC9B0" },
          { token: "variable", foreground: "9CDCFE" },
          { token: "function", foreground: "DCDCAA" },
        ],
        colors: {
          "editor.background": "#0a0a0a",
          "editor.foreground": "#cccccc",
          "editor.lineHighlightBackground": "#1a1a1a",
          "editor.selectionBackground": "#264f78",
          "editorCursor.foreground": "#aeafad",
          "editorLineNumber.foreground": "#555555",
          "editorLineNumber.activeForeground": "#cccccc",
          "editor.inactiveSelectionBackground": "#3a3d41",
          "editorIndentGuide.background": "#404040",
          "editorWhitespace.foreground": "#3b3b3b",
          "editorWidget.background": "#1a1a1a",
          "editorWidget.border": "#2a2a2a",
          "scrollbarSlider.background": "#33333380",
          "scrollbarSlider.hoverBackground": "#55555580",
          "diffEditor.insertedTextBackground": "#1a4d2e33",
          "diffEditor.removedTextBackground": "#5c1a1a33",
          "diffEditor.insertedLineBackground": "#1a4d2e1a",
          "diffEditor.removedLineBackground": "#5c1a1a1a",
          "diffEditor.border": "#2a2a2a",
        },
      });

      monaco.editor.defineTheme("cursor-light", {
        base: "vs",
        inherit: true,
        rules: [
          { token: "comment", foreground: "3a7a3a" },
          { token: "keyword", foreground: "8b2fa8" },
          { token: "string", foreground: "a8330a" },
          { token: "number", foreground: "2a7a4a" },
          { token: "type", foreground: "0a6a6a" },
          { token: "variable", foreground: "0a5a8a" },
          { token: "function", foreground: "6a5a00" },
        ],
        colors: {
          "editor.background": "#f2f2f2",
          "editor.foreground": "#1a1a1a",
          "editor.lineHighlightBackground": "#e8e8e8",
          "editor.selectionBackground": "#add6ff",
          "editorCursor.foreground": "#333333",
          "editorLineNumber.foreground": "#aaaaaa",
          "editorLineNumber.activeForeground": "#333333",
          "editor.inactiveSelectionBackground": "#e5ebf1",
          "editorIndentGuide.background": "#d0d0d0",
          "editorWhitespace.foreground": "#c0c0c0",
          "editorWidget.background": "#ffffff",
          "editorWidget.border": "#d0d0d0",
          "scrollbarSlider.background": "#c0c0c080",
          "scrollbarSlider.hoverBackground": "#a0a0a080",
          "diffEditor.insertedTextBackground": "#d4edda33",
          "diffEditor.removedTextBackground": "#f8d7da33",
          "diffEditor.insertedLineBackground": "#d4edda1a",
          "diffEditor.removedLineBackground": "#f8d7da1a",
          "diffEditor.border": "#d0d0d0",
        },
      });
    })
    .catch((error) => {
      console.error("Failed to initialize Monaco theme:", error);
    });
}

// Auto-initialize themes on import
defineMonacoTheme();
