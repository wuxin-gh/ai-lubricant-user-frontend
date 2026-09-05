import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  createMyProjectPrompt, deleteMyProjectPrompt,
  listProjectPrompts, updateMyProjectPrompt,
  type ProjectPrompt,
} from "@/api/editorClient"

const ALL_PROVIDERS = ["claude", "codex", "opencode"] as const

/**
 * 项目提示词选择器 + 我的私有提示词内联管理。
 *
 * - 下拉分组：系统提示词（scope=system，只读启用项）/ 我的提示词（scope=mine，可增删改）。
 * - 选中值传回父级（prompt_id），空串表示不使用。
 * - 「管理我的提示词」折叠区：内联新建/编辑/删除私有提示词，新建后自动选中。
 *
 * 适用于编辑器创建弹框与配置弹框。
 */
export function ProjectPromptSelector({
  value,
  onChange,
  provider,
}: {
  value: string
  onChange: (promptId: string) => void
  provider: string
}) {
  const [prompts, setPrompts] = useState<ProjectPrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [manageOpen, setManageOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectPrompt | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setPrompts(await listProjectPrompts())
    } catch {
      setPrompts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const mine = useMemo(() => prompts.filter((p) => p.scope !== "mine" ? false : true), [prompts])
  const system = useMemo(
    () => prompts.filter((p) => p.scope !== "system" ? false : true).filter((p) => p.enabled),
    [prompts],
  )

  function matchesProvider(prompt: ProjectPrompt): boolean {
    return prompt.providers.length === 0 || prompt.providers.includes(provider)
  }

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(prompt: ProjectPrompt) {
    setEditing(prompt)
    setDialogOpen(true)
  }

  async function handleDelete(prompt: ProjectPrompt) {
    if (!window.confirm(`确认删除提示词「${prompt.name}」？`)) return
    try {
      await deleteMyProjectPrompt(prompt.id)
      await reload()
      if (value === prompt.id) onChange("")
      toast.success("已删除提示词")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败")
    }
  }

  return (
    <div className="grid gap-2">
      <Label>项目提示词</Label>
      <select
        className="h-11 rounded-md border bg-background px-3 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={loading}
      >
        <option value="">不使用项目提示词</option>
        {system.length > 0 && (
          <optgroup label="系统提示词">
            {system.filter(matchesProvider).map((prompt) => (
              <option key={prompt.id} value={prompt.id}>{prompt.name}</option>
            ))}
          </optgroup>
        )}
        <optgroup label="我的提示词">
          {mine.filter(matchesProvider).map((prompt) => (
            <option key={prompt.id} value={prompt.id}>{prompt.name}{prompt.enabled ? "" : "（已停用）"}</option>
          ))}
        </optgroup>
      </select>
      <p className="text-xs text-muted-foreground">
        切换后写入编辑器工作目录的 {provider === "claude" ? "CLAUDE.md" : "AGENTS.md"}。
      </p>
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setManageOpen((prev) => !prev)}
      >
        <ChevronDown className={`size-3.5 transition-transform ${manageOpen ? "rotate-180" : ""}`} />
        管理我的提示词（{mine.length}）
      </button>
      {manageOpen && (
        <div className="rounded-md border bg-muted/20 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">我的提示词</span>
            <Button size="sm" variant="outline" className="h-7" onClick={openCreate}><Plus className="size-3.5" /> 新建</Button>
          </div>
          {loading ? (
            <div className="flex justify-center py-2"><Spinner className="size-4" /></div>
          ) : mine.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">还没有自己的提示词</p>
          ) : (
            <ul className="space-y-1">
              {mine.map((prompt) => (
                <li key={prompt.id} className="flex items-center gap-2 rounded border bg-background px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{prompt.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {prompt.providers.length === 0 ? "全部类型" : prompt.providers.join("、")}
                      {!prompt.enabled && " · 已停用"}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="size-6" title="编辑" onClick={() => openEdit(prompt)}><Pencil className="size-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="size-6" title="删除" onClick={() => void handleDelete(prompt)}><Trash2 className="size-3.5 text-destructive" /></Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <PromptEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        defaultProviders={provider ? [provider] : []}
        onSaved={async (saved) => {
          await reload()
          onChange(saved.id)
          setDialogOpen(false)
        }}
      />
    </div>
  )
}

function PromptEditDialog({
  open, onOpenChange, editing, defaultProviders, onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: ProjectPrompt | null
  defaultProviders: string[]
  onSaved: (prompt: ProjectPrompt) => void
}) {
  const [name, setName] = useState("")
  const [content, setContent] = useState("")
  const [providers, setProviders] = useState<string[]>([])
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(editing?.name || "")
    setContent(editing?.content || "")
    setProviders(editing?.providers?.length ? editing.providers : defaultProviders)
    setEnabled(editing?.enabled ?? true)
    setError(null)
  }, [open, editing, defaultProviders])

  function toggleProvider(value: string) {
    setProviders((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]))
  }

  async function submit() {
    if (!name.trim()) { setError("请填写名称"); return }
    if (!content.trim()) { setError("请填写提示词内容"); return }
    setSaving(true); setError(null)
    try {
      const payload = { name: name.trim(), content, providers, enabled }
      const saved = editing
        ? await updateMyProjectPrompt(editing.id, payload)
        : await createMyProjectPrompt(payload)
      onSaved(saved)
      toast.success(editing ? "已更新提示词" : "已创建提示词")
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[94vw] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="flex-row items-center justify-between gap-2 border-b px-6 py-4">
          <DialogTitle>{editing ? "编辑提示词" : "新建提示词"}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
          {error && <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
          <div className="grid gap-2"><Label>名称</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid min-h-0 flex-1 flex-col gap-2">
            <Label>提示词内容（Markdown）</Label>
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[44vh] flex-1 resize-y font-mono text-xs" placeholder="写入编辑器工作目录，Claude 读 CLAUDE.md，Codex/OpenCode 读 AGENTS.md。" />
          </div>
          <div className="grid gap-2">
            <Label>适用编辑器类型</Label>
            <div className="flex flex-wrap gap-3">
              {ALL_PROVIDERS.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={providers.includes(p)} onChange={() => toggleProvider(p)} />
                  {p}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div><Label>启用</Label><p className="text-xs text-muted-foreground">停用后不再出现在可选列表。</p></div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? <Spinner className="size-4" /> : null} 保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
