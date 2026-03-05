export type PreviewType = 'url' | 'markdown' | 'artifact-editor'

export interface PreviewState {
  isOpen: boolean
  type: PreviewType
  url?: string
  markdownContent?: string
  title: string
  artifactContent?: string
  artifactFilePath?: string
}
