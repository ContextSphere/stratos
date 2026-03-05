import type { PreviewState } from '../types/preview'
import { MarkdownPreview } from './preview/MarkdownPreview'
import { ArtifactEditorPreview } from './preview/ArtifactEditorPreview'

interface Props {
  preview: PreviewState
  onClose: () => void
}

const TYPE_LABELS: Record<string, string> = {
  url: 'Web',
  markdown: 'Markdown',
  'artifact-editor': 'Editor'
}

export function PreviewPane({ preview, onClose }: Props): React.ReactElement {
  const handleOpenExternal = (): void => {
    if (preview.url) {
      window.open(preview.url, '_blank')
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f] border-l border-[#2a2a2a]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2a2a2a] flex-shrink-0">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#2a2a2a] text-gray-400 uppercase tracking-wide">
          {TYPE_LABELS[preview.type] || 'Preview'}
        </span>
        <span className="text-xs text-gray-500 truncate flex-1" title={preview.title}>
          {preview.title}
        </span>
        {preview.url && (
          <button
            onClick={handleOpenExternal}
            className="p-1 rounded hover:bg-[#2a2a2a] text-gray-500 hover:text-gray-300 transition-colors"
            title="Open in browser"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        )}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[#2a2a2a] text-gray-500 hover:text-gray-300 transition-colors"
          title="Close preview"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Content */}
      {preview.type === 'artifact-editor' && preview.artifactContent !== undefined && preview.artifactFilePath ? (
        <ArtifactEditorPreview
          content={preview.artifactContent}
          filePath={preview.artifactFilePath}
        />
      ) : preview.type === 'markdown' && preview.markdownContent ? (
        <MarkdownPreview content={preview.markdownContent} />
      ) : preview.url ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          External URL preview not available
        </div>
      ) : null}
    </div>
  )
}
