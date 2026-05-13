import React, { useMemo } from "react";

interface Props {
  pdfFilePath: string;
  sourceFilePath?: string;
}

function toFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const withSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${withSlash.split("/").map(encodeURIComponent).join("/")}`;
}

export function PdfPreview({ pdfFilePath }: Props): React.ReactElement {
  const url = useMemo(() => toFileUrl(pdfFilePath), [pdfFilePath]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--bg-main)]">
      <webview
        src={url}
        style={{ width: "100%", height: "100%", flex: 1 }}
        webpreferences="plugins=yes"
      />
    </div>
  );
}
