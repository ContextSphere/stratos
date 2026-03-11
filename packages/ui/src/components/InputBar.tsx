import {
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from "react";
import type { ImageAttachment } from "../types";
import { SlashCommandMenu, type SlashCommandInfo } from "./SlashCommandMenu";

export type InteractiveMode =
  | { type: "none" }
  | { type: "plan-review"; requestId: string; data: unknown }
  | { type: "question"; requestId: string; data: unknown };

interface Props {
  onSend: (prompt: string, images?: ImageAttachment[]) => Promise<void>;
  onInterrupt: () => Promise<void>;
  isStreaming: boolean;
  interactiveMode?: InteractiveMode;
  onInteractiveResponse?: (text: string) => void;
  slashCommands?: SlashCommandInfo[];
}

export interface InputBarRef {
  focus: () => void;
  prefill: (text: string) => void;
  getText: () => string;
}

async function readImageFile(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        dataUrl: reader.result as string,
        mimeType: file.type,
      });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function processFiles(
  files: FileList | File[],
): Promise<ImageAttachment[]> {
  const imageFiles = Array.from(files).filter((f) =>
    f.type.startsWith("image/"),
  );
  return Promise.all(imageFiles.map(readImageFile));
}

export const InputBar = forwardRef<InputBarRef, Props>(function InputBar(
  {
    onSend,
    onInterrupt,
    isStreaming,
    interactiveMode,
    onInteractiveResponse,
    slashCommands = [],
  },
  ref,
): React.ReactElement {
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [slashMenu, setSlashMenu] = useState<{ triggerPos: number } | null>(
    null,
  );
  const [hasContent, setHasContent] = useState(false);
  const editableRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);

  function getPlainText(): string {
    const el = editableRef.current;
    if (!el) return "";
    return (el.textContent ?? "").replace(/\u00A0/g, " ");
  }

  function getTextBeforeCursor(): string {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !editableRef.current) return "";
    const range = selection.getRangeAt(0);
    const preRange = range.cloneRange();
    preRange.selectNodeContents(editableRef.current);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString();
  }

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editableRef.current?.focus(),
      prefill: (text: string) => {
        if (editableRef.current) {
          editableRef.current.textContent = text;
          setHasContent(text.trim().length > 0);
          editableRef.current.focus();
          const range = document.createRange();
          range.selectNodeContents(editableRef.current);
          range.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      },
      getText: () => getPlainText(),
    }),
    [],
  );

  const handleSend = useCallback(async () => {
    const trimmed = getPlainText().trim();
    if (!trimmed && images.length === 0) return;

    if (interactiveMode && interactiveMode.type !== "none") {
      onInteractiveResponse?.(trimmed);
      if (editableRef.current) editableRef.current.innerHTML = "";
      setHasContent(false);
      setImages([]);
      setSlashMenu(null);
      return;
    }

    if (isStreaming) return;

    const sentImages = images;
    if (editableRef.current) editableRef.current.innerHTML = "";
    setHasContent(false);
    setImages([]);
    setSlashMenu(null);

    await onSend(trimmed, sentImages.length > 0 ? sentImages : undefined);
  }, [images, isStreaming, interactiveMode, onInteractiveResponse, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (slashMenu) return;
      if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, slashMenu],
  );

  const handleInput = useCallback(() => {
    setHasContent(getPlainText().trim().length > 0);

    const textBefore = getTextBeforeCursor();

    if (slashCommands.length > 0) {
      const lastSlashIdx = textBefore.lastIndexOf("/");
      if (
        lastSlashIdx >= 0 &&
        (lastSlashIdx === 0 || /\s/.test(textBefore[lastSlashIdx - 1]))
      ) {
        const afterSlash = textBefore.slice(lastSlashIdx);
        if (!afterSlash.includes(" ") || afterSlash === "/") {
          setSlashMenu({ triggerPos: lastSlashIdx });
          return;
        }
      }
      setSlashMenu(null);
    }
  }, [slashCommands]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }, []);

  const handleSlashSelect = useCallback(
    (command: string) => {
      if (slashMenu === null || !editableRef.current) return;
      const el = editableRef.current;

      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let charCount = 0;
      let triggerNode: Text | null = null;
      let triggerOffset = 0;

      while (walker.nextNode()) {
        const textNode = walker.currentNode as Text;
        const len = textNode.length;
        if (charCount + len >= slashMenu.triggerPos) {
          triggerNode = textNode;
          triggerOffset = slashMenu.triggerPos - charCount;
          break;
        }
        charCount += len;
      }

      if (!triggerNode) return;

      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      const cursorRange = selection.getRangeAt(0);

      const range = document.createRange();
      range.setStart(triggerNode, triggerOffset);
      range.setEnd(cursorRange.startContainer, cursorRange.startOffset);
      range.deleteContents();
      range.insertNode(document.createTextNode(command + " "));

      const insertedNode = range.startContainer;
      const newRange = document.createRange();
      newRange.setStart(insertedNode, insertedNode.textContent?.length ?? 0);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);

      setSlashMenu(null);
      setHasContent(getPlainText().trim().length > 0);
      el.focus();
    },
    [slashMenu],
  );

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || e.target.files.length === 0) return;
      const newImages = await processFiles(e.target.files);
      setImages((prev) => [...prev, ...newImages]);
      e.target.value = "";
    },
    [],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const newImages = await processFiles(e.dataTransfer.files);
    if (newImages.length > 0) setImages((prev) => [...prev, ...newImages]);
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const isInteractive = interactiveMode && interactiveMode.type !== "none";
  const canSend =
    (hasContent || images.length > 0) && (!isStreaming || isInteractive);

  const placeholder = useMemo(() => {
    if (isDragging) return "Drop image...";
    if (interactiveMode?.type === "plan-review")
      return "Provide feedback to revise the plan...";
    if (interactiveMode?.type === "question") return "Type your answer...";
    return "Type a message...";
  }, [isDragging, interactiveMode]);

  return (
    <div
      ref={containerRef}
      className={`relative flex-shrink-0 border-t transition-colors ${
        isDragging
          ? "border-blue-500 bg-blue-950/20"
          : "border-[var(--border)] bg-[var(--bg-main)]"
      } p-4`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {slashMenu !== null && slashCommands.length > 0 && (
        <SlashCommandMenu
          commands={slashCommands}
          filter={getPlainText().slice(slashMenu.triggerPos)}
          position={{
            bottom: containerRef.current
              ? containerRef.current.offsetHeight
              : 60,
            left: 16,
          }}
          onSelect={handleSlashSelect}
          onClose={() => setSlashMenu(null)}
        />
      )}
      <div>
        {isDragging && (
          <div className="mb-2 text-center text-blue-400 text-xs py-1">
            Drop image here
          </div>
        )}

        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {images.map((img) => (
              <div key={img.id} className="relative group flex-shrink-0">
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="w-12 h-12 object-cover rounded-lg border border-[var(--border-mid)]"
                  title={img.name}
                />
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-700 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px] leading-none"
                  title={`Remove ${img.name}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="no-drag flex-shrink-0 w-10 h-10 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-mid)] hover:bg-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors"
            title="Attach image"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>

          <div
            ref={editableRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            data-placeholder={placeholder}
            className="no-drag flex-1 min-h-[44px] max-h-[200px] overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-mid)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500 transition-colors empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--text-muted)] empty:before:pointer-events-none whitespace-pre-wrap"
            role="textbox"
            aria-multiline="true"
          />

          {isStreaming && !isInteractive ? (
            <button
              onClick={() => onInterrupt()}
              className="no-drag flex-shrink-0 w-10 h-10 rounded-xl bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition-colors"
              title="Stop"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-4 h-4"
              >
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="no-drag flex-shrink-0 w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-[var(--border-mid)] disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
              title="Send"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-4 h-4"
              >
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
