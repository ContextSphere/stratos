import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center bg-[var(--bg-main)] text-[var(--text-primary)]">
          <div className="max-w-md text-center space-y-3">
            <p className="text-lg font-medium">Something went wrong</p>
            <p className="text-sm text-[var(--text-muted)]">
              {this.state.error.message}
            </p>
            <button
              className="px-4 py-1.5 text-sm rounded-md bg-[var(--border)] hover:bg-[var(--bg-surface)] transition-colors"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
