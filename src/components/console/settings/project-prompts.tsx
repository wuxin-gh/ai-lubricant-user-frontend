import { useCallback, useEffect, useMemo, useState } from "react"
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import {
  createMyProjectPrompt,
  deleteMyProjectPrompt,
  listProjectPrompts,
  updateMyProjectPrompt,
  type ProjectPrompt,
} from "@/api/editorClient"

const ALL_PROVIDERS = ["claude", "codex", "opencode"] as const

/**
 * 设置弹框内的「项目提示词」分区：只管理当前用户的私有提示词。
 *
 * 复用用户端已有的 /api/v1/users/project-prompts 接口（系统 owner 为空只读、mine
 * 可增删改），与编辑器配置弹框内 ProjectPromptSelector 共用 source of truth：
 * 这里改完，编辑器那里刷新即可看到新选项。系统提示词由管理端维护，用户不可管理，
 * 因此本页不展示系统提示词；它仅在编辑器新建/配置弹框的选择器里作为可选项出现。
 */
export default function ProjectPromptsSettings() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [prompts, setPrompts] = useState<ProjectPrompt[]>([])
  const [editing, setEditing] = useState<ProjectPrompt | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProjectPrompt | null>(null)
  const [deleting, setDeleting] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setPrompts(await listProjectPrompts())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("consoleSettings.projectPrompts.toast.loadFailed"))
      setPrompts([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void reload()
  }, [reload])

  const myPrompts = useMemo(
    () => prompts.filter((p) => p.scope === "mine"),
    [prompts],
  )

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(prompt: ProjectPrompt) {
    setEditing(prompt)
    setDialogOpen(true)
  }

  async function handleDelete(prompt: ProjectPrompt) {
    setDeleting(true)
    try {
      await deleteMyProjectPrompt(prompt.id)
      await reload()
      toast.success(t("consoleSettings.projectPrompts.toast.deleted"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("consoleSettings.projectPrompts.toast.deleteFailed"))
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">
            {t("consoleSettings.projectPrompts.title", "项目提示词")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "consoleSettings.projectPrompts.description",
              "管理你自己的项目提示词；在编辑器配置中切换后写入其工作目录的 CLAUDE.md / AGENTS.md。系统提示词由管理端维护，不可在此管理，仅在编辑器选择时可见。",
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()}>
          <RefreshCw className="size-4" />
          {t("consoleSettings.projectPrompts.refresh", "刷新")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {/* 我的提示词（CRUD） */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("consoleSettings.projectPrompts.mineTitle", "我的提示词")}
            </h3>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="size-4" />
              {t("consoleSettings.projectPrompts.create", "新建提示词")}
            </Button>
          </div>
          {myPrompts.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
              {t("consoleSettings.projectPrompts.mineEmpty", "还没有自己的提示词，点击「新建提示词」创建。")}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {myPrompts.map((prompt) => (
                <PromptRow
                  key={prompt.id}
                  prompt={prompt}
                  readonly={false}
                  onEdit={() => openEdit(prompt)}
                  onDelete={() => setDeleteTarget(prompt)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <PromptEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={async () => {
          await reload()
          setDialogOpen(false)
        }}
      />

      {deleteTarget && (
        <ConfirmDeleteDialog
          name={deleteTarget.name}
          deleting={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleDelete(deleteTarget)}
        />
      )}
    </div>
  )
}

function PromptRow({
  prompt,
  readonly,
  onEdit,
  onDelete,
}: {
  prompt: ProjectPrompt
  readonly: boolean
  onEdit: (() => void) | null
  onDelete: (() => void) | null
}) {
  const providersLabel =
    prompt.providers.length === 0 ? "全部" : prompt.providers.join("、")
  return (
    <li className="flex items-start gap-2 rounded-md border bg-background px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{prompt.name}</span>
          <Badge variant={prompt.enabled ? "default" : "outline"}>
            {prompt.enabled ? "已启用" : "已停用"}
          </Badge>
        </div>
        <p className="mt-1 line-clamp-2 max-w-prose text-xs text-muted-foreground">
          {prompt.content || "（无内容）"}
        </p>
        <div className="mt-1 text-[11px] text-muted-foreground">
          适用编辑器：{providersLabel}
        </div>
      </div>
      {!readonly && (
        <div className="flex shrink-0 items-center gap-1">
          {onEdit && (
            <Button size="icon" variant="ghost" className="size-7" title="编辑" onClick={onEdit}>
              <Pencil className="size-3.5" />
            </Button>
          )}
          {onDelete && (
            <Button size="icon" variant="ghost" className="size-7" title="删除" onClick={onDelete}>
              <Trash2 className="size-3.5 text-destructive" />
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function PromptEditDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: ProjectPrompt | null
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [content, setContent] = useState("")
  const [providers, setProviders] = useState<string[]>([...ALL_PROVIDERS])
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(editing?.name || "")
    setContent(editing?.content || "")
    setProviders(editing?.providers?.length ? editing.providers : [...ALL_PROVIDERS])
    setEnabled(editing?.enabled ?? true)
    setError(null)
  }, [open, editing])

  function toggleProvider(value: string) {
    setProviders((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]))
  }

  async function submit() {
    if (!name.trim()) {
      setError(t("consoleSettings.projectPrompts.error.nameRequired", "请填写名称"))
      return
    }
    if (!content.trim()) {
      setError(t("consoleSettings.projectPrompts.error.contentRequired", "请填写内容"))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = { name: name.trim(), content, providers, enabled }
      if (editing) {
        await updateMyProjectPrompt(editing.id, payload)
        toast.success(t("consoleSettings.projectPrompts.toast.updated"))
      } else {
        await createMyProjectPrompt(payload)
        toast.success(t("consoleSettings.projectPrompts.toast.created"))
      }
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("consoleSettings.projectPrompts.toast.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[94vw] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="flex-row items-center justify-between gap-2 border-b px-6 py-4">
          <DialogTitle>
            {editing
              ? t("consoleSettings.projectPrompts.editTitle", "编辑提示词")
              : t("consoleSettings.projectPrompts.createTitle", "新建提示词")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
          )}
          <div className="grid gap-2">
            <Label>{t("consoleSettings.projectPrompts.field.name", "名称")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：后端服务规范" />
          </div>
          <div className="grid min-h-0 flex-1 flex-col gap-2">
            <Label>{t("consoleSettings.projectPrompts.field.content", "提示词内容（Markdown）")}</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[44vh] flex-1 resize-y font-mono text-xs"
              placeholder="写入编辑器工作目录，Claude 读 CLAUDE.md，Codex/OpenCode 读 AGENTS.md。"
            />
          </div>
          <div className="grid gap-2">
            <Label>{t("consoleSettings.projectPrompts.field.providers", "适用编辑器类型")}</Label>
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
            <div>
              <Label>{t("consoleSettings.projectPrompts.field.enabled", "启用")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("consoleSettings.projectPrompts.field.enabledHint", "停用后不再出现在可选列表。")}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("consoleSettings.projectPrompts.cancel", "取消")}
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving && <Spinner className="size-4" />}
            {t("consoleSettings.projectPrompts.save", "保存")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmDeleteDialog({
  name,
  deleting,
  onCancel,
  onConfirm,
}: {
  name: string
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("consoleSettings.projectPrompts.deleteTitle", "删除提示词")}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t("consoleSettings.projectPrompts.deleteDescription", {
              name,
              defaultValue: `确认删除「${name}」？已绑定该提示词的编辑器会保留已写入的文件，但不再可切换到它。`,
            })}
          </p>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={deleting}>
            {t("consoleSettings.projectPrompts.cancel", "取消")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
            {deleting && <Spinner className="size-4" />}
            {t("consoleSettings.projectPrompts.delete", "删除")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}