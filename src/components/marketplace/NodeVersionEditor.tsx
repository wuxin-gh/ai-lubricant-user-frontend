import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, FileArchive, FileCog, UploadCloud, X, XCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import {
  getNodeVersionUploadJob,
  retryNodeVersionUpload,
  uploadNodeVersion,
  type UploadJob,
} from "@/api/marketplaceAdmin"

export type NodeVersionManifest = Record<string, any>

type Recognized = {
  file: File
  filename: string
  role: "execution" | "management" | "ios_host" | "runtime" | ""
  component: "node" | "agent-compose" | ""
  platform: string
  arch: string
  format: string
  ok: boolean
}

// 与服务端 validator.identify_node_asset 一致的文件名识别。
function identify(file: File): Recognized {
  const name = file.name.trim()
  const bin = /^(node-execution|agent-compose-node-management|node-ios)-(linux|darwin|windows)-(amd64|arm64)(\.exe)?$/.exec(name)
  if (bin) {
    const [, base, platform, arch, exe] = bin
    const validExe = platform === "windows" ? !!exe : !exe
    return {
      file, filename: name, ok: validExe,
      role: base === "node-execution" ? "execution" : base === "node-ios" ? "ios_host" : "management",
      component: "node", platform, arch, format: "executable",
    }
  }
  const rt = /^(?:node-runtime\.tar\.gz|agent-compose-runtime-(linux|darwin|windows)-(amd64|arm64)\.tar\.gz)$/.exec(name)
  if (rt) {
    // node-runtime.tar.gz 是平台无关的通用包；旧命名仍可编辑存量版本。
    const [, platform, arch] = rt
    return {
      file, filename: name, ok: true, role: "runtime", component: "agent-compose",
      platform: platform || "any", arch: arch || "any", format: "tar.gz",
    }
  }
  return { file, filename: name, ok: false, role: "", component: "", platform: "", arch: "", format: "" }
}

const ROLE_LABEL: Record<string, string> = {
  execution: "节点程序 · 执行节点",
  management: "节点程序 · 管理节点",
  ios_host: "节点程序 · iOS 设备主机",
  runtime: "agent-compose Runtime",
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function NodeVersionEditor({ open, onOpenChange, item, onSave }: {
  open: boolean; onOpenChange: (v: boolean) => void; item: NodeVersionManifest | null
  onSave: (manifest: NodeVersionManifest) => Promise<void>
}) {
  const [version, setVersion] = useState("")
  const [versionNotes, setVersionNotes] = useState("")
  const [status, setStatus] = useState("published")
  const [testVersion, setTestVersion] = useState(false)
  const [files, setFiles] = useState<Recognized[]>([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)          // 已上传字节数
  const [progressTotal, setProgressTotal] = useState(0) // 总字节数；-1=不可测
  const [job, setJob] = useState<UploadJob | null>(null)   // 第②阶段轮询状态
  const [retrying, setRetrying] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 总大小 = 所有待传文件字节数之和，用于进度条分母。
  const totalBytes = useMemo(() => files.reduce((sum, f) => sum + f.file.size, 0), [files])

  // 第②阶段：轮询 job 进度，2s 一次。依赖 [job_id, status] 而非整个 job：
  // setJob 更新文件状态不会重启 interval，只在 job 切换或终态时起停。
  const jobIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!job) return
    jobIdRef.current = job.job_id
    if (job.status === "done" || job.status === "failed") {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    if (pollRef.current) return  // 已在轮询，不重复起
    pollRef.current = setInterval(async () => {
      const id = jobIdRef.current
      if (!id) return
      try {
        const latest = await getNodeVersionUploadJob(id)
        setJob(latest)
      } catch { /* 轮询失败不致命，下个 tick 再试 */ }
    }, 2000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.job_id, job?.status])

  useEffect(() => {
    if (!open) {
      // 关弹框：清轮询 + job 状态，下次打开是干净的。
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      setJob(null)
      setUploading(false)
      setProgress(0)
      setProgressTotal(0)
    }
    setVersion(item?.version || "")
    setVersionNotes(item?.version_notes || "")
    setStatus(item?.status || "published")
    setTestVersion(!!item?.test_version)
    setFiles([])
  }, [item, open])

  const addFiles = (incoming: FileList | File[] | null) => {
    const parsed = Array.from(incoming || []).map(identify)
    if (!parsed.length) return
    // 按文件名去重后追加，支持多次拖拽累加。
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.filename))
      return [...prev, ...parsed.filter((f) => !seen.has(f.filename))]
    })
  }

  const removeFile = (name: string) => setFiles((prev) => prev.filter((f) => f.filename !== name))

  const anyInvalid = files.some((f) => !f.ok)
  const canSubmit = item
    ? !!versionNotes.trim()
    : !!version.trim() && !!versionNotes.trim() && files.length > 0 && !anyInvalid

  const submit = async () => {
    if (item) {
      await onSave({ ...item, version_notes: versionNotes, status, test_version: testVersion })
      return
    }
    setUploading(true)
    setProgress(0)
    setProgressTotal(totalBytes)
    setJob(null)
    try {
      const form = new FormData()
      form.append("version", version)
      form.append("version_notes", versionNotes)
      form.append("status", status)
      form.append("test_version", String(testVersion))
      files.forEach((f) => form.append("files", f.file))
      const { job_id } = await uploadNodeVersion(form, (loaded) => {
        // XHR 给的 loaded 是本次上传累计字节，total 不可测时用本地算的 totalBytes 兜底。
        setProgress(loaded)
        setProgressTotal(totalBytes)
      })
      // 第①阶段完。切到第②阶段：拉一次初始状态，随后 useEffect 起 2s 轮询。
      const initial = await getNodeVersionUploadJob(job_id)
      setJob(initial)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setUploading(false)
      setProgress(0)
      setProgressTotal(0)
    }
  }

  const retry = async () => {
    if (!job) return
    setRetrying(true)
    try {
      await retryNodeVersionUpload(job.job_id)
      // 重启轮询：先拉一次最新状态，useEffect 检测到 status 非 done/failed 会重新起 interval。
      setJob({ ...job, status: "to_github" })
      const latest = await getNodeVersionUploadJob(job.job_id)
      setJob(latest)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRetrying(false)
    }
  }

  // 第②阶段 done：关弹框 + 刷新列表。
  useEffect(() => {
    if (job?.status === "done") {
      toast.success("节点版本已上传到 GitHub Releases")
      onOpenChange(false)
    }
  }, [job?.status])

  const existingAssets: any[] = useMemo(() => (Array.isArray(item?.assets) ? item!.assets : []), [item])

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      className="sm:max-w-3xl max-h-[90vh] overflow-y-auto"
      // 上传中/转传中：点遮罩或按 ESC 都不关——防止误触丢进度。
      onInteractOutside={(e) => { if (uploading || job) e.preventDefault() }}
      onEscapeKeyDown={(e) => { if (uploading || job) e.preventDefault() }}
    >
      <DialogHeader>
        <DialogTitle>{item ? "编辑版本信息" : "上传新版本"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-5">
        {/* 版本信息 */}
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {!item ? (
              <div className="space-y-1.5">
                <Label>版本号</Label>
                <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="YYYYMMDD-HHMM 或 1.2.3" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>版本号</Label>
                <Input value={version} disabled className="font-mono" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>发布状态</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="published">已发布</SelectItem>
                  <SelectItem value="draft">草稿</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>测试版本</Label>
              <div className="flex h-9 items-center gap-2">
                <Switch checked={testVersion} onCheckedChange={setTestVersion} id="test-version-switch" />
                <span className="text-xs text-muted-foreground">{testVersion ? "是" : "否"}</span>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>版本说明</Label>
            <Textarea rows={5} value={versionNotes} onChange={(e) => setVersionNotes(e.target.value)} placeholder="本次发布内容、修复与注意事项" />
          </div>
        </div>

        {/* 上传区 */}
        {!item && (
          <div className="space-y-2">
            <Label>程序文件</Label>
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click() }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors cursor-pointer ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/40"}`}
            >
              <UploadCloud className="size-7 text-muted-foreground" />
              <div className="text-sm font-medium">拖拽文件到此处，或点击选择</div>
              <div className="text-xs text-muted-foreground">支持一次多选多个平台/架构；平台、架构、类型由文件名自动识别</div>
            </div>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = "" }} />

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((f) => (
                  <div key={f.filename} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${f.ok ? "" : "border-destructive/40 bg-destructive/5"}`}>
                    {f.role === "runtime" ? <FileArchive className="size-5 shrink-0 text-muted-foreground" /> : <FileCog className="size-5 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs">{f.filename}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                        {f.ok ? (
                          <><CheckCircle2 className="size-3 text-emerald-500" /><span className="text-muted-foreground">{ROLE_LABEL[f.role]} · {f.platform === "any" ? "通用平台" : `${f.platform}/${f.arch}`} · {formatSize(f.file.size)}</span></>
                        ) : (
                          <><XCircle className="size-3 text-destructive" /><span className="text-destructive">文件名不符合规范，无法上传</span></>
                        )}
                      </div>
                    </div>
                    <button type="button" onClick={() => removeFile(f.filename)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 编辑已有版本时的资产概览 */}
        {item && existingAssets.length > 0 && (
          <div className="space-y-2">
            <Label>已有资产（{existingAssets.length}）</Label>
            <div className="space-y-1.5">
              {existingAssets.map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-xs">
                  {a.role === "runtime" ? <FileArchive className="size-4 shrink-0 text-muted-foreground" /> : <FileCog className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="truncate font-mono">{a.filename || `${a.role}-${a.platform}-${a.arch}`}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">{ROLE_LABEL[a.role] || a.role} · {a.platform === "any" ? "通用平台" : `${a.platform}/${a.arch}`}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">补充其他平台资产请关闭后用「上传新版本」，相同版本号会合并到同一 Release。</p>
          </div>
        )}

        {/* 第①阶段：前端→服务器字节进度 */}
        {uploading && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>① 上传到服务器…</span>
              <span className="font-mono">
                {progressTotal > 0
                  ? `${(progress / 1024 / 1024).toFixed(1)} / ${(progressTotal / 1024 / 1024).toFixed(1)} MB`
                  : `${(progress / 1024 / 1024).toFixed(1)} MB`}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width] duration-150"
                style={{ width: `${progressTotal > 0 ? Math.min(100, (progress / progressTotal) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* 第②阶段：服务端转传 GitHub，按文件个数报进度 */}
        {job && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                ② {job.status === "failed" ? "转传 GitHub 失败" : job.status === "done" ? "转传完成" : job.status === "finalizing" ? "写 manifest 中…" : "服务端转传 GitHub 中…"}
              </span>
              <span className="font-mono">{job.github_done} / {job.total_files} 个文件</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-[width] duration-150 ${job.status === "failed" ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${job.total_files > 0 ? (job.github_done / job.total_files) * 100 : 0}%` }}
              />
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
              {job.files.map((f) => (
                <div key={f.filename} className="flex items-center gap-2 text-[11px]">
                  {f.state === "done" ? <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
                    : f.state === "failed" ? <XCircle className="size-3 shrink-0 text-destructive" />
                    : f.state === "uploading" ? <RefreshCw className="size-3 shrink-0 animate-spin text-primary" />
                    : <span className="size-3 shrink-0 rounded-full border border-muted-foreground/30" />}
                  <span className="truncate font-mono">{f.filename}</span>
                  <span className={`ml-auto shrink-0 ${f.state === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                    {f.state === "done" ? "已完成" : f.state === "failed" ? (f.error ? "失败：" + f.error.slice(0, 60) : "失败") : f.state === "uploading" ? "转传中" : "等待中"}
                  </span>
                </div>
              ))}
            </div>
            {job.status === "failed" && (
              <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
                <span className="text-xs text-destructive">{job.error || "部分文件转传失败，可只重试失败项"}</span>
                <Button size="sm" variant="outline" disabled={retrying} onClick={() => void retry()}>
                  {retrying ? "重试中…" : "重试失败项"}
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" disabled={uploading || !!job} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={uploading || !!job || !canSubmit} onClick={() => void submit()}>
            {uploading ? "上传中..." : job ? "处理中..." : item ? "保存" : "上传并发布"}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
}
