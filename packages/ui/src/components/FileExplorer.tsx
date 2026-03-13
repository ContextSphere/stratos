import { useState, useEffect, useCallback, useRef } from "react";
import { Editor } from "@monaco-editor/react";
import { useMonacoFontReady } from "../hooks/useMonacoFontReady";
import {
  getLanguageFromPath,
  MONO_FONT_FAMILY,
} from "../utils/monaco-language";
import "../utils/monaco-theme";
import { useTheme, monacoThemeName } from "../context/ThemeContext";
import type { DirEntry } from "../bridges/types";
import { MarkdownPreview } from "./preview/MarkdownPreview";

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

export interface TreeNode {
  entry: DirEntry;
  path: string;
  children?: TreeNode[];
  loaded: boolean;
  expanded: boolean;
}

interface Props {
  cwd: string;
  targetFilePath?: string;
  targetLine?: number;
  listDirectory: (dirPath: string, rootPath: string) => Promise<DirEntry[]>;
  readFile: (
    filePath: string,
    rootPath: string,
  ) => Promise<{ content: string; isBinary: boolean }>;
  writeFile?: (
    filePath: string,
    content: string,
    rootPath: string,
  ) => Promise<void>;
  watchDirectory?: (cwd: string) => Promise<void>;
  unwatchDirectory?: () => Promise<void>;
  onDirectoryChanged?: (callback: (dirPath: string) => void) => () => void;
}

export function mergeTreeNodes(
  existing: TreeNode[],
  fresh: DirEntry[],
  parentPath: string,
): TreeNode[] {
  const existingByName = new Map(existing.map((n) => [n.entry.name, n]));
  return fresh.map((entry) => {
    const prev = existingByName.get(entry.name);
    if (prev) {
      return { ...prev, entry }; // update size/type, preserve tree state
    }
    return {
      entry,
      path: `${parentPath}/${entry.name}`,
      loaded: false,
      expanded: false,
    };
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FolderIcon({ expanded }: { expanded?: boolean }) {
  return expanded ? (
    <svg
      className="w-4 h-4 text-blue-400 flex-shrink-0"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v1H2V6z" />
      <path
        fillRule="evenodd"
        d="M2 9h16v5a2 2 0 01-2 2H4a2 2 0 01-2-2V9z"
        clipRule="evenodd"
      />
    </svg>
  ) : (
    <svg
      className="w-4 h-4 text-blue-400 flex-shrink-0"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
      />
    </svg>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-[var(--text-muted)] flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function FileExplorer({
  cwd,
  targetFilePath,
  targetLine,
  listDirectory,
  readFile,
  writeFile,
  watchDirectory,
  unwatchDirectory,
  onDirectoryChanged,
}: Props): React.ReactElement {
  useMonacoFontReady();
  const theme = useTheme();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [openFile, setOpenFile] = useState<{
    path: string;
    content: string;
    isBinary: boolean;
    tooLarge: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursorTargetLine, setCursorTargetLine] = useState<number | null>(null);
  const [autoOpenedTarget, setAutoOpenedTarget] = useState<string | null>(null);
  const [mdMode, setMdMode] = useState<"preview" | "edit">("preview");
  const [editContent, setEditContent] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "unsaved"
  >("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<{
    revealLineInCenter: (lineNumber: number) => void;
    setPosition: (position: { lineNumber: number; column: number }) => void;
  } | null>(null);

  useEffect(() => {
    let ignored = false;
    setLoading(true);
    setError(null);
    listDirectory(cwd, cwd)
      .then((entries) => {
        if (ignored) return;
        setTree(
          entries.map((e) => ({
            entry: e,
            path: `${cwd}/${e.name}`,
            loaded: false,
            expanded: false,
          })),
        );
        setLoading(false);
      })
      .catch((err) => {
        if (ignored) return;
        setError(String(err));
        setLoading(false);
      });
    return () => {
      ignored = true;
    };
  }, [cwd, listDirectory]);

  const treeRef = useRef<TreeNode[]>(tree);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  useEffect(() => {
    if (!watchDirectory || !unwatchDirectory || !onDirectoryChanged) return;

    const handleDirChanged = async (changedDirPath: string) => {
      const currentTree = treeRef.current;

      // Root case: entries live directly in `tree`, not as children of a node
      if (changedDirPath === cwd) {
        try {
          const fresh = await listDirectory(cwd, cwd);
          setTree((prev) => mergeTreeNodes(prev, fresh, cwd));
        } catch {
          // keep stale on error
        }
        return;
      }

      // Subtree case: walk and refresh any loaded node whose path matches
      const refreshInTree = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
        const result: TreeNode[] = [];
        for (const node of nodes) {
          if (node.path === changedDirPath && node.loaded) {
            try {
              const fresh = await listDirectory(changedDirPath, cwd);
              result.push({
                ...node,
                children: mergeTreeNodes(
                  node.children ?? [],
                  fresh,
                  changedDirPath,
                ),
              });
            } catch {
              result.push(node); // keep stale on error
            }
          } else if (node.children) {
            result.push({
              ...node,
              children: await refreshInTree(node.children),
            });
          } else {
            result.push(node);
          }
        }
        return result;
      };

      const updated = await refreshInTree(currentTree);
      setTree(updated);
    };

    // Register listener BEFORE starting watcher — events can arrive before invoke resolves
    const cleanup = onDirectoryChanged(handleDirChanged);
    void watchDirectory(cwd);

    return () => {
      cleanup(); // remove listener first to close the stale-event window
      void unwatchDirectory();
    };
  }, [
    cwd,
    watchDirectory,
    unwatchDirectory,
    onDirectoryChanged,
    listDirectory,
  ]);

  const toggleFolder = useCallback(
    async (nodePath: string) => {
      const toggleInTree = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
        const result: TreeNode[] = [];
        for (const node of nodes) {
          if (node.path === nodePath) {
            if (!node.loaded) {
              const entries = await listDirectory(node.path, cwd);
              const children = entries.map((e) => ({
                entry: e,
                path: `${node.path}/${e.name}`,
                loaded: false,
                expanded: false,
              }));
              result.push({ ...node, expanded: true, loaded: true, children });
            } else {
              result.push({ ...node, expanded: !node.expanded });
            }
          } else if (node.children) {
            result.push({
              ...node,
              children: await toggleInTree(node.children),
            });
          } else {
            result.push(node);
          }
        }
        return result;
      };

      setTree(await toggleInTree(tree));
    },
    [listDirectory, tree, cwd],
  );

  const handleFileClick = useCallback(
    async (filePath: string, size?: number, line?: number) => {
      if (size !== undefined && size > MAX_FILE_SIZE) {
        setOpenFile({
          path: filePath,
          content: "",
          isBinary: false,
          tooLarge: true,
        });
        setEditContent("");
        setMdMode("preview");
        setSaveStatus("idle");
        setCursorTargetLine(line ?? null);
        return;
      }
      try {
        const result = await readFile(filePath, cwd);
        setOpenFile({ path: filePath, ...result, tooLarge: false });
        setEditContent(result.content);
        setMdMode("preview");
        setSaveStatus("idle");
        setCursorTargetLine(line ?? null);
      } catch (err) {
        setOpenFile({
          path: filePath,
          content: `Error reading file: ${err}`,
          isBinary: false,
          tooLarge: false,
        });
        setCursorTargetLine(line ?? null);
      }
    },
    [readFile, cwd],
  );

  const handleBack = useCallback(() => {
    setOpenFile(null);
    setCursorTargetLine(null);
  }, []);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return;
      setEditContent(value);
      setSaveStatus("unsaved");

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        if (!writeFile || !openFile) return;
        setSaveStatus("saving");
        try {
          await writeFile(openFile.path, value, cwd);
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2000);
        } catch {
          setSaveStatus("unsaved");
        }
      }, 1000);
    },
    [writeFile, openFile, cwd],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setAutoOpenedTarget(null);
    setCursorTargetLine(null);
  }, [cwd]);

  useEffect(() => {
    if (!targetFilePath || !cwd || loading) return;
    if (!targetFilePath.startsWith(cwd + "/")) return;
    if (autoOpenedTarget === targetFilePath) return;
    setAutoOpenedTarget(targetFilePath);
    void handleFileClick(targetFilePath, undefined, targetLine);
  }, [
    targetFilePath,
    targetLine,
    cwd,
    loading,
    autoOpenedTarget,
    handleFileClick,
  ]);

  useEffect(() => {
    if (!editorRef.current || !cursorTargetLine || cursorTargetLine < 1) return;
    editorRef.current.revealLineInCenter(cursorTargetLine);
    editorRef.current.setPosition({ lineNumber: cursorTargetLine, column: 1 });
  }, [cursorTargetLine, openFile?.path]);

  if (openFile) {
    const relativePath = openFile.path.startsWith(cwd)
      ? openFile.path.slice(cwd.length + 1)
      : openFile.path;
    const isMarkdown = openFile.path.endsWith(".md");

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] flex-shrink-0">
          <button
            onClick={handleBack}
            className="p-1 rounded hover:bg-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Back to file tree"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <span
            className="text-xs text-[var(--text-secondary)] truncate flex-1"
            title={openFile.path}
          >
            {relativePath}
          </span>
          {isMarkdown && !openFile.isBinary && !openFile.tooLarge && (
            <div className="flex rounded-md overflow-hidden border border-[var(--border-mid)]">
              <button
                onClick={() => setMdMode("preview")}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  mdMode === "preview"
                    ? "bg-[var(--bg-overlay)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Preview
              </button>
              <button
                onClick={() => setMdMode("edit")}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  mdMode === "edit"
                    ? "bg-[var(--bg-overlay)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Edit
              </button>
            </div>
          )}
          {saveStatus === "saving" && (
            <span className="text-xs text-gray-500">Saving...</span>
          )}
          {saveStatus === "saved" && (
            <span className="text-xs text-green-500">Saved</span>
          )}
          {saveStatus === "unsaved" && (
            <span className="text-xs text-yellow-500">Unsaved</span>
          )}
        </div>
        <div className="flex-1 min-h-0">
          {openFile.isBinary ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
              Binary file — cannot display
            </div>
          ) : openFile.tooLarge ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
              File too large to display (&gt;1MB)
            </div>
          ) : isMarkdown && mdMode === "preview" ? (
            <MarkdownPreview content={editContent} />
          ) : (
            <Editor
              value={editContent}
              language={getLanguageFromPath(openFile.path)}
              theme={monacoThemeName(theme)}
              onChange={isMarkdown ? handleEditorChange : undefined}
              onMount={(editor) => {
                editorRef.current = editor;
                if (cursorTargetLine && cursorTargetLine > 0) {
                  editor.revealLineInCenter(cursorTargetLine);
                  editor.setPosition({
                    lineNumber: cursorTargetLine,
                    column: 1,
                  });
                }
              }}
              options={{
                readOnly: !isMarkdown,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
                fontFamily: MONO_FONT_FAMILY,
                lineNumbers: "on",
                renderLineHighlight: "none",
                folding: true,
                wordWrap: "on",
                contextmenu: false,
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                overviewRulerBorder: false,
                scrollbar: {
                  verticalScrollbarSize: 6,
                  horizontalScrollbarSize: 6,
                },
              }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">
            Loading...
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-red-400 text-sm">{error}</div>
        ) : tree.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">
            Empty directory
          </div>
        ) : (
          <TreeView
            nodes={tree}
            depth={0}
            onToggleFolder={toggleFolder}
            onFileClick={handleFileClick}
          />
        )}
      </div>
    </div>
  );
}

function TreeView({
  nodes,
  depth,
  onToggleFolder,
  onFileClick,
}: {
  nodes: TreeNode[];
  depth: number;
  onToggleFolder: (path: string) => void;
  onFileClick: (path: string, size: number) => void;
}): React.ReactElement {
  return (
    <div>
      {nodes.map((node) => (
        <div key={node.path}>
          <button
            className="w-full flex items-center gap-1.5 px-2 py-1 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-overlay)] transition-colors text-left"
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => {
              if (node.entry.type === "directory") {
                onToggleFolder(node.path);
              } else {
                onFileClick(node.path, node.entry.size);
              }
            }}
          >
            {node.entry.type === "directory" ? (
              <>
                <Chevron expanded={node.expanded} />
                <FolderIcon expanded={node.expanded} />
              </>
            ) : (
              <>
                <span className="w-3" />
                <FileIcon />
              </>
            )}
            <span className="truncate">{node.entry.name}</span>
            {node.entry.type === "file" && (
              <span className="ml-auto text-xs text-[var(--text-muted)] flex-shrink-0">
                {formatSize(node.entry.size)}
              </span>
            )}
          </button>
          {node.expanded && node.children && (
            <TreeView
              nodes={node.children}
              depth={depth + 1}
              onToggleFolder={onToggleFolder}
              onFileClick={onFileClick}
            />
          )}
        </div>
      ))}
    </div>
  );
}
