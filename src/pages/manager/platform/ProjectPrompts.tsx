/**
 * 项目提示词管理页 —— 管理端维护，用户编辑器绑定后写入工作目录的 CLAUDE.md / AGENTS.md。
 * 布局沿用 ProxyPool：AdminPage + SectionCard + SimpleTable + 创建/编辑 Dialog + 删除 AlertDialog。
 */
import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { AdminPage, SectionCard, SimpleTable } from "@/components/manager/platform-page"
import type { SimpleTableColumn } from "@/components/manager/platform-page"
import { ManagerRefreshButton } from "@/components/manager/manager-header-actions"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import {
  createProjectPrompt, deleteProjectPrompt, listProjectPrompts, updateProjectPrompt,
  type ProjectPrompt,
} from "@/@admin-port/api/projectPrompts"

const PROVIDERS = ["claude", "codex", "opencode"] as const

interface PromptRow extends Record<string, unknown> {
  id: string
  name: string
  content: string
  providers: string[]
  enabled: boolean
}

export function ProjectPrompts() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ProjectPrompt[]>([])
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectPrompt | null>(null)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [content, setContent] = useState("")
  const [providers, setProviders] = useState<string[]>([...PROVIDERS])
  const [enabled, setEnabled] = useState(true)
  const [confirmRow, setConfirmRow] = useState<PromptRow | null>(null)

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await listProjectPrompts())
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载数据失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void fetchData() }, [])

  const openAdd = () => {
    setEditing(null)
    setName(""); setContent(""); setProviders([...PROVIDERS]); setEnabled(true)
    setModalError(null); setModalOpen(true)
  }

  const openEdit = (row: ProjectPrompt) => {
    setEditing(row)
    setName(row.name); setContent(row.content)
    setProviders(row.providers?.length ? row.providers : [...PROVIDERS])
    setEnabled(row.enabled); setModalError(null); setModalOpen(true)
  }

  const toggleProvider = (value: string) => {
    setProviders((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]))
  }

  const handleSubmit = async () => {
    if (!name.trim()) { setModalError("请填写名称"); return }
    if (!content.trim()) { setModalError("请填写提示词内容"); return }
    setSaving(true); setModalError(null)
    try {
      const payload = { name: name.trim(), content, providers, enabled }
      if (editing) await updateProjectPrompt(editing.id, payload)
      else await createProjectPrompt(payload)
      setModalOpen(false)
      await fetchData()
      toast.success(editing ? "已更新提示词" : "已创建提示词")
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (row: PromptRow) => {
    setDeleteLoadingId(row.id)
    try {
      await deleteProjectPrompt(row.id)
      await fetchData()
      toast.success("已删除提示词")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleteLoadingId(null)
      setConfirmRow(null)
    }
  }
  const tableRows: PromptRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    content: row.content,
    providers: row.providers || [],
    enabled: row.enabled,
  }))

  const columns: SimpleTableColumn<PromptRow>[] = [
    { key: "name", label: "名称" },
    {
      key: "content",
      label: "内容摘要",
      render: (_v, row) => (
        <span className="line-clamp-1 max-w-md text-xs text-muted-foreground">{row.content}</span>
      ),
    },
    {
      key: "providers",
      label: "适用编辑器",
      width: 220,
      render: (_v, row) => (
        <div className="flex flex-wrap gap-1">
          {row.providers.length === 0
            ? <span className="text-xs text-muted-foreground">全部</span>
            : row.providers.map((p) => <Badge key={p} variant="secondary">{p}</Badge>)}
        </div>
      ),
    },
    {
      key: "enabled",
      label: "状态",
      width: 100,
      render: (_v, row) => (
        <Badge variant={row.enabled ? "default" : "outline"}>{row.enabled ? "已启用" : "已停用"}</Badge>
      ),
    },
    {
      key: "actions",
      label: "操作",
      width: 160,
      align: "right",
      render: (_v, row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(rows.find((r) => r.id === row.id)!)}>编辑</Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={deleteLoadingId === row.id}
            onClick={() => setConfirmRow(row)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ]

  return (
    <AdminPage
      title="项目提示词"
      description="集中维护项目提示词，用户在编辑器配置中切换后写入其工作目录的 CLAUDE.md / AGENTS.md。"
      primaryActions={
        <>
          <ManagerRefreshButton loading={loading} onClick={() => void fetchData()} />
          <Button size="sm" onClick={openAdd}><Plus className="size-4" /> 新建提示词</Button>
        </>
      }
    >
      {error && (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <SectionCard title="提示词列表" description={`共 ${tableRows.length} 条`}>
        {loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : (
          <SimpleTable columns={columns} rows={tableRows} rowKey="id" emptyText="还没有提示词" />
        )}
      </SectionCard>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "编辑提示词" : "新建提示词"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {modalError && (
              <Alert variant="destructive"><AlertDescription>{modalError}</AlertDescription></Alert>
            )}
            <div className="space-y-2">
              <Label>名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：后端服务规范" />
            </div>
            <div className="space-y-2">
              <Label>提示词内容（Markdown）</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={28}
                className="font-mono text-xs"
                placeholder="# 项目规范&#10;&#10;写入编辑器工作目录，Claude 读 CLAUDE.md，Codex/OpenCode 读 AGENTS.md。"
              />
            </div>
            <div className="space-y-2">
              <Label>适用编辑器类型</Label>
              <div className="flex flex-wrap gap-3">
                {PROVIDERS.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={providers.includes(p)} onChange={() => toggleProvider(p)} />
                    {p}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>启用</Label>
                <p className="text-xs text-muted-foreground">停用后用户侧不再出现在可选列表中。</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>取消</Button>
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? <Spinner className="size-4" /> : null} 保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmRow} onOpenChange={(open) => !open && setConfirmRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除提示词</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除“{confirmRow?.name}”？已绑定该提示词的编辑器会保留已写入的文件，但不再可切换到它。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => confirmRow && void handleDelete(confirmRow)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPage>
  )
}
