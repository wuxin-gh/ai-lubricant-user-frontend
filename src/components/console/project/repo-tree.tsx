/**
 * Shared repository-tree primitives.
 *
 * Extracted verbatim from ``console/project/files.tsx`` so the project file
 * manager and the README link preview dialog render an identical tree: same
 * mode mapping, sort order, icons, size formatting and lazy child loading.
 */
import { useState, useCallback, memo } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { type DomainProjectTreeEntry } from "@/api/Api"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { IconFileText, IconFolder, IconFolderOpen, IconLoader, IconGitBranch, IconFileSymlink } from "@tabler/icons-react"
import dayjs from "dayjs"

export type TreeEntry = DomainProjectTreeEntry & {
  /** 子模块条目（mode===SUBMODULE）由后端 get_tree 直接挂上的关联信息：
   *  匹配到平台项目时带 project_id/project_name，无论是否匹配都带 url。前端
   *  点子模块就用 project_id 像普通目录一样展开它的根树，不再单独拉 submodules。 */
  project_id?: string
  project_name?: string
  url?: string
  branch?: string
}

/**
 * One entry of GET /api/v1/users/projects/{id}/submodules. The generated
 * contract does not declare it — the compat backend derives it from the
 * repository's ``.gitmodules`` and nothing is stored.
 */
export interface SubmoduleInfo {
  path?: string
  name?: string
  url?: string
  branch?: string
  project_id?: string
  project_name?: string
}

export const FileMode = {
  UNKNOWN: 0,
  REGULAR: 1,
  EXECUTABLE: 2,
  SYMLINK: 3,
  DIRECTORY: 4,
  SUBMODULE: 5,
} as const

// Preview thresholds: text goes through the JSON blob (base64 in-memory +
// AceEditor), images go through /tree/blob/raw and are decoded by the browser,
// which can handle larger payloads.
export const MAX_TEXT_PREVIEW_SIZE = 1 * 1024 * 1024
export const MAX_IMAGE_PREVIEW_SIZE = 5 * 1024 * 1024

export const getLanguageMode = (fileName: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const modeMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'sh': 'sh',
    'bash': 'sh',
    'zsh': 'sh',
    'fish': 'sh',
    'sql': 'sql',
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'markdown': 'markdown',
    'dockerfile': 'dockerfile',
  }
  return modeMap[ext || ''] || 'text'
}

/** Images use the raw endpoint: the backend returns Content-Type + inline by
 * extension, so binary bytes are not lossily decoded as text. */
export const buildRawBlobUrl = (projectId: string, path: string, ref: string): string => {
  const params = new URLSearchParams()
  params.set("path", path)
  if (ref) params.set("ref", ref)
  return `/api/v1/users/projects/${encodeURIComponent(projectId)}/tree/blob/raw?${params.toString()}`
}

export const isDirectory = (entry: TreeEntry) => {
  return entry.mode === FileMode.DIRECTORY
}

export const sortEntries = (entries: TreeEntry[]) => {
  return [...entries].sort((a, b) => {
    const aIsDir = isDirectory(a) || a.mode === FileMode.SUBMODULE
    const bIsDir = isDirectory(b) || b.mode === FileMode.SUBMODULE

    // 目录（含子模块）优先，文件在后
    if (aIsDir !== bIsDir) {
      return aIsDir ? -1 : 1
    }

    // 同类内按名字字母序（.gitignore 等以 . 开头的文件也按字母序，不特殊处理）
    return (a.name || '').localeCompare(b.name || '')
  })
}

export const getFileIcon = (entry: TreeEntry, isOpen?: boolean, loading?: boolean) => {
  if (loading) {
    return <IconLoader className="h-4 w-4 shrink-0 animate-spin" />
  }
  switch (entry.mode) {
    case FileMode.DIRECTORY:
      return isOpen
        ? <IconFolderOpen className="h-4 w-4 text-primary shrink-0" />
        : <IconFolder className="h-4 w-4 text-primary shrink-0" />
    case FileMode.SYMLINK:
      return <IconFileSymlink className="h-4 w-4 text-muted-foreground shrink-0" />
    case FileMode.SUBMODULE:
      return <IconGitBranch className="h-4 w-4 text-primary shrink-0" />
    case FileMode.REGULAR:
    case FileMode.EXECUTABLE:
    default:
      return <IconFileText className="h-4 w-4 text-muted-foreground shrink-0" />
  }
}

export const formatSize = (size?: number) => {
  if (size === undefined || size === null) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

interface TreeNodeProps {
  entry: TreeEntry
  projectId: string
  depth: number
  branch?: string
  onFileClick?: (entry: TreeEntry) => void
}

export const TreeNode = memo(({ entry, projectId, depth, branch, onFileClick }: TreeNodeProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [children, setChildren] = useState<TreeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // 子模块（gitlink）就是一个目录：后端 get_tree 认得子模块路径，会用
  // .gitmodules 里的地址去拉那个仓库的树并补回路径前缀，所以这里不做任何
  // 特殊处理——同一个接口、同一个 path、同一套展开逻辑。
  const isDir = isDirectory(entry) || entry.mode === FileMode.SUBMODULE

  const loadChildren = useCallback(async () => {
    if (loaded || !isDir) return

    setLoading(true)
    await apiRequest('v1UsersProjectsTreeDetail', {
      recursive: false,
      path: entry.path,
      ref: branch || undefined,
    }, [projectId], (resp) => {
      if (resp.code === 0) {
        setChildren(sortEntries(resp.data || []))
        setLoaded(true)
      }
    })
    setLoading(false)
  }, [isDir, projectId, entry.path, branch, loaded])

  const handleToggle = useCallback((open: boolean) => {
    setIsOpen(open)
    if (open && !loaded) {
      loadChildren()
    }
  }, [loaded, loadChildren])

  const handleClick = useCallback(() => {
    if (isDir) {
      handleToggle(!isOpen)
      return
    }
    if (onFileClick) {
      onFileClick(entry)
    }
  }, [isDir, isOpen, handleToggle, onFileClick, entry])

  const paddingLeft = depth * 16

  if (isDir) {
    return (
      <Collapsible open={isOpen} onOpenChange={handleToggle}>
        <CollapsibleTrigger asChild>
          <div
            className="flex items-center gap-1.5 py-2.5 px-4 hover:bg-accent/50 rounded-sm cursor-pointer select-none group border-b border-border/50"
            style={{ paddingLeft: `${paddingLeft + 12}px` }}
          >
            {getFileIcon(entry, isOpen, loading)}
            <span className="text-sm truncate flex-1 group-hover:text-primary">{entry.name}</span>
            <div className="text-muted-foreground text-xs shrink-0">-</div>
            {entry.last_modified_at ? (
              <div className="text-muted-foreground text-xs shrink-0 w-30 text-right">
                {dayjs.unix(entry.last_modified_at).fromNow()}
              </div>
            ) : null}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              projectId={projectId}
              depth={depth + 1}
              branch={branch}
              onFileClick={onFileClick}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <div
      className="flex items-center gap-1.5 py-2.5 px-4 hover:bg-accent/50 group rounded-sm cursor-pointer select-none border-b border-border/50"
      style={{ paddingLeft: `${paddingLeft + 12}px` }}
      onClick={handleClick}
    >
      {getFileIcon(entry)}
      <div className="text-sm truncate flex-1 group-hover:text-primary">
        {entry.name}
      </div>
      <div className="text-muted-foreground text-xs shrink-0">
        {formatSize(entry.size)}
      </div>
      {entry.last_modified_at ? (
        <div className="text-muted-foreground text-xs shrink-0 w-30 text-right">
          {dayjs.unix(entry.last_modified_at).fromNow()}
        </div>
      ) : null}
    </div>
  )
})

TreeNode.displayName = 'TreeNode'
