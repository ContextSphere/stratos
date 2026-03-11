import React from "react";

interface PanelCardProps {
  title: string;
  headerAction: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function PanelCard({
  title,
  headerAction,
  children,
  footer,
}: PanelCardProps): React.ReactElement {
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
        {headerAction}
      </div>
      <div className="max-h-96 overflow-y-auto">{children}</div>
      {footer && (
        <div className="px-4 py-2 border-t border-[var(--border)] text-xs text-gray-600">
          {footer}
        </div>
      )}
    </div>
  );
}
