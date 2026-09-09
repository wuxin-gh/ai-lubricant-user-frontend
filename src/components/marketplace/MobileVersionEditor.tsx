import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Smartphone, UploadCloud, X, XCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import {
  getMobileVersionUploadJob,
  retryMobileVersionUpload,
  uploadMobileVersion,
  UploadJobGoneError,
  type UploadJob,
} from "@/api/marketplaceAdmin"

export type MobileVersionManifest = Record<string, any>

type Recognized = {
  file: File
  filename: string
  platform: "android" | ""
  version: string
  ok: boolean
}

// 与服务端 validator.identify_mobile_asset 一致的文件名识别。
// 只认 Android APK；iOS 走 App Store，不产出可下载资产。
function identify(file: File): Recognized {
  const name = file.name.trim()
  const m = /^ai-lubricant-(\d[\w.-]*)-android\.apk$/.exec(name)
  if (m) return { file, filename: name, ok: true, platform: "android", version: m[1] }
  return { file, filename: name, ok: false, platform: "", version: "" }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 移动控制端版本上传弹框。与 NodeVersionEditor 同骨架（两阶段上传 + job 轮询），
 * 差别：只有一个 Android APK 产物，另加一个 iOS 商店链接字段。
 *
 * 发布后服务端把最新 published 版本投影成 mobile-releases/version.json，
 * App「检查更新」读它——Android 下载 APK 装，iOS 跳这里填的商店链接。
 */
export function MobileVersionEditor({ open, onOpenChange, item, onSave }: {
  open: boolean; onOpenChange: (v: boolean) => void; item: MobileVersionManifest | null
  onSave: (manifest: MobileVersionManifest) => Promise<void>
}) {
  const [version, setVersion] = useState("")
  const [versionNotes, setVersionNotes] = useState("")
  const [status, setStatus] = useState("published")
  const [iosStoreUrl, setIosStoreUrl] = useState("")
  const [file, setFile] = useState<Recognized | null>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressTotal, setProgressTotal] = useState(0)
  const [job, setJob] = useState<UploadJob | null>(null)
  const [retrying, setRetrying] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const jobIdRef = useRef<string | null>(null)

  // 第②阶段轮询，2s 一次；只在 job 切换或进入终态时起停（同 NodeVersionEditor）。
  useEffect(() => {
    if (!job) return
    jobIdRef.current = job.job_id
    if (job.status === "done" || job.status === "failed") {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      const id = jobIdRef.current
      if (!id) return
      try {
        const latest = await getMobileVersionUploadJob(id)
        setJob(latest)
      } catch (error) {
        if (error instanceof UploadJobGoneError) {
          // job 被服务端清掉（重启或超 30 分钟过期），不会再有进展：落到失败态，
          // retry 按钮会改走整包重传。避免一直「处理中…」把弹框卡死。
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
          setJob((prev) => prev && prev.job_id === id
            ? { ...prev, status: "failed", error: "上传任务不存在或已过期（服务端可能已重启），点「重试失败项」用已提交的数据重新上传" }
            : prev)
        }
        // 其他错误（网络抖动等）：下个 tick 再试，不致命。
      }
    }, 2000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.job_id, job?.status])

  useEffect(() => {
    if (!open) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      setJob(null)
      setUploading(false)
      setProgress(0)
      setProgressTotal(0)
    }
    setVersion(item?.version || "")
    setVersionNotes(item?.version_notes || "")
    setStatus(item?.status || "published")
    setIosStoreUrl(item?.ios_store_url || "")
    setFile(null)
  }, [item, open])

  // 选了 APK 且版本号还没填：用文件名里的版本自动带出，减少手填出错。
  const pickFile = (incoming: FileList | File[] | null) => {
    const first = Array.from(incoming || [])[0]
    if (!first) return
    const parsed = identify(first)
    setFile(parsed)
    if (parsed.ok && !version.trim()) setVersion(parsed.version)
  }

  const versionMismatch = !!file?.ok && !!version.trim() && file.version !== version.trim()
  const canSubmit = item
    ? !!versionNotes.trim()
    : !!version.trim() && !!versionNotes.trim() && !!file?.ok && !versionMismatch

  const submit = async () => {
    if (item) {
      await onSave({ ...item, version_notes: versionNotes, status, ios_store_url: iosStoreUrl })
      return
    }
    if (!file) return
    setUploading(true)
    setProgress(0)
    setProgressTotal(file.file.size)
    setJob(null)
    try {
      const form = new FormData()
      form.append("version", version.trim())
      form.append("version_notes", versionNotes)
      form.append("status", status)
      form.append("ios_store_url", iosStoreUrl.trim())
      form.append("files", file.file)
      const { job_id } = await uploadMobileVersion(form, (loaded) => {
        setProgress(loaded)
        setProgressTotal(file.file.size)
      })
      const initial = await getMobileVersionUploadJob(job_id)
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
      await retryMobileVersionUpload(job.job_id)
      setJob({ ...job, status: "to_github" })
      const latest = await getMobileVersionUploadJob(job.job_id)
      setJob(latest)
    } catch (error) {
      if (error instanceof UploadJobGoneError) {
        // 任务已被服务端清掉（重启/过期）：用本组件仍持有的表单与文件从头重传，
        // 而不是把用户卡在失败态让他重开弹框。服务端对同版本重传幂等
        // （upload_release_asset 同名先删后传）。
        toast.info("上传任务已过期，正在用已提交的数据重新上传…")
        await submit()
        return
      }
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRetrying(false)
    }
  }

  useEffect(() => {
    if (job?.status === "done") {
      toast.success("移动端版本已上传到 GitHub Releases")
      onOpenChange(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status])

  const existingAssets: any[] = Array.isArray(item?.assets) ? item!.assets : []

  // 转传活跃中（未失败未完成）才锁弹框；failed 允许关闭——用户可选择放弃本次，
  // 不然卡死在「处理中…」只能刷新页面。
  const jobActive = !!job && job.status !== "failed" && job.status !== "done"

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
      onInteractOutside={(e) => { if (uploading || jobActive) e.preventDefault() }}
      onEscapeKeyDown={(e) => { if (uploading || jobActive) e.preventDefault() }}
    >
      <DialogHeader>
        <DialogTitle>{item ? "编辑移动端版本信息" : "上传移动端新版本"}</DialogTitle>
        <p className="text-xs text-muted-foreground">
          Android 上传 APK，App 内自动下载安装；iOS 只填 App Store 链接（iOS 装不了自下载的包）。
        </p>
      </DialogHeader>
      <div className="space-y-5">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>版本号</Label>
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                disabled={!!item}
                className={item ? "font-mono" : ""}
                placeholder="260608（与 app.json 的 version 一致）"
              />
              {versionMismatch ? (
                <p className="text-[11px] text-destructive">与文件名里的版本「{file?.version}」不一致</p>
              ) : null}
            </div>
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
          </div>
          <div className="space-y-1.5">
            <Label>iOS App Store 链接（可选）</Label>
            <Input
              value={iosStoreUrl}
              onChange={(e) => setIosStoreUrl(e.target.value)}
              placeholder="https://apps.apple.com/cn/app/id6777423440"
            />
            <p className="text-[11px] text-muted-foreground">iOS 用户点「检查更新」时跳这里；留空则提示未配置。</p>
          </div>
          <div className="space-y-1.5">
            <Label>版本说明</Label>
            <Textarea rows={5} value={versionNotes} onChange={(e) => setVersionNotes(e.target.value)} placeholder="本次发布内容、修复与注意事项（会展示给 App 用户）" />
          </div>
        </div>

        {!item && (
          <div className="space-y-2">
            <Label>Android 安装包</Label>
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click() }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files) }}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors cursor-pointer ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/40"}`}
            >
              <UploadCloud className="size-7 text-muted-foreground" />
              <div className="text-sm font-medium">拖拽 APK 到此处，或点击选择</div>
              <div className="text-xs text-muted-foreground">文件名须为 ai-lubricant-&lt;版本&gt;-android.apk（pack-release.sh 已按此命名）</div>
            </div>
            <input ref={inputRef} type="file" accept=".apk" className="hidden" onChange={(e) => { pickFile(e.target.files); e.currentTarget.value = "" }} />

            {file && (
              <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${file.ok ? "" : "border-destructive/40 bg-destructive/5"}`}>
                <Smartphone className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs">{file.filename}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                    {file.ok ? (
                      <><CheckCircle2 className="size-3 text-emerald-500" /><span className="text-muted-foreground">Android · v{file.version} · {formatSize(file.file.size)}</span></>
                    ) : (
                      <><XCircle className="size-3 text-destructive" /><span className="text-destructive">文件名不符合规范，无法上传</span></>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => setFile(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
              </div>
            )}
          </div>
        )}

        {item && existingAssets.length > 0 && (
          <div className="space-y-2">
            <Label>已有资产（{existingAssets.length}）</Label>
            <div className="space-y-1.5">
              {existingAssets.map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-xs">
                  <Smartphone className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono">{a.filename || a.platform}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">{a.platform} · {formatSize(a.size_bytes || 0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
                <span className="text-xs text-destructive">{job.error || "转传失败，可重试"}</span>
                <Button size="sm" variant="outline" disabled={retrying} onClick={() => void retry()}>
                  {retrying ? "重试中…" : "重试失败项"}
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" disabled={uploading || jobActive} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={uploading || jobActive || !canSubmit} onClick={() => void submit()}>
            {uploading ? "上传中..." : jobActive ? "处理中..." : item ? "保存" : "上传并发布"}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
}
