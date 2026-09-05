import { useEffect, useState } from "react"
import { toast } from "sonner"

import { updateEditorSession, type EditorSession } from "@/api/editorClient"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"

export default function EditEditorSessionDialog({
  editorId,
  session,
  gatewayModels,
  open,
  onOpenChange,
  onSaved,
}: {
  editorId: string
  session: EditorSession | null
  gatewayModels: Array<{ value: string; label?: string }>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState("")
  const [models, setModels] = useState<string[]>([])
  const [maxRequests, setMaxRequests] = useState("")
  const [maxTokens, setMaxTokens] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [saving, setSaving] = useState(false)

  // 可勾选的模型 = 按执行 Key 过滤的目录 ∪ 会话已有模型（后者保证历史值仍可见/保留）。
  const modelChoices = Array.from(new Set([
    ...(session?.models || []),
    ...gatewayModels.map((item) => item.value),
  ].filter(Boolean)))

  useEffect(() => {
    if (!open || !session) return
    setName(session.task_name || "")
    setModels(session.models?.length ? session.models : (session.model ? [session.model] : []))
    const limit = session.api_key_copy?.usage_limit || {}
    setMaxRequests(limit.max_requests == null ? "" : String(limit.max_requests))
    setMaxTokens(limit.max_total_tokens == null ? "" : String(limit.max_total_tokens))
    setExpiresAt(session.api_key_copy?.expires_at ? new Date(session.api_key_copy.expires_at * 1000).toISOString().slice(0, 16) : "")
  }, [open, session])

  async function save() {
    if (!session) return
    setSaving(true)
    try {
      const nextModels = models.filter(Boolean)
      await updateEditorSession(editorId, session.id, {
        task_name: name.trim() || "未命名任务",
        models: nextModels,
        usage_limit: {
          ...(maxRequests ? { max_requests: Number(maxRequests) } : {}),
          ...(maxTokens ? { max_total_tokens: Number(maxTokens) } : {}),
        },
        expires_at: expiresAt ? new Date(expiresAt).getTime() / 1000 : null,
      })
      await onSaved()
      onOpenChange(false)
      toast.success("任务已更新")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新任务失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>修改任务</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2"><Label>任务名称</Label><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></div>
          <div className="grid gap-2">
            <Label>当前模型</Label>
            <select className="h-9 rounded-md border bg-background px-3 text-sm" disabled={session?.status === "closed"} value={session?.model || models[0] || ""} onChange={(event) => setModels((current) => [event.target.value, ...current.filter((item) => item !== event.target.value)])}>
              <option value="">默认模型</option>
              {modelChoices.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
            {session?.status === "closed" && <p className="text-xs text-muted-foreground">任务停止后不能切换运行模型。</p>}
          </div>
          <div className="grid gap-2">
            <Label>可用模型</Label>
            {/* 只能从按执行 Key 过滤的目录里勾选：手工输入的自由文本会绕过 Key
                白/黑名单，把不可执行的模型名写进 models_snapshot。目录为空时
                （Key 失效/无授权模型）保留会话现有模型，避免误清空。 */}
            {modelChoices.length === 0 ? (
              <p className="text-xs text-muted-foreground">没有可选模型：该会话的执行 Key 当前无授权可用模型。</p>
            ) : (
              <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border p-2">
                {modelChoices.map((choice) => (
                  <label key={choice} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={models.includes(choice)}
                      onChange={(event) => setModels((current) => event.target.checked
                        ? [...current, choice]
                        : current.filter((item) => item !== choice))}
                    />
                    <span className="truncate">{choice}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2"><div className="grid gap-2"><Label>最大请求数</Label><Input type="number" min="0" value={maxRequests} onChange={(event) => setMaxRequests(event.target.value)} /></div><div className="grid gap-2"><Label>最大总 Token</Label><Input type="number" min="0" value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} /></div></div>
          <div className="grid gap-2"><Label>过期时间</Label><Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button><Button onClick={() => void save()} disabled={saving}>{saving && <Spinner className="mr-2 size-4" />}保存</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
