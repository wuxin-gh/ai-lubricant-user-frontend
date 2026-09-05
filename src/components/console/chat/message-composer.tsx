import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react"
import { RotateCcw, Send, Square, X } from "lucide-react"
import { IconChevronDown, IconCirclePlus, IconPaperclip, IconSearch } from "@tabler/icons-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export type ComposerUploadStatus = "uploading" | "uploaded" | "error"

interface ComposerAttachment<T> {
  id: string
  file: File
  progress: number
  status: ComposerUploadStatus
  result?: T
  error?: string
}

export interface MessageComposerProps<T = never> {
  value: string
  onChange: (value: string) => void
  onSend: (value: string, attachments: T[]) => void | Promise<void>
  onStop?: () => void
  loading?: boolean
  disabled?: boolean
  placeholder?: string
  sendLabel?: string

  uploadFile?: (file: File, onProgress: (percent: number) => void) => Promise<T>
  uploadEnabled?: boolean
  fileAccept?: string
  maxFileSize?: number
  maxFiles?: number
  attachmentName?: (attachment: T) => string
  resetKey?: string | number | null

  modelValue?: string
  modelOptions?: Array<{ value: string; label?: string; description?: string }>
  onSwitchModel?: (model: string) => void
  /** 模型菜单尾部的「添加模型…」入口。 */
  onAddModel?: () => void

  leadingActions?: ReactNode
  leftActions?: ReactNode
  beforeModelActions?: ReactNode
  afterModelActions?: ReactNode
  trailingActions?: ReactNode
  className?: string
  textareaClassName?: string
}

let attachmentSequence = 0

/** 全站共用消息输入框；宿主页只负责会话、协议和消息流。 */
export default function MessageComposer<T = never>({
  value,
  onChange,
  onSend,
  onStop,
  loading = false,
  disabled = false,
  placeholder = "输入消息，Enter 发送，Shift+Enter 换行",
  sendLabel,
  uploadFile,
  uploadEnabled = true,
  fileAccept,
  maxFileSize = 10 * 1024 * 1024,
  maxFiles = 10,
  attachmentName,
  resetKey,
  modelValue,
  modelOptions = [],
  onSwitchModel,
  onAddModel,
  leadingActions,
  leftActions,
  beforeModelActions,
  afterModelActions,
  trailingActions,
  className,
  textareaClassName,
}: MessageComposerProps<T>) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [modelSearch, setModelSearch] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [attachments, setAttachments] = useState<Array<ComposerAttachment<T>>>([])
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments

  useEffect(() => {
    setAttachments([])
  }, [resetKey])

  const hasUnreadyAttachment = attachments.some((item) => item.status !== "uploaded")
  const uploaded = attachments.flatMap((item) => item.status === "uploaded" && item.result !== undefined ? [item.result] : [])
  const canSend = !disabled && !loading && !submitting && !hasUnreadyAttachment && (Boolean(value.trim()) || uploaded.length > 0)
  const filteredModels = modelOptions.filter((option) => {
    const query = modelSearch.trim().toLowerCase()
    if (!query) return true
    return `${option.label || ""} ${option.value}`.toLowerCase().includes(query)
  })
  const showModelMenu = Boolean(onSwitchModel || onAddModel)
  const showUpload = Boolean(uploadFile)

  function patchAttachment(id: string, patch: Partial<ComposerAttachment<T>>) {
    setAttachments((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  async function runUpload(item: ComposerAttachment<T>) {
    if (!uploadFile) return
    patchAttachment(item.id, { status: "uploading", progress: 0, error: undefined })
    try {
      const result = await uploadFile(item.file, (progress) => {
        patchAttachment(item.id, { progress: Math.max(0, Math.min(100, progress)) })
      })
      patchAttachment(item.id, { status: "uploaded", progress: 100, result })
    } catch (error) {
      patchAttachment(item.id, {
        status: "error",
        error: error instanceof Error ? error.message : "文件上传失败",
      })
    }
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || [])
    event.target.value = ""
    if (!selected.length || !uploadFile) return
    const slots = Math.max(0, maxFiles - attachmentsRef.current.length)
    const accepted = selected.slice(0, slots).filter((file) => file.size <= maxFileSize)
    const tooLarge = selected.filter((file) => file.size > maxFileSize)
    if (tooLarge.length > 0) {
      toast.error(`${tooLarge.map((file) => file.name).join("、")} 超过单文件 ${(maxFileSize / 1024 / 1024).toFixed(0)} MiB 限制`)
    }
    if (selected.length > slots) toast.error(`最多保留 ${maxFiles} 个附件`)
    if (!accepted.length) return

    const queued = accepted.map((file): ComposerAttachment<T> => ({
      id: `upload-${++attachmentSequence}`,
      file,
      progress: 0,
      status: "uploading",
    }))
    setAttachments((current) => [...current, ...queued])
    for (const item of queued) void runUpload(item)
  }

  async function submit() {
    if (!canSend) return
    const currentValue = value
    const currentQueue = attachments
    const currentAttachments = uploaded
    onChange("")
    setAttachments([])
    setSubmitting(true)
    try {
      await onSend(currentValue, currentAttachments)
    } catch (error) {
      onChange(currentValue)
      setAttachments(currentQueue)
      throw error
    } finally {
      setSubmitting(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (canSend) void submit()
    }
  }

  return (
    <div className={cn("w-full rounded-2xl border bg-background/80 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/70 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10", className)}>
      {attachments.length > 0 && (
        <div className="mb-2 grid gap-1.5 sm:grid-cols-2">
          {attachments.map((item) => {
            const name = item.result !== undefined && attachmentName ? attachmentName(item.result) : item.file.name
            return (
              <div key={item.id} className={cn("min-w-0 rounded-lg border bg-muted/45 px-2 py-1.5", item.status === "error" && "border-destructive/40 bg-destructive/5")}>
                <div className="flex min-w-0 items-center gap-1.5 text-xs">
                  <IconPaperclip className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
                  {item.status === "uploading" && <span className="shrink-0 text-[10px] text-muted-foreground">{item.progress}%</span>}
                  {item.status === "error" && (
                    <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" title="重试上传" onClick={() => void runUpload(item)}>
                      <RotateCcw className="size-3.5" />
                    </button>
                  )}
                  <button type="button" className="shrink-0 text-muted-foreground hover:text-destructive" title="移除附件" onClick={() => setAttachments((current) => current.filter((candidate) => candidate.id !== item.id))}>
                    <X className="size-3.5" />
                  </button>
                </div>
                {item.status === "uploading" && <Progress value={item.progress} className="mt-1.5 h-1" />}
                {item.status === "error" && <div className="mt-1 truncate text-[10px] text-destructive" title={item.error}>{item.error}</div>}
              </div>
            )
          })}
        </div>
      )}
      <Textarea
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        className={cn("max-h-40 min-h-[52px] resize-none overflow-y-auto border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0", textareaClassName)}
        rows={1}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {/* 允许换行：塞进悬浮浮窗这类窄容器时，右侧按钮折到下一行而不是溢出被裁掉。 */}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-center gap-1">
          {leadingActions}
          {showUpload && (
            <>
              <input ref={inputRef} type="file" multiple accept={fileAccept} className="hidden" onChange={handleFiles} />
              <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-foreground" disabled={disabled || !uploadEnabled || attachments.length >= maxFiles} title={uploadEnabled ? "添加文件" : "当前模式不支持上传文件"} onClick={() => inputRef.current?.click()}>
                <IconPaperclip className="size-4" />
              </Button>
            </>
          )}
          {leftActions}
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
          {beforeModelActions}
          {showModelMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* min-w 保底宽度：放不下时靠 truncate 收缩而不是把整行顶出容器。 */}
                <button type="button" className="inline-flex h-7 min-w-[120px] max-w-[210px] items-center gap-1 rounded-full px-2 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50" title="切换模型，下一轮消息生效">
                  <span className="truncate">{modelValue || "选择模型"}</span>
                  <IconChevronDown className="size-3 shrink-0 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="min-w-[280px] p-1">
                <div className="relative mb-1">
                  <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} onKeyDown={(event) => event.stopPropagation()} placeholder="搜索模型…" className="h-8 pl-8" />
                </div>
                <div className="max-h-[min(380px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto">
                  {modelOptions.length === 0 ? <DropdownMenuItem disabled>暂无可用模型</DropdownMenuItem> : filteredModels.length === 0 ? <div className="px-3 py-4 text-center text-sm text-muted-foreground">无匹配模型</div> : (
                    <DropdownMenuRadioGroup value={modelValue}>
                      {filteredModels.map((option) => (
                        <DropdownMenuRadioItem key={option.value} value={option.value} onSelect={() => onSwitchModel?.(option.value)} className="min-w-0">
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate">{option.label || option.value}</span>
                            {option.description && <span className="truncate text-xs text-muted-foreground">{option.description}</span>}
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  )}
                </div>
                {onAddModel && (
                  <>
                    <div className="my-1 h-px bg-border" />
                    <DropdownMenuItem
                      onSelect={() => onAddModel()}
                      className="gap-1.5 text-muted-foreground"
                      title="从该 API Key 允许的模型中追加"
                    >
                      <IconCirclePlus className="size-3.5" /> 添加模型…
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {afterModelActions}
          {trailingActions}
          {/*
            按钮按状态切换：处理中（loading）且输入框为空、又没有待发附件 → 显示
            停止，让用户能中断当前轮次；处理中但用户已经输入了新内容 → 切回发送
            （追加的消息由后端按 (message-id, attempt) 幂等 + runtime 排队按顺序
            处理）；非处理中恒为发送。
          */}
          {loading && !value.trim() && uploaded.length === 0 ? (
            <Button variant="destructive" size="icon" className="size-8 shrink-0" onClick={onStop} title="停止"><Square className="size-4" /></Button>
          ) : sendLabel ? (
            <Button size="sm" className="h-8 shrink-0 rounded-xl" onClick={() => void submit()} disabled={!canSend}><Send className="size-4" />{sendLabel}</Button>
          ) : (
            <Button size="icon" className="size-8 shrink-0" onClick={() => void submit()} disabled={!canSend} title={hasUnreadyAttachment ? "请等待附件上传完成或处理失败附件" : "发送"}><Send className="size-4" /></Button>
          )}
        </div>
      </div>
    </div>
  )
}
