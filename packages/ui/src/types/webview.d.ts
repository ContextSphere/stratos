interface WebviewFailLoadEvent extends Event {
  errorCode: number;
  errorDescription: string;
  validatedURL: string;
  isMainFrame: boolean;
}

interface WebviewNavigateEvent extends Event {
  url: string;
}

interface WebviewHTMLElement extends HTMLElement {
  src: string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  addEventListener(event: "did-start-loading", listener: () => void): void;
  addEventListener(event: "did-stop-loading", listener: () => void): void;
  addEventListener(
    event: "did-fail-load",
    listener: (e: WebviewFailLoadEvent) => void,
  ): void;
  addEventListener(
    event: "did-navigate",
    listener: (e: WebviewNavigateEvent) => void,
  ): void;
  addEventListener(
    event: "did-navigate-in-page",
    listener: (e: WebviewNavigateEvent) => void,
  ): void;
  removeEventListener(event: string, listener: EventListener): void;
}

declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<WebviewHTMLElement> & {
          src?: string;
          allowpopups?: string;
          partition?: string;
          useragent?: string;
          webpreferences?: string;
        },
        WebviewHTMLElement
      >;
    }
  }
}
