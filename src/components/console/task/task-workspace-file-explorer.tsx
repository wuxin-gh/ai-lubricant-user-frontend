import { useCallback, useEffect, useState } from "react"
import { IconChevronRight, IconCloudOff, IconFile, IconFolder, IconFolderOpen, IconLoader, IconReload, IconX } from "@tabler/icons-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { getUserTaskFiles, type UserTaskFileEntry } from "@/api/userTaskClient"

/**
 * 任务工作目录文件浏览（任务级）。只读：列出目录条目（含目录数），点击进入子目录，
 * 返回上级，点文件预览内容。数据走 /api/v1/users/tasks/{id}/files，服务端按任务工作区
 * 解析目录并防穿越。运行时未运行时后端 409，由父组件以 disabled 渲染禁用空态。
 */
/**
 * 目录优先排序：目录在前、文件在后，组内按名称字母序（不区分大小写）。
 * 与项目详情页的 repo-tree 排序规则一致，避免用户在不同页面看到不同的
 * 条目顺序。
 */
function sortEntries(entries: UserTaskFileEntry[]): UserTaskFileEntry[] {
  return [...entries].sort((a, b) => {
    const aDir = a.is_dir ? 0 : 1
    const bDir = b.is_dir ? 0 : 1
    if (aDir !== bDir) return aDir - bDir
    const aName = String(a.name || a.path || "").toLowerCase()
    const bName = String(b.name || b.path || "").toLowerCase()
    return aName.localeCompare(bName)
  })
}

export default function TaskFileExplorer({
  taskId,
  disabled,
  refreshSignal,
  onClosePanel,
}: {
  taskId: string
  disabled?: boolean
  refreshSignal?: number
  onClosePanel?: () => void
}) {
  const [path, setPath] = useState("/")
  const [entries, setEntries] = useState<UserTaskFileEntry[]>([])
  const [count, setCount] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ content: string; encoding: string; truncated: boolean } | null>(null)

  const load = useCallback(async (target: string) => {
    setLoading(true)
    try {
      const result = await getUserTaskFiles(taskId, target)
      setPath(result.path)
      if (result.is_dir) {
        setEntries(result.entries || [])
        setCount(result.count ?? (result.entries || []).length)
        setPreviewPath(null)
        setPreview(null)
      } else {
        setPreviewPath(result.path)
        setPreview({ content: result.content || "", encoding: result.encoding || "utf-8", truncated: Boolean(result.truncated) })
        setEntries([])
        setCount(undefined)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载文件列表失败")
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void load(path)
  }, [refreshSignal])

  function enter(entry: UserTaskFileEntry) {
    const next = joinPath(path, String(entry.name || entry.path || ""))
    void load(next)
  }

  function up() {
    void load(parentPath(path))
  }

  if (disabled) {
    return (
      <div className="flex h-full min-h-0 flex-col rounded-lg border">
        <Header onRefresh={() => void load(path)} onClosePanel={onClosePanel} />
        <Empty className="w-full flex-1 min-h-0">
          <EmptyHeader>
            <EmptyMedia variant="icon"><IconCloudOff className="size-6" /></EmptyMedia>
            <EmptyDescription>任务运行时未运行，无法浏览目录</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border">
      <Header path={path} count={count} loading={loading} onRefresh={() => void load(path)} onUp={path !== "/" ? up : undefined} onClosePanel={onClosePanel} />
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && entries.length === 0 && !preview ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : preview ? (
          <div className="flex h-full flex-col gap-2 p-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate font-mono">{previewPath}</span>
              <Button size="sm" variant="ghost" onClick={() => { setPreview(null); setPreviewPath(null); void load(parentPath(previewPath || "/")) }}>返回目录</Button>
            </div>
            <pre className={cn("min-h-0 flex-1 overflow-auto rounded border bg-muted/30 p-2 text-xs", preview.encoding === "base64" && "italic text-muted-foreground")}>
              {preview.encoding === "base64" ? "二进制文件（无法预览）" : preview.content}
            </pre>
            {preview.truncated && <div className="text-[11px] text-muted-foreground">已截断</div>}
          </div>
        ) : entries.length === 0 ? (
          <Empty className="w-full">
            <EmptyHeader>
              <EmptyMedia variant="icon"><IconFolder className="size-6" /></EmptyMedia>
              <EmptyDescription>空目录</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="p-1">
            {sortEntries(entries).map((entry) => {
              const name = String(entry.name || entry.path || "")
              return (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => enter(entry)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted"
                  >
                    {entry.is_dir ? <IconFolder className="size-4 shrink-0 text-muted-foreground" /> : <IconFile className="size-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function Header({ path, count, loading, onRefresh, onUp, onClosePanel }: { path?: string; count?: number; loading?: boolean; onRefresh: () => void; onUp?: () => void; onClosePanel?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-2 py-1.5">
      <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
        <IconFolderOpen className="size-3.5 shrink-0" />
        <span className="truncate font-mono">{path || "/"}</span>
        {count !== undefined && <span className="shrink-0 text-muted-foreground/70">· {count} 项</span>}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        {onUp && <Button variant="ghost" size="icon" className="size-7" title="上级目录" onClick={onUp}><IconChevronRight className="size-4 rotate-180" /></Button>}
        <Button variant="ghost" size="icon" className="size-7" title="刷新" onClick={onRefresh} disabled={loading}>{loading ? <IconLoader className="size-4 animate-spin" /> : <IconReload className="size-4" />}</Button>
        {onClosePanel && <Button variant="ghost" size="icon" className="size-7" title="关闭" onClick={onClosePanel}><IconX className="size-4" /></Button>}
      </div>
    </div>
  )
}

function joinPath(base: string, name: string): string {
  if (!name) return base
  if (base.endsWith("/")) return base + name
  return `${base}/${name}`
}

function parentPath(path: string): string {
  if (path === "/" || !path) return "/"
  const idx = path.replace(/\/$/, "").lastIndexOf("/")
  if (idx <= 0) return "/"
  return path.slice(0, idx)
}
