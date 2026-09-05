import { useCallback, useEffect, useMemo, useState } from "react"
import { FileText, Plus, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"
import MarkdownEditor from "@/components/common/markdown-editor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ManagerRefreshButton } from "@/components/manager/manager-header-actions"

/**
 * SOP 资源管理页（管理端）。改造为资源目录式卡片浏览：
 * - 类型筛选（全部 / 内置 / 自定义）
 * - 关键词搜索（名称 + 描述 + filename）
 * - 卡片网格 + 详情弹框（编辑 SOP 正文）
 *
 * 安装语义说明（重要）：SOP 的 per-Agent 安装交互协议尚未统一规划。
 * 内置 SOP 为运行时默认能力，对所有 Agent 自动生效，无需安装，也不进入可安装候选。
 * 自定义/外部 SOP 通过后端 AgentSopBinding 绑定到具体 Agent（后端能力已保留）；
 * 当前页面不提供"安装到 Agent"按钮，避免伪造安装效果。enabled 仅控制目录条目是否
 * 在 catalog 中可用，不等于"对所有 Agent 安装"。
 */
interface SopResource {
  id: string
  name: string
  description: string
  filename: string
  content: string
  enabled: boolean
  is_builtin: boolean
  revision: number
}

type SopTypeFilter = "all" | "builtin" | "custom"

async function sopFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/agent${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || data.message || `SOP 请求失败 (${response.status})`)
  return data as T
}

export function SopResourcePanel() {
  const [items, setItems] = useState<SopResource[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [typeFilter, setTypeFilter] = useState<SopTypeFilter>("all")
  const [query, setQuery] = useState("")
  // 详情编辑弹框：editingId=null 表示新建草稿，undefined 表示未打开。
  const [editing, setEditing] = useState<SopResource | null | undefined>(undefined)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await sopFetch<{ sops: SopResource[] }>("/sops")
      setItems(data.sops || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载 SOP 失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => {
      if (typeFilter === "builtin" && !item.is_builtin) return false
      if (typeFilter === "custom" && item.is_builtin) return false
      if (!q) return true
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.filename.toLowerCase().includes(q)
      )
    })
  }, [items, typeFilter, query])

  const builtinCount = useMemo(() => items.filter((i) => i.is_builtin).length, [items])
  const customCount = items.length - builtinCount

  const openEdit = (item: SopResource) => {
    setEditing({ ...item, content: item.content ?? "" })
  }

  const openCreate = () => {
    setEditing({
      id: "",
      name: "新 SOP",
      description: "",
      filename: "",
      content: "# 新 SOP\n",
      enabled: true,
      is_builtin: false,
      revision: 1,
    })
  }

  const updateEditing = (patch: Partial<SopResource>) => {
    setEditing((cur) => (cur ? { ...cur, ...patch } : cur))
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    try {
      if (editing.id) {
        const updated = await sopFetch<SopResource>(`/sops/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: editing.name,
            description: editing.description,
            content: editing.content,
            enabled: editing.enabled,
            expected_revision: editing.revision,
          }),
        })
        setItems((current) => current.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)))
        toast.success("SOP 已保存")
      } else {
        const created = await sopFetch<SopResource>("/sops", {
          method: "POST",
          body: JSON.stringify({ name: editing.name, description: editing.description, content: editing.content }),
        })
        setItems((current) => [...current, created])
        toast.success("SOP 已创建")
      }
      setEditing(undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存 SOP 失败")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: SopResource) => {
    if (item.is_builtin) return
    if (!window.confirm(`删除 SOP「${item.name}」？`)) return
    try {
      await sopFetch(`/sops/${item.id}`, { method: "DELETE" })
      await reload()
      if (editing?.id === item.id) setEditing(undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除 SOP 失败")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          value={typeFilter}
          onValueChange={(v) => v && setTypeFilter(v as SopTypeFilter)}
          size="sm"
        >
          <ToggleGroupItem value="all" aria-label="全部">全部（{items.length}）</ToggleGroupItem>
          <ToggleGroupItem value="builtin" aria-label="内置">内置（{builtinCount}）</ToggleGroupItem>
          <ToggleGroupItem value="custom" aria-label="自定义">自定义（{customCount}）</ToggleGroupItem>
        </ToggleGroup>
        <Input
          placeholder="搜索名称、描述或文件名"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <div className="ml-auto flex items-center gap-3">
          {/* 安装到 Agent 的交互协议未统一规划，这里只提供目录管理与新建。 */}
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            新建 SOP
          </Button>
          <ManagerRefreshButton loading={loading} onClick={() => void reload()} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        内置 SOP 为运行时默认能力，对所有 Agent 自动生效，无需安装；自定义 SOP 的 per-Agent
        安装交互待统一规划，当前仅做目录维护（编辑/删除/启停 catalog 条目）。
      </p>

      {loading ? (
        <Empty><Spinner /> 加载中...</Empty>
      ) : filtered.length === 0 ? (
        <Empty>
          {items.length === 0 ? "暂无 SOP" : "无匹配的 SOP"}
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <Card key={item.id} size="sm" className="shadow-none">
              <CardContent className="flex h-full flex-col p-4">
                <div className="mb-2 flex items-start gap-2">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <FileText className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{item.name}</span>
                      {item.is_builtin ? (
                        <Badge variant="secondary" className="text-[10px]" title="系统内置，自动生效，无需安装">
                          系统内置
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]" title="自定义 SOP，安装方式待统一规划">
                          自定义
                        </Badge>
                      )}
                      {!item.enabled && (
                        <Badge variant="outline" className="text-[10px]">已停用</Badge>
                      )}
                    </div>
                    <span className="truncate text-[11px] text-muted-foreground">{item.filename}</span>
                  </div>
                </div>
                <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">
                  {item.description || (item.is_builtin ? "Built-in GenericAgent SOP" : "暂无描述")}
                </p>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(item)}>
                    查看与编辑
                  </Button>
                  {!item.is_builtin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => void remove(item)}
                    >
                      <Trash2 className="mr-1 size-3.5" />
                      删除
                    </Button>
                  ) : (
                    <Badge variant="outline" className="self-center text-[10px]" title="不可删除">
                      不可删除
                    </Badge>
                  )}
                  {/* per-Agent 安装协议待统一规划：占位、禁用、明确提示。
                      不在此处伪造"安装到所有 Agent"效果。 */}
                  {!item.is_builtin && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled
                      title="安装到具体 Agent 的交互协议待统一规划"
                    >
                      安装方式待规划
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => { if (!open) setEditing(undefined) }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? `编辑 SOP：${editing.name}` : "新建 SOP"}
              {editing?.is_builtin && (
                <Badge variant="secondary" className="ml-2 text-[10px]">系统内置 / 自动生效</Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>名称</Label>
                  <Input
                    value={editing.name}
                    onChange={(e) => updateEditing({ name: e.target.value })}
                    disabled={editing.is_builtin}
                  />
                </div>
                <div className="space-y-1">
                  <Label>文件</Label>
                  <Input value={editing.filename} disabled />
                </div>
              </div>
              <div className="space-y-1">
                <Label>描述</Label>
                <Textarea
                  rows={2}
                  value={editing.description}
                  onChange={(e) => updateEditing({ description: e.target.value })}
                  disabled={editing.is_builtin}
                  placeholder={editing.is_builtin ? "Built-in GenericAgent SOP" : "可选"}
                />
              </div>
              <div className="space-y-1">
                <Label>SOP 正文（Markdown）</Label>
                <div className="h-[52vh] min-h-0">
                  <MarkdownEditor
                    value={editing.content || ""}
                    onChange={(content) => updateEditing({ content })}
                    height="100%"
                    disabled={editing.is_builtin}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                {!editing.is_builtin && (
                  <Button variant="destructive" onClick={() => void remove(editing)}>
                    <Trash2 className="mr-2 size-4" />
                    删除
                  </Button>
                )}
                {!editing.is_builtin && (
                  <Button disabled={saving} onClick={() => void save()}>
                    {saving ? <Spinner className="mr-2 size-4" /> : <Save className="mr-2 size-4" />}
                    保存
                  </Button>
                )}
                {editing.is_builtin && (
                  <span className="self-center text-xs text-muted-foreground">
                    内置 SOP 只读：通过 <code>agent/sop/*.md</code> 维护，服务启动时刷新。
                  </span>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
