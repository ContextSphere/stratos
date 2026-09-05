import {
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { ImageAttachment, FileAttachment } from "../types";
import { SlashCommandMenu, type SlashCommandInfo } from "./SlashCommandMenu";
import { FileMentionMenu } from "./FileMentionMenu";
import { PendingMessages, type PendingMessageView } from "./PendingMessages";
import { processFiles } from "./attached-files";
import {
  useFileMentions,
  type FileMentionsBridge,
} from "../hooks/useFileMentions";
import { useDesignVariant } from "../context/DesignContext";

export type InteractiveMode =
  | { type: "none" }
  | { type: "plan-review"; requestId: string; data: unknown }
  | { type: "question"; requestId: string; data: unknown };

/**
 * How a message typed mid-turn should be delivered. Mirrors
 * `PendingDelivery` in @stratosapp/core; kept structural here so the UI
 * package stays free of provider concerns.
 */
export type SendDelivery = "queue" | "steer";

export interface Props {
  onSend: (
    prompt: string,
    images?: ImageAttachment[],
    fileAttachments?: FileAttachment[],
    delivery?: SendDelivery,
  ) => Promise<void>;
  onInterrupt: () => Promise<void>;
  isStreaming: boolean;
  interactiveMode?: InteractiveMode;
  onInteractiveResponse?: (text: string) => void;
  slashCommands?: SlashCommandInfo[];
  cwd?: string;
  filesBridge?: FileMentionsBridge;
  pendingMessages?: PendingMessageView[];
  onCancelPending?: (id: string) => void;
  onPromotePending?: (id: string, to: "steer" | "break") => void;
  onEditPending?: (message: PendingMessageView) => void;
  /** Runtime, permission, and context controls rendered inside the composer. */
  toolbar?: ReactNode;
}

export interface InputBarRef {
  focus: () => void;
  prefill: (text: string) => void;
  getText: () => string;
  getImages: () => ImageAttachment[];
  getFileAttachments: () => FileAttachment[];
  prefillDraft: (
    text: string,
    images: ImageAttachment[],
    fileAttachments?: FileAttachment[],
  ) => void;
}

export const InputBar = forwardRef<InputBarRef, Props>(function InputBar(
  {
    onSend,
    onInterrupt,
    isStreaming,
    interactiveMode,
    onInteractiveResponse,
    slashCommands = [],
    cwd,
    filesBridge,
    pendingMessages = [],
    onCancelPending,
    onPromotePending,
    onEditPending,
    toolbar,
  },
  ref,
): React.ReactElement {
  const classic = useDesignVariant() === "classic";
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [slashMenu, setSlashMenu] = useState<{ triggerPos: number } | null>(
    null,
  );
  const [mentionMenu, setMentionMenu] = useState<{
    triggerPos: number;
    query: string;
  } | null>(null);
  const { files: mentionFiles, loading: mentionLoading } = useFileMentions(
    cwd,
    filesBridge,
  );
  const [hasContent, setHasContent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const editableRef = useRef<HTMLDivElement>(null);
  const draftTextRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);
  const filesBridgeRef = useRef(filesBridge);
  filesBridgeRef.current = filesBridge;

  function getPlainText(): string {
    const el = editableRef.current;
    if (!el) return "";
    return (el.textContent ?? "").replace(/\u00A0/g, " ");
  }

  useLayoutEffect(() => {
    if (editableRef.current) {
      editableRef.current.textContent = draftTextRef.current;
    }
    setSlashMenu(null);
    setMentionMenu(null);
    setIsDragging(false);
    dragCounterRef.current = 0;
  }, [classic]);

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
        draftTextRef.current = text;
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
      getImages: () => images,
      getFileAttachments: () => fileAttachments,
      prefillDraft: (
        text: string,
        imgs: ImageAttachment[],
        files?: FileAttachment[],
      ) => {
        draftTextRef.current = text;
        if (editableRef.current) {
          editableRef.current.textContent = text;
          setHasContent(
            text.trim().length > 0 ||
              imgs.length > 0 ||
              (files?.length ?? 0) > 0,
          );
          setImages(imgs);
          setFileAttachments(files ?? []);
          if (text) {
            editableRef.current.focus();
            const range = document.createRange();
            range.selectNodeContents(editableRef.current);
            range.collapse(false);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        }
      },
    }),
    [images, fileAttachments],
  );

  const handleSend = useCallback(
    async (delivery: SendDelivery = "steer") => {
      const trimmed = getPlainText().trim();
      if (!trimmed && images.length === 0 && fileAttachments.length === 0)
        return;

      if (interactiveMode && interactiveMode.type !== "none") {
        onInteractiveResponse?.(trimmed);
        if (editableRef.current) editableRef.current.innerHTML = "";
        draftTextRef.current = "";
        setHasContent(false);
        setImages([]);
        setFileAttachments([]);
        setSlashMenu(null);
        setMentionMenu(null);
        return;
      }

      // Keep the composer intact until the host accepts the delivery request.
      // If IPC fails, the user can retry without reconstructing their message.
      setSendError(null);
      try {
        await onSend(
          trimmed,
          images.length > 0 ? images : undefined,
          fileAttachments.length > 0 ? fileAttachments : undefined,
          isStreaming ? delivery : undefined,
        );
      } catch (err) {
        setSendError(
          err instanceof Error ? err.message : "Message could not be sent.",
        );
        return;
      }

      if (editableRef.current) editableRef.current.innerHTML = "";
      draftTextRef.current = "";
      setHasContent(false);
      setImages([]);
      setFileAttachments([]);
      setSlashMenu(null);
      setMentionMenu(null);
    },
    [
      images,
      fileAttachments,
      isStreaming,
      interactiveMode,
      onInteractiveResponse,
      onSend,
    ],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mentionHasResults =
        mentionMenu !== null &&
        (mentionLoading ||
          mentionFiles.some(
            (f) =>
              mentionMenu.query === "" ||
              (f.split("/").pop() ?? f)
                .toLowerCase()
                .includes(mentionMenu.query.toLowerCase()),
          ));
      if (slashMenu || mentionHasResults) return;
      if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        // Queue safely while a turn is running. The pending row exposes an
        // explicit "Steer now" action if the user wants to escalate it.
        const isAnsweringPrompt =
          interactiveMode && interactiveMode.type !== "none";
        handleSend(isStreaming && !isAnsweringPrompt ? "queue" : "steer");
      }
    },
    [
      handleSend,
      slashMenu,
      mentionMenu,
      mentionFiles,
      mentionLoading,
      isStreaming,
      interactiveMode,
    ],
  );

  const handleInput = useCallback(() => {
    const text = getPlainText();
    draftTextRef.current = text;
    setHasContent(text.trim().length > 0);

    const textBefore = getTextBeforeCursor();

    // Slash command detection
    if (slashCommands.length > 0) {
      const lastSlashIdx = textBefore.lastIndexOf("/");
      if (
        lastSlashIdx >= 0 &&
        (lastSlashIdx === 0 || /\s/.test(textBefore[lastSlashIdx - 1]))
      ) {
        const afterSlash = textBefore.slice(lastSlashIdx);
        if (!afterSlash.includes(" ") || afterSlash === "/") {
          setSlashMenu({ triggerPos: lastSlashIdx });
          setMentionMenu(null);
          return;
        }
      }
      setSlashMenu(null);
    }

    // @ file mention detection
    if (filesBridgeRef.current?.listAllFiles) {
      const lastAtIdx = textBefore.lastIndexOf("@");
      if (
        lastAtIdx >= 0 &&
        (lastAtIdx === 0 || /\s/.test(textBefore[lastAtIdx - 1]))
      ) {
        const afterAt = textBefore.slice(lastAtIdx + 1); // exclude @
        if (!afterAt.includes(" ")) {
          setMentionMenu({ triggerPos: lastAtIdx, query: afterAt });
          return;
        }
      }
      setMentionMenu(null);
    }
  }, [slashCommands]); // filesBridge accessed via ref — only slashCommands is a reactive dep

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
      const insertedText = document.createTextNode(command + " ");
      range.insertNode(insertedText);

      const newRange = document.createRange();
      newRange.setStart(insertedText, insertedText.length);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);

      setSlashMenu(null);
      const text = getPlainText();
      draftTextRef.current = text;
      setHasContent(text.trim().length > 0);
      el.focus();
    },
    [slashMenu],
  );

  const handleMentionSelect = useCallback(
    (filePath: string) => {
      if (mentionMenu === null || !editableRef.current) return;
      const el = editableRef.current;

      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let charCount = 0;
      let triggerNode: Text | null = null;
      let triggerOffset = 0;

      while (walker.nextNode()) {
        const textNode = walker.currentNode as Text;
        const len = textNode.length;
        if (charCount + len >= mentionMenu.triggerPos) {
          triggerNode = textNode;
          triggerOffset = mentionMenu.triggerPos - charCount;
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
      const insertedText = document.createTextNode("@" + filePath + " ");
      range.insertNode(insertedText);

      const newRange = document.createRange();
      newRange.setStart(insertedText, insertedText.length);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);

      setMentionMenu(null);
      const text = getPlainText();
      draftTextRef.current = text;
      setHasContent(text.trim().length > 0);
      el.focus();
    },
    [mentionMenu],
  );

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || e.target.files.length === 0) return;
      const { images: newImages, fileAttachments: newFiles } =
        await processFiles(e.target.files);
      if (newImages.length > 0) setImages((prev) => [...prev, ...newImages]);
      if (newFiles.length > 0)
        setFileAttachments((prev) => [...prev, ...newFiles]);
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
    const { images: newImages, fileAttachments: newFiles } = await processFiles(
      e.dataTransfer.files,
    );
    if (newImages.length > 0) setImages((prev) => [...prev, ...newImages]);
    if (newFiles.length > 0)
      setFileAttachments((prev) => [...prev, ...newFiles]);
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const removeFileAttachment = useCallback((id: string) => {
    setFileAttachments((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const isInteractive = interactiveMode && interactiveMode.type !== "none";
  // Content is all that gates sending now: Enter queues while a turn is
  // running, and the pending row exposes explicit steering controls.
  const canSend = hasContent || images.length > 0 || fileAttachments.length > 0;

  const placeholder = useMemo(() => {
    if (isDragging) return "Drop files...";
    if (interactiveMode?.type === "plan-review")
      return "Provide feedback to revise the plan...";
    if (interactiveMode?.type === "question") return "Type your answer...";
    return "Type a message...";
  }, [isDragging, interactiveMode]);

  if (classic) {
    return (
      <div
        ref={containerRef}
        className={`relative flex-shrink-0 border-t transition-colors ${isDragging ? "border-blue-500 bg-blue-950/20" : "border-[var(--border)] bg-[var(--bg-main)]"} p-4`}
        data-testid="input-bar"
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
        {mentionMenu !== null && (
          <FileMentionMenu
            files={mentionFiles}
            query={mentionMenu.query}
            position={{
              bottom: containerRef.current
                ? containerRef.current.offsetHeight
                : 60,
              left: 16,
            }}
            onSelect={handleMentionSelect}
            onClose={() => setMentionMenu(null)}
            loading={mentionLoading}
          />
        )}
        <div className="flex flex-col gap-2">
          <PendingMessages
            pending={pendingMessages}
            isStreaming={isStreaming}
            onCancel={onCancelPending ?? (() => {})}
            onPromote={onPromotePending ?? (() => {})}
            onEdit={onEditPending ?? (() => {})}
          />
          {isDragging && (
            <div className="text-center text-blue-400 text-xs py-1">
              Drop files here
            </div>
          )}
          {(images.length > 0 || fileAttachments.length > 0) && (
            <div className="flex flex-wrap gap-2">
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
              {fileAttachments.map((file) => (
                <div
                  key={file.id}
                  className="relative group flex-shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[var(--border-mid)] bg-[var(--bg-surface)] text-[var(--text-secondary)] text-xs max-w-[180px]"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-3 h-3 flex-shrink-0"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="truncate" title={file.path}>
                    {file.name}
                  </span>
                  <button
                    onClick={() => removeFileAttachment(file.id)}
                    className="flex-shrink-0 w-3.5 h-3.5 rounded-full bg-gray-700 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[9px] leading-none"
                    title={`Remove ${file.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {sendError && (
            <p role="alert" className="text-xs text-red-400">
              {sendError}
            </p>
          )}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="no-drag flex-shrink-0 w-10 h-10 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-mid)] hover:bg-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors"
              title="Attach file"
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
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
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
            {isStreaming && !isInteractive && (
              <button
                onClick={() => onInterrupt()}
                className="no-drag flex-shrink-0 w-10 h-10 rounded-xl bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition-colors"
                title="Stop current turn"
                aria-label="Stop current turn"
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
            )}
            <button
              onClick={() =>
                handleSend(isStreaming && !isInteractive ? "queue" : "steer")
              }
              disabled={!canSend}
              className={`no-drag flex-shrink-0 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-[var(--border-mid)] disabled:cursor-not-allowed text-white flex items-center justify-center gap-1.5 transition-colors ${isStreaming && !isInteractive ? "px-3" : "w-10"}`}
              title={
                isStreaming && !isInteractive
                  ? "Queue for the next turn (Enter)"
                  : "Send"
              }
              aria-label={
                isStreaming && !isInteractive
                  ? "Queue for the next turn"
                  : "Send"
              }
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-4 h-4"
              >
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
              {isStreaming && !isInteractive && (
                <span className="text-xs font-medium">
                  Queue <span className="text-blue-100/70">Enter</span>
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative flex-shrink-0 px-4 pb-4 pt-2 transition-colors ${
        isDragging ? "bg-[var(--bg-overlay)]" : "bg-[var(--bg-main)]"
      }`}
      data-testid="input-bar"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="relative mx-auto flex w-full max-w-[720px] flex-col gap-2">
        {slashMenu !== null && slashCommands.length > 0 && (
          <SlashCommandMenu
            commands={slashCommands}
            filter={getPlainText().slice(slashMenu.triggerPos)}
            position={{
              bottom: "calc(100% + 8px)",
              left: 0,
            }}
            onSelect={handleSlashSelect}
            onClose={() => setSlashMenu(null)}
          />
        )}
        {mentionMenu !== null && (
          <FileMentionMenu
            files={mentionFiles}
            query={mentionMenu.query}
            position={{
              bottom: "calc(100% + 8px)",
              left: 0,
            }}
            onSelect={handleMentionSelect}
            onClose={() => setMentionMenu(null)}
            loading={mentionLoading}
          />
        )}
        <PendingMessages
          pending={pendingMessages}
          isStreaming={isStreaming}
          onCancel={onCancelPending ?? (() => {})}
          onPromote={onPromotePending ?? (() => {})}
          onEdit={onEditPending ?? (() => {})}
        />

        {isDragging && (
          <div className="text-center text-blue-400 text-xs py-1">
            Drop files here
          </div>
        )}

        <div
          className={`overflow-visible rounded-[14px] border bg-[var(--bg-surface)] transition-colors ${
            isDragging
              ? "border-[var(--text-muted)]"
              : "border-[var(--border)] focus-within:border-[var(--border-mid)]"
          }`}
        >
          {(images.length > 0 || fileAttachments.length > 0) && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
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
              {fileAttachments.map((file) => (
                <div
                  key={file.id}
                  className="relative group flex-shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[var(--border-mid)] bg-[var(--bg-surface)] text-[var(--text-secondary)] text-xs max-w-[180px]"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-3 h-3 flex-shrink-0"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="truncate" title={file.path}>
                    {file.name}
                  </span>
                  <button
                    onClick={() => removeFileAttachment(file.id)}
                    className="flex-shrink-0 w-3.5 h-3.5 rounded-full bg-gray-700 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[9px] leading-none"
                    title={`Remove ${file.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {sendError && (
            <p
              role="alert"
              className="px-3 pt-2 text-xs text-[var(--text-danger)]"
            >
              {sendError}
            </p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />

          <div
            ref={editableRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            data-placeholder={placeholder}
            className="no-drag min-h-[70px] max-h-[220px] w-full overflow-y-auto whitespace-pre-wrap bg-transparent px-4 pb-2 pt-3.5 text-[15px] leading-6 text-[var(--text-primary)] empty:before:pointer-events-none empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--text-muted)] focus:outline-none"
            role="textbox"
            aria-multiline="true"
          />

          <div className="flex min-h-11 items-center justify-between gap-3 px-2.5 pb-2 pt-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="no-drag flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-muted)]"
                title="Attach file"
                aria-label="Attach file"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              <div className="flex min-w-0 items-center gap-1.5">{toolbar}</div>
            </div>

            <div className="flex flex-shrink-0 items-center gap-1.5">
              {/* Stop remains distinct from sending. While streaming, sending
                  queues safely; the pending row offers "Steer now" afterward. */}
              {isStreaming && !isInteractive && (
                <button
                  onClick={() => onInterrupt()}
                  className="no-drag flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-[var(--bg-danger)] text-[var(--text-danger)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-danger)]"
                  title="Stop current turn"
                  aria-label="Stop current turn"
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
              )}
              <button
                onClick={() =>
                  handleSend(isStreaming && !isInteractive ? "queue" : "steer")
                }
                disabled={!canSend}
                className={`no-drag flex h-8 flex-shrink-0 items-center justify-center gap-1.5 rounded-md bg-[var(--text-primary)] text-[var(--bg-main)] transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-muted)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] disabled:cursor-not-allowed disabled:bg-[var(--border-mid)] disabled:text-[var(--text-muted)] ${
                  isStreaming && !isInteractive ? "px-2.5" : "w-8"
                }`}
                title={
                  isStreaming && !isInteractive
                    ? "Queue for the next turn (Enter)"
                    : "Send"
                }
                aria-label={
                  isStreaming && !isInteractive
                    ? "Queue for the next turn"
                    : "Send"
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M12 19V5" />
                  <path d="m5 12 7-7 7 7" />
                </svg>
                {isStreaming && !isInteractive && (
                  <span className="text-xs font-medium">Queue</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
