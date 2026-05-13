export type PreviewType =
  | "url"
  | "markdown"
  | "artifact-editor"
  | "file-explorer"
  | "terminal"
  | "image"
  | "pdf"
  | "file-changes";

export interface PreviewState {
  isOpen: boolean;
  type: PreviewType;
  url?: string;
  markdownContent?: string;
  title: string;
  artifactContent?: string;
  artifactFilePath?: string;
  imageFilePath?: string;
  imageDataUrl?: string;
  pdfFilePath?: string;
  pdfSourceFilePath?: string;
  cwd?: string;
  targetFilePath?: string;
  targetLine?: number;
}
