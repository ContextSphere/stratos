import { useDesignVariant } from "../../context/DesignContext";
import { ReactNode, useCallback, useEffect, useId } from "react";

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  iconGradient?: string;
  maxWidth?: "sm" | "md" | "lg";
  children: ReactNode;
}

/**
 * Reusable modal dialog component following design system patterns.
 *
 * @example
 * <Dialog
 *   isOpen={isOpen}
 *   onClose={handleClose}
 *   title="Connect Service"
 *   subtitle="Configure your integration"
 *   icon={<ServiceIcon />}
 *   iconGradient="from-blue-500 to-purple-600"
 * >
 *   <DialogBody>Content here</DialogBody>
 * </Dialog>
 */
export function Dialog({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  iconGradient = "from-blue-500 to-purple-600",
  maxWidth = "md",
  children,
}: DialogProps): React.ReactElement | null {
  const refined = useDesignVariant() === "refined";
  const titleId = useId();
  const maxWidthStyles = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${refined ? "bg-black/40" : "bg-black/60 backdrop-blur-sm"}`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`no-drag bg-[var(--bg-surface)] border border-[var(--border-mid)] ${refined ? "rounded-xl shadow-xl" : "rounded-2xl shadow-2xl"} w-full ${maxWidthStyles[maxWidth]} mx-4 flex flex-col max-h-[90vh]`}
      >
        {/* Header */}
        <div
          className={`flex-shrink-0 flex items-start justify-between ${refined ? "px-5 pt-5 pb-1" : "px-6 pt-6 pb-2"}`}
        >
          <div className="flex items-center gap-3">
            {icon && (
              <div
                className={`${refined ? "mt-0.5 text-[var(--text-muted)] [&_svg]:text-current" : `w-8 h-8 rounded-lg bg-gradient-to-br ${iconGradient}`} flex items-center justify-center`}
              >
                {icon}
              </div>
            )}
            <div>
              <h2
                id={titleId}
                className={`${refined ? "text-[15px] leading-5 tracking-[-0.015em]" : "text-base"} font-semibold text-[var(--text-primary)]`}
              >
                {title}
              </h2>
              {subtitle && (
                <p className="text-xs leading-5 mt-0.5 text-[var(--text-muted)]">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <button
            aria-label="Close dialog"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div
          className={`${refined ? "px-5 pb-5" : "px-6 pb-6"} overflow-y-auto`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Dialog body wrapper for consistent spacing
 */
export function DialogBody({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  return <div className="mt-4">{children}</div>;
}

/**
 * Dialog section with optional title
 */
export function DialogSection({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div className="mb-4 last:mb-0">
      {title && (
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}
