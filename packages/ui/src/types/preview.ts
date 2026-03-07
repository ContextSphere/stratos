export type PreviewType =
  | "url"
  | "markdown"
  | "artifact-editor"
  | "file-explorer";

export interface PreviewState {
  isOpen: boolean;
  type: PreviewType;
  url?: string;
  markdownContent?: string;
  title: string;
  artifactContent?: string;
  artifactFilePath?: string;
  cwd?: string;
}
