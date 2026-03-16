import React, { useRef, useState, useEffect, useCallback } from "react";

interface Props {
  url: string;
}

type LoadState = "loading" | "loaded" | "error";

interface ErrorInfo {
  code: number;
  description: string;
}

function NavButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1 rounded hover:bg-[var(--border)] text-gray-500 hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

export function WebviewPreview({ url }: Props): React.ReactElement {
  const webviewRef = useRef<WebviewHTMLElement>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const refreshNavState = useCallback(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    setCanGoBack(wv.canGoBack());
    setCanGoForward(wv.canGoForward());
  }, []);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onStartLoading = (): void => {
      setLoadState("loading");
      setError(null);
    };

    const onStopLoading = (): void => {
      setLoadState("loaded");
      refreshNavState();
    };

    const onFailLoad = (e: WebviewFailLoadEvent): void => {
      // ERR_ABORTED (-3) fires on redirects — not a real error
      if (e.isMainFrame && e.errorCode !== -3) {
        setLoadState("error");
        setError({ code: e.errorCode, description: e.errorDescription });
      }
    };

    const onNavigate = (): void => refreshNavState();

    wv.addEventListener("did-start-loading", onStartLoading);
    wv.addEventListener("did-stop-loading", onStopLoading);
    wv.addEventListener("did-fail-load", onFailLoad);
    wv.addEventListener("did-navigate", onNavigate);
    wv.addEventListener("did-navigate-in-page", onNavigate);

    return () => {
      wv.removeEventListener(
        "did-start-loading",
        onStartLoading as EventListener,
      );
      wv.removeEventListener(
        "did-stop-loading",
        onStopLoading as EventListener,
      );
      wv.removeEventListener("did-fail-load", onFailLoad as EventListener);
      wv.removeEventListener("did-navigate", onNavigate as EventListener);
      wv.removeEventListener(
        "did-navigate-in-page",
        onNavigate as EventListener,
      );
    };
  }, [refreshNavState]);

  const handleBack = (): void => webviewRef.current?.goBack();
  const handleForward = (): void => webviewRef.current?.goForward();
  const handleReload = (): void => {
    setLoadState("loading");
    setError(null);
    webviewRef.current?.reload();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Navigation toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-[var(--border)] flex-shrink-0">
        <NavButton onClick={handleBack} disabled={!canGoBack} title="Back">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </NavButton>
        <NavButton
          onClick={handleForward}
          disabled={!canGoForward}
          title="Forward"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </NavButton>
        <NavButton onClick={handleReload} disabled={false} title="Reload">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </NavButton>
      </div>

      {/* Content area */}
      <div className="relative flex-1 min-h-0">
        {/* Loading overlay */}
        {loadState === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-main)] z-10">
            <svg
              className="animate-spin"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          </div>
        )}

        {/* Error state */}
        {loadState === "error" && error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm z-10 bg-[var(--bg-main)]">
            <span className="text-red-400">Failed to load page</span>
            <span className="text-xs text-gray-500">
              {error.description} ({error.code})
            </span>
            <button
              onClick={handleReload}
              className="mt-2 px-3 py-1 rounded text-xs bg-[var(--border)] hover:bg-[var(--border-mid)] text-gray-300 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Webview — always mounted to preserve renderer process */}
        <webview
          ref={webviewRef}
          src={url}
          style={{
            width: "100%",
            height: "100%",
            visibility: loadState === "error" ? "hidden" : "visible",
          }}
        />
      </div>
    </div>
  );
}
