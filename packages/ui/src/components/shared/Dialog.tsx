import { ReactNode, useCallback, useEffect } from "react";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className={`no-drag bg-[var(--bg-surface)] border border-[var(--border-mid)] rounded-2xl shadow-2xl w-full ${maxWidthStyles[maxWidth]} mx-4 overflow-hidden`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <div className="flex items-center gap-3">
            {icon && (
              <div
                className={`w-8 h-8 rounded-lg bg-gradient-to-br ${iconGradient} flex items-center justify-center`}
              >
                {icon}
              </div>
            )}
            <div>
              <h2 className="text-base font-semibold text-gray-200">{title}</h2>
              {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1"
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
        <div className="px-6 pb-6">{children}</div>
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
        <h3 className="text-sm font-medium text-gray-300 mb-2">{title}</h3>
      )}
      {children}
    </div>
  );
}
