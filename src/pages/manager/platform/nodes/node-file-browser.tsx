/**
 * 节点宿主机文件浏览器浮窗。管理端与用户侧共用，按 `scope` 选后端路径：
 * - `admin` → `/api/v1/admin/nodes/{id}/files*`（平台管理员）
 * - `user`  → `/api/v1/teams/my-nodes/{id}/files*`（按 GroupNode 授权校验，写操作审计）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  IconArrowUp,
  IconCornerDownLeft,
  IconFileDescription,
  IconFilePlus,
  IconFolder,
  IconFolderPlus,
  IconPencil,
  IconReload,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react"
import { nodeHostFile, nodeHostFileUpload, NODE_UPLOAD_MAX_BYTES, type NodeHostFileEntry } from "@/@admin-port/api/nodes"
import { userNodeHostFile, userNodeHostFileUpload } from "@/api/nodes"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { FloatingPanel } from "@/components/ui/floating-panel"

function parentFilePath(path: string): string {
  if (path === "/" || /^\/[A-Za-z]:$/.test(path)) return "/"
  return path.replace(/\/[^/]+$/, "") || "/"
}

function joinFilePath(path: string, name: string): string {
  return `${path === "/" ? "" : path}/${name}`
}

export function NodeFileBrowser({
  nodeId,
  open,
  onOpenChange,
  onPathChange,
  scope = "admin",
  className,
}: {
  nodeId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onPathChange?: (path: string) => void
  /** 走管理端还是用户侧接口。默认 admin，保持既有调用点行为不变。 */
  scope?: "admin" | "user"
  /** 透给浮窗：嵌在弹框里的终端要抬层级，否则被 Dialog 的 z-50 盖住。 */
  className?: string
}) {
  const [filePath, setFilePath] = useState("/")
  const [pathDraft, setPathDraft] = useState("/")
  const [fileEntries, setFileEntries] = useState<NodeHostFileEntry[]>([])
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState("")
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadName, setUploadName] = useState("")
  const [uploadOverwrite, setUploadOverwrite] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadPercent, setUploadPercent] = useState(0)
  const [uploadError, setUploadError] = useState("")
  const homeNodeId = useRef("")
  const requestId = useRef(0)
  // 两侧接口同形，只有路径与鉴权不同；在这里选一次，下面所有调用点保持不变。
  const api = useMemo(
    () => (scope === "user"
      ? { hostFile: userNodeHostFile, hostUpload: userNodeHostFileUpload }
      : { hostFile: nodeHostFile, hostUpload: nodeHostFileUpload }),
    [scope],
  )

  const loadFiles = useCallback(async (path: string, fallbackWarning = "") => {
    if (!nodeId) return
    const currentRequestId = ++requestId.current
    setFileLoading(true)
    setFileError("")
    setFileContent(null)
    try {
      const result = await api.hostFile(nodeId, { path, operation: "list" })
      if (currentRequestId !== requestId.current) return
      const nextPath = result.path || path
      setFilePath(nextPath)
      setPathDraft(nextPath)
      setFileEntries(result.entries || [])
      setFileError(fallbackWarning)
      onPathChange?.(nextPath)
    } catch (error) {
      if (currentRequestId !== requestId.current) return
      setFileError(error instanceof Error ? error.message : String(error))
    } finally {
      if (currentRequestId === requestId.current) setFileLoading(false)
    }
  }, [api, nodeId, onPathChange])

  const openFile = useCallback(async (entry: NodeHostFileEntry) => {
    if (entry.is_dir) {
      await loadFiles(entry.path)
      return
    }
    setFileLoading(true)
    setFileError("")
    try {
      const result = await api.hostFile(nodeId, { path: entry.path, operation: "read" })
      setFileContent(result.content || "")
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error))
    } finally {
      setFileLoading(false)
    }
  }, [api, loadFiles, nodeId])

  const mutateFile = useCallback(async (operation: string, path: string, content = "", destination = "") => {
    if (!nodeId || !window.confirm(`确认执行 ${operation}：${path}${destination ? ` → ${destination}` : ""}`)) return
    setFileLoading(true)
    setFileError("")
    try {
      await api.hostFile(nodeId, { path, operation, content, destination })
      const parent = operation === "write" ? parentFilePath(path) : filePath
      await loadFiles(parent)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error))
    } finally {
      setFileLoading(false)
    }
  }, [api, nodeId, filePath, loadFiles])

  useEffect(() => {
    if (!open || !nodeId || homeNodeId.current === nodeId) return
    const homeNodeIdValue = nodeId
    homeNodeId.current = homeNodeIdValue
    void api.hostFile(homeNodeIdValue, { path: "/", operation: "home" })
      .then((result) => loadFiles(result.path || "/"))
      .catch((error) => {
        homeNodeId.current = ""
        const detail = error instanceof Error ? error.message : String(error)
        return loadFiles("/", `用户目录定位失败，已显示文件系统根目录：${detail}`)
      })
  }, [api, open, nodeId, loadFiles])

  const submitPath = useCallback((target: string) => {
    const trimmed = target.trim() || "/"
    if (trimmed === filePath) {
      setPathDraft(filePath)
      return
    }
    void loadFiles(trimmed)
  }, [filePath, loadFiles])

  return (
    <FloatingPanel open={open} onOpenChange={onOpenChange} title="文件浏览器" storageKey={`node-file-browser:${nodeId}`} className={className}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-0.5 border-b px-2 py-2">
          <Button variant="ghost" size="icon" className="size-7 shrink-0" title="上级目录" onClick={() => void loadFiles(parentFilePath(filePath))}>
            <IconArrowUp className="size-4" />
          </Button>
          <Input
            value={pathDraft}
            onChange={(event) => setPathDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitPath(pathDraft) } }}
            onBlur={() => setPathDraft(filePath)}
            spellCheck={false}
            title={filePath}
            className="h-7 min-w-0 flex-1 font-mono text-xs"
          />
          <Button variant="ghost" size="icon" className="size-7 shrink-0" title="跳转到该目录" onClick={() => submitPath(pathDraft)}><IconCornerDownLeft className="size-4" /></Button>
          <Button variant="ghost" size="icon" className="size-7 shrink-0" title="新建目录" onClick={() => { const name = window.prompt("新建目录名称"); if (name) void mutateFile("mkdir", joinFilePath(filePath, name)) }}><IconFolderPlus className="size-4" /></Button>
          <Button variant="ghost" size="icon" className="size-7 shrink-0" title="新建文件" onClick={() => { const name = window.prompt("新建文件名称"); if (name) void mutateFile("write", joinFilePath(filePath, name), "") }}><IconFilePlus className="size-4" /></Button>
          <Button variant="ghost" size="icon" className="size-7 shrink-0" title="上传文件" onClick={() => setUploadOpen(true)}><IconUpload className="size-4" /></Button>
          <Button variant="ghost" size="icon" className="size-7 shrink-0" title="刷新" disabled={fileLoading} onClick={() => void loadFiles(filePath)}><IconReload className="size-4" /></Button>
        </div>
        {fileError ? <div className="shrink-0 border-b px-3 py-2 text-xs text-destructive">{fileError}</div> : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {fileLoading ? <div className="flex h-full items-center justify-center"><Spinner /></div> : fileContent !== null ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-2 border-b px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate">文本预览</span><Button variant="ghost" size="icon" className="size-6 shrink-0" title="关闭预览" onClick={() => setFileContent(null)}><IconX className="size-3.5" /></Button></div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs">{fileContent}</pre>
            </div>
          ) : fileEntries.length === 0 ? <div className="p-4 text-center text-xs text-muted-foreground">目录为空</div> : fileEntries.map((entry) => (
            <div key={entry.path} className="flex w-full items-center gap-1 border-b px-2 py-1 text-xs hover:bg-muted">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left" onClick={() => void openFile(entry)}>
                {entry.is_dir ? <IconFolder className="size-4 shrink-0 text-muted-foreground" /> : <IconFileDescription className="size-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate text-left">{entry.name}</span>
                {!entry.is_dir ? <span className="shrink-0 text-muted-foreground">{entry.size} B</span> : null}
              </button>
              <Button variant="ghost" size="icon" className="size-6 shrink-0" title="重命名" onClick={() => { const dest = window.prompt("重命名为（绝对路径）", entry.path); if (dest) void mutateFile("rename", entry.path, "", dest) }}><IconPencil className="size-3.5" /></Button>
              <Button variant="ghost" size="icon" className="size-6 shrink-0 text-destructive" title="删除" onClick={() => void mutateFile("delete", entry.path)}><IconTrash className="size-3.5" /></Button>
            </div>
          ))}
        </div>
      </div>
      {/* z-[70]：从 z-[60] 悬浮浮窗里点开的弹框要抬到浮窗之上。 */}
      <Dialog open={uploadOpen} onOpenChange={(value) => { setUploadOpen(value); if (!value) { setUploadError(""); setUploadPercent(0); setUploadFile(null); setUploadName(""); setUploadOverwrite(false) } }}>
        <DialogContent className="z-[70] max-w-md" overlayClassName="z-[70]">
          <DialogHeader><DialogTitle>上传文件到当前目录</DialogTitle><DialogDescription>目标目录：{filePath}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Input type="file" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0] ?? null; setUploadFile(file); setUploadName(file?.name ?? ""); setUploadError("") }} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={uploadOverwrite} onChange={(event) => setUploadOverwrite(event.target.checked)} disabled={uploading} className="size-4" />覆盖同名文件</label>
            {uploadFile ? <p className="text-xs text-muted-foreground">{uploadName} · {(uploadFile.size / 1024).toFixed(2)} KB</p> : null}
            {uploadPercent > 0 && uploadPercent < 100 ? <div className="h-1.5 w-full overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${uploadPercent}%` }} /></div> : null}
            {uploadError ? <p className="text-xs text-destructive">{uploadError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>取消</Button>
            <Button onClick={async () => {
              if (!nodeId) return
              if (!uploadFile) { setUploadError("请先选择文件"); return }
              if (uploadFile.size > NODE_UPLOAD_MAX_BYTES) { setUploadError(`文件不能超过 ${Math.round(NODE_UPLOAD_MAX_BYTES / (1024 * 1024))} MiB`); return }
              setUploading(true); setUploadError(""); setUploadPercent(0)
              try {
                const result = await api.hostUpload(nodeId, { path: filePath, file: uploadFile, overwrite: uploadOverwrite, onProgress: setUploadPercent })
                if (!result.ok) setUploadError("上传失败")
                else { setUploadOpen(false); void loadFiles(filePath) }
              } catch (error) { setUploadError(error instanceof Error ? error.message : String(error)) }
              finally { setUploading(false) }
            }} disabled={uploading || !uploadFile}>{uploading && <Spinner className="size-4" />}上传</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FloatingPanel>
  )
}
