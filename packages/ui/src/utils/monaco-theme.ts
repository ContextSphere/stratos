import { loader } from '@monaco-editor/react'

/**
 * Initialize and define the cursor-dark theme for Monaco Editor
 * This theme provides a dark, Cursor-style appearance with custom syntax highlighting
 */
export function defineMonacoTheme(): void {
  loader.init().then((monaco) => {
    monaco.editor.defineTheme('cursor-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6A9955' },
        { token: 'keyword', foreground: 'C586C0' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'variable', foreground: '9CDCFE' },
        { token: 'function', foreground: 'DCDCAA' },
      ],
      colors: {
        'editor.background': '#0a0a0a',
        'editor.foreground': '#cccccc',
        'editor.lineHighlightBackground': '#1a1a1a',
        'editor.selectionBackground': '#264f78',
        'editorCursor.foreground': '#aeafad',
        'editorLineNumber.foreground': '#555555',
        'editorLineNumber.activeForeground': '#cccccc',
        'editor.inactiveSelectionBackground': '#3a3d41',
        'editorIndentGuide.background': '#404040',
        'editorWhitespace.foreground': '#3b3b3b',
        'editorWidget.background': '#1a1a1a',
        'editorWidget.border': '#2a2a2a',
        'scrollbarSlider.background': '#33333380',
        'scrollbarSlider.hoverBackground': '#55555580',
        // Diff editor specific colors
        'diffEditor.insertedTextBackground': '#1a4d2e33',
        'diffEditor.removedTextBackground': '#5c1a1a33',
        'diffEditor.insertedLineBackground': '#1a4d2e1a',
        'diffEditor.removedLineBackground': '#5c1a1a1a',
        'diffEditor.border': '#2a2a2a',
      }
    })
  }).catch((error) => {
    console.error('Failed to initialize Monaco theme:', error)
  })
}

// Auto-initialize theme on import
defineMonacoTheme()
