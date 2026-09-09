/**
 * 环境管理面板：列出该节点上的共用环境、进详情配 skill/MCP/插件、看节点实际装了什么。
 *
 * 用在两处：节点详情弹框的「环境」Tab，和创建任务弹框选共用档时的精简版（compact）。
 *
 * 这里改资源 = 真装真卸（环境维护）；任务里取消某个资源只是那一次不激活，不动这里的
 * 文件——所以面板里增删和「任务用子集」是两件事，别混。
 */
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Plus, RefreshCw, Trash2 } from "lucide-react"
import {
  type EnvExtra,
  type EnvResource,
  type TaskEnvironment,
  type TaskEnvironmentDetail,
  addEnvironmentResource,
  createEnvironment,
  deleteEnvironment,
  getEnvironment,
  listEnvironments,
  refreshEnvironmentInventory,
  removeEnvironmentResource,
  syncEnvironment,
} from "@/api/environmentClient"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { listEffectiveResources, type ResourceReference } from "@/api/resourceReferences"

const RESOURCE_KINDS = [
  { kind: "skill", label: "技能" },
  { kind: "mcp", label: "MCP" },
  { kind: "plugin", label: "插件" },
] as const

type ResourceKind = (typeof RESOURCE_KINDS)[number]["kind"]

function stateLabel(state?: EnvResource["state"]): string {
  switch (state) {
    case "installed": return "已安装"
    case "pending": return "待同步"
    case "config": return "配置"
    default: return ""
  }
}

function stateVariant(state?: EnvResource["state"]) {
  if (state === "pending") return "destructive" as const
  if (state === "installed") return "default" as const
  return "secondary" as const
}

/** 一个环境详情：资源列表 + 节点清单 diff + 增删 + 同步。
 *  也被创建任务弹框的「管理资源」复用（弹框壳传 envId + onClose）。 */
export function EnvironmentDetail({
  envId,
  onClose,
}: {
  envId: string
  onClose: () => void
}) {
  const [detail, setDetail] = useState<TaskEnvironmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState<ResourceKind | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      setDetail(await getEnvironment(envId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载环境详情失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [envId])

  const doSync = async () => {
    setBusy("sync")
    try {
      await syncEnvironment(envId)
      toast.success("已同步到节点")
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "同步失败")
    } finally { setBusy(null) }
  }

  const doRemoveResource = async (entry: EnvResource) => {
    setBusy(entry.id)
    try {
      await removeEnvironmentResource(envId, entry.id)
      toast.success(`已从环境移除「${entry.name}」`)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "移除失败")
    } finally { setBusy(null) }
  }

  const doAddResource = async (kind: ResourceKind, resourceId: string, displayName: string) => {
    setBusy(`add-${kind}`)
    try {
      await addEnvironmentResource(envId, { kind, resource_id: resourceId })
      toast.success(`已加入「${displayName}」`)
      setAdding(null)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加入失败")
    } finally { setBusy(null) }
  }

  if (loading && !detail) return <div className="flex h-32 items-center justify-center"><Spinner /></div>
  if (!detail) return null

  const grouped = RESOURCE_KINDS.map(({ kind, label }) => ({
    kind, label,
    items: detail.resources.filter((r) => r.kind === kind),
  }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{detail.name}</span>
            {detail.needs_sync ? (
              <Badge variant="destructive" className="text-[10px]">待同步</Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">已同步</Badge>
            )}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">{detail.id}</div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="outline" disabled={busy === "sync"} onClick={doSync}>
            <RefreshCw className={busy === "sync" ? "animate-spin" : undefined} /> 同步
          </Button>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            <RefreshCw /> 刷新
          </Button>
        </div>
      </div>
      {detail.last_sync_error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          上次同步失败：{detail.last_sync_error}
        </div>
      ) : null}

      {grouped.map(({ kind, label, items }) => (
        <div key={kind} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{label}（{items.length}）</span>
            <Button size="sm" variant="ghost" onClick={() => setAdding(kind)}>
              <Plus className="size-3" /> 添加
            </Button>
          </div>
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">尚未配置，点「添加」从已授权资源选。</p>
          ) : (
            <div className="flex flex-col divide-y rounded border">
              {items.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{entry.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {entry.version || "无版本"} · {stateLabel(entry.state)}
                    </div>
                  </div>
                  <Button
                    size="sm" variant="ghost"
                    disabled={busy === entry.id}
                    onClick={() => void doRemoveResource(entry)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {detail.extras.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">多余（节点上有、配置里没有，多从维护终端手装）</span>
          <div className="flex flex-col divide-y rounded border">
            {detail.extras.map((extra: EnvExtra) => (
              <div key={`${extra.kind}-${extra.name}`} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm">{extra.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{extra.kind} · {extra.version || "无版本"}</div>
                </div>
                <Badge variant="outline" className="text-[10px]">手动</Badge>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {adding ? (
        <ResourcePickerDialog
          kind={adding}
          onClose={() => setAdding(null)}
          onPick={(id, name) => void doAddResource(adding, id, name)}
        />
      ) : null}

      <Button size="sm" variant="ghost" onClick={onClose}>返回环境列表</Button>
    </div>
  )
}

/** 从已授权资源里挑一个加入环境。 */
function ResourcePickerDialog({
  kind, onClose, onPick,
}: {
  kind: ResourceKind
  onClose: () => void
  onPick: (resourceId: string, displayName: string) => void
}) {
  const [rows, setRows] = useState<ResourceReference[]>([])
  const [loading, setLoading] = useState(true)
  const kindLabel = kind === "skill" ? "技能" : kind === "mcp" ? "MCP" : "插件"

  useEffect(() => {
    let active = true
    setLoading(true)
    void listEffectiveResources(kind)
      .then((items) => { if (active) setRows(items) })
      .catch((err) => { if (active) toast.error(err instanceof Error ? err.message : `加载${kindLabel}失败`) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [kind, kindLabel])

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      {/* z-[90]：在创建任务弹框的「管理资源」（z-[80]）里复用本组件时，添加弹框要盖住外层。 */}
      <DialogContent className="z-[90] sm:max-w-lg" overlayClassName="z-[90]">
        <DialogHeader><DialogTitle>选择{kindLabel}</DialogTitle></DialogHeader>
        {loading ? (
          <div className="flex h-32 items-center justify-center"><Spinner /></div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            没有已授权的{kindLabel}。先在资源页引用并授权给你的分组。
          </p>
        ) : (
          <div className="max-h-[50vh] overflow-auto rounded border divide-y">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-muted"
                onClick={() => onPick(row.id, row.display_name || row.name)}
              >
                <div className="truncate text-sm">{row.display_name || row.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {row.version ? `v${row.version}` : "无版本"} · {row.market_id}
                </div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 新建环境的小表单。 */
function NewEnvironmentForm({ nodeId, onCreated, onCancel }: {
  nodeId: string
  onCreated: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) { toast.error("环境名不能为空"); return }
    setSubmitting(true)
    try {
      await createEnvironment({ node_id: nodeId, name: trimmed })
      toast.success(`已创建环境「${trimmed}」`)
      setName("")
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败")
    } finally { setSubmitting(false) }
  }
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1 space-y-1">
        <Label className="text-xs">环境名</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 prod-keys" onKeyDown={(e) => { if (e.key === "Enter") void submit() }} />
      </div>
      <Button size="sm" disabled={submitting} onClick={submit}>创建</Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
    </div>
  )
}

export interface EnvironmentPanelProps {
  nodeId: string
  /** compact=true 用于创建弹框：只列表+建+选，点环境进详情用抽屉而非全屏。 */
  compact?: boolean
  /** 选中某个环境（创建弹框用：把 env_id 带回表单）。 */
  onSelect?: (envId: string, name: string) => void
  selectedEnvId?: string
}

/** 环境管理面板主体。compact 模式（创建任务弹框）：行首多选框 + 新建旁批量删除。 */
export function EnvironmentPanel({ nodeId, compact, onSelect, selectedEnvId }: EnvironmentPanelProps) {
  const [envs, setEnvs] = useState<TaskEnvironment[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  // compact 多选（批量删除用）：本地状态即可，不改 Props 接口。
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try { setEnvs(await listEnvironments(nodeId)) }
    catch { setEnvs([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [nodeId])

  const doDelete = async (env: TaskEnvironment) => {
    if (!confirm(`删除环境「${env.name}」？节点上的目录会一并回收。`)) return
    setBusy(env.id)
    try {
      await deleteEnvironment(env.id)
      toast.success(`已删除环境「${env.name}」`)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally { setBusy(null) }
  }

  /** 批量删除：只删勾选的项；无批量接口，逐条 deleteEnvironment 并行。 */
  const doBatchDelete = async () => {
    if (checkedIds.size === 0) return
    if (!confirm(`删除选中的 ${checkedIds.size} 个环境？节点上的目录会一并回收。`)) return
    setBatchDeleting(true)
    const failed: string[] = []
    await Promise.allSettled([...checkedIds].map(async (id) => {
      try { await deleteEnvironment(id) } catch { failed.push(envs.find((e) => e.id === id)?.name || id) }
    }))
    setCheckedIds(new Set())
    setBatchDeleting(false)
    await refresh()
    if (failed.length === 0) {
      toast.success(`已删除 ${checkedIds.size} 个环境`)
    } else {
      toast.warning(`${checkedIds.size - failed.length} 个已删除；失败：${failed.join("、")}`)
    }
  }

  const toggleChecked = (id: string) => {
    setCheckedIds((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const allChecked = envs.length > 0 && envs.every((env) => checkedIds.has(env.id))
  const toggleAllChecked = () => {
    setCheckedIds((cur) => cur.size === envs.length ? new Set() : new Set(envs.map((e) => e.id)))
  }

  if (detailId) {
    return (
      <div className="flex flex-col gap-3">
        <EnvironmentDetail envId={detailId} onClose={() => { setDetailId(null); void refresh() }} />
      </div>
    )
  }

  // compact 多选表格：选择列 + 环境 + 状态；非 compact 保持原三列。
  const colCount = compact ? 3 : 3
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          共用环境（任务跑在它里面，装好的依赖/登录态跨任务复用）
        </span>
        <div className="flex gap-1">
          {compact && checkedIds.size > 0 ? (
            <Button size="sm" variant="outline" disabled={batchDeleting} onClick={() => void doBatchDelete()}>
              {batchDeleting ? <Spinner className="size-3" /> : <Trash2 className="size-3" />} 删除（{checkedIds.size}）
            </Button>
          ) : null}
          {!creating ? (
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              <Plus className="size-3" /> 新建
            </Button>
          ) : null}
        </div>
      </div>

      {creating ? (
        <NewEnvironmentForm
          nodeId={nodeId}
          onCreated={() => { setCreating(false); void refresh() }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      <div className="overflow-hidden rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              {compact ? (
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAllChecked}
                    aria-label="全选"
                    className="size-3.5 accent-primary"
                  />
                </th>
              ) : null}
              <th className="px-3 py-2 text-left font-medium">环境</th>
              <th className="px-3 py-2 text-left font-medium">状态</th>
              {!compact ? <th className="px-3 py-2 text-right font-medium">操作</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={colCount} className="px-3 py-2 text-center text-muted-foreground">加载中…</td></tr>
            ) : envs.length === 0 ? (
              <tr><td colSpan={colCount} className="px-3 py-2 text-center text-muted-foreground">暂无环境，新建后任务可用。</td></tr>
            ) : (
              envs.map((env) => (
                <tr key={env.id} className={selectedEnvId === env.id ? "bg-accent" : ""}>
                  {compact ? (
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={checkedIds.has(env.id)}
                        onChange={() => toggleChecked(env.id)}
                        aria-label={`选择 ${env.name}`}
                        className="size-3.5 accent-primary"
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="block text-left"
                      onClick={() => (compact && onSelect ? onSelect(env.id, env.name) : setDetailId(env.id))}
                    >
                      <div className="font-medium">{env.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{env.id}</div>
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    {env.needs_sync
                      ? <Badge variant="destructive" className="text-[10px]">待同步</Badge>
                      : <Badge variant="secondary" className="text-[10px]">已同步</Badge>}
                  </td>
                  {!compact ? (
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setDetailId(env.id)}>详情</Button>
                        <Button size="sm" variant="ghost" disabled={busy === env.id} onClick={() => void doDelete(env)}>
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {compact ? (
        <p className="text-[11px] text-muted-foreground">
          资源配置和已安装清单点环境名进详情；这里只做建/选/删。
        </p>
      ) : null}
    </div>
  )
}
