/**
 * MCP 用户管理统一弹框（用户侧 / 管理侧共用同一套交互）。
 *
 * 一个弹框，两种模式：
 *  - list：MCP 用户卡片列表 + 顶部「添加 MCP 用户」按钮。
 *  - detail：点添加进入预创建详情（填写名称/说明/用途，创建后保留详情并显示一次性 token）；
 *    点某张卡进入该用户详情，卡片含名称/说明/用途/启停/token hint，下方内联权限资源编辑。
 * 不在此弹框展示 MCP 接入地址；管理端 runtime host/port 在资源中心「配置」Tab 维护。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ArrowLeft, Copy, ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react"

import type { McpPrincipal } from "@/api/mcpClient"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { SimpleTable, type SimpleTableColumn } from "@/components/manager/platform-page"
import {
  McpUserPermissionEditor,
  type PermissionEditorApi,
  type PermissionEditorHandle,
} from "@/components/console/mcp/McpUserPermissionEditor"

/** 统一的 principal 视图：复用 @/api/mcpClient 的 McpPrincipal（管理端 McpUser 结构兼容）。
 * 不再单独定义第三/四份类型；本组件只读其字段子集。 */
export type ManagedMcpUser = McpPrincipal

/** 各入口注入的 API 适配器。 */
export interface McpUserManagerApi {
  list: () => Promise<ManagedMcpUser[]>
  create: (payload: { name: string; description?: string; enabled?: boolean; usage_type?: "agent" | "external" }) => Promise<ManagedMcpUser>
  update: (id: number, payload: { name?: string; description?: string; enabled?: boolean }) => Promise<ManagedMcpUser>
  remove: (id: number) => Promise<void>
  rotate: (id: number) => Promise<ManagedMcpUser>
  /** 权限编辑器注入。 */
  permission: PermissionEditorApi
}

type Mode = "list" | "detail"

/** 用途中文标签：external=外部接入，agent=Agent，task=任务。 */
function usageTypeLabel(t?: string): string {
  switch (t) {
    case "agent": return "Agent"
    case "task": return "任务"
    case "external": return "外部接入"
    default: return "外部接入"
  }
}

export function McpUserManagerDialog({
  open,
  onClose,
  api,
  onOpenAgent,
  initialPrincipalId,
}: {
  open: boolean
  onClose: () => void
  api: McpUserManagerApi
  /** 进入 Agent 详情回调；仅 usage_type==='agent' 行显示该按钮。 */
  onOpenAgent?: (principalId: number) => void
  /** 打开时若给定，直接定位到该用户的详情模式（供「已授权用户」点击进入）。 */
  initialPrincipalId?: number | null
}) {
  const [users, setUsers] = useState<ManagedMcpUser[]>([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>("list")
  // detail 视图：current=正在编辑/查看的用户；isDraft=预创建（尚未落库）。
  const [current, setCurrent] = useState<ManagedMcpUser | null>(null)
  const [isDraft, setIsDraft] = useState(false)
  // 表单字段
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [usageType, setUsageType] = useState<"agent" | "external">("external")
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const permissionEditorRef = useRef<PermissionEditorHandle>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await api.list())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载 MCP 用户失败")
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (!open) return
    setMode("list")
    setCurrent(null)
    setIsDraft(false)
    setOneTimeToken(null)
    void load().then(() => {
      if (initialPrincipalId != null) {
        // 等列表加载完再定位，避免目标用户尚未在列表中。
        const target = usersRef.current.find((u) => u.id === initialPrincipalId)
        if (target) openDetail(target)
        else setCurrentById(initialPrincipalId)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, load, initialPrincipalId])

  // 保持 users 最新引用给 effect 内定位用（load 异步回调闭包会拿到旧值）。
  const usersRef = useRef<ManagedMcpUser[]>([])
  useEffect(() => { usersRef.current = users }, [users])

  const setCurrentById = (id: number) => {
    const target = usersRef.current.find((u) => u.id === id)
    if (target) openDetail(target)
    else toast.error("未找到该 MCP 用户")
  }

  const openCreate = () => {
    setCurrent(null)
    setIsDraft(true)
    setName("")
    setDescription("")
    setUsageType("external")
    setEnabled(true)
    setOneTimeToken(null)
    setMode("detail")
  }

  const openDetail = (u: ManagedMcpUser) => {
    setCurrent(u)
    setIsDraft(false)
    setName(u.name)
    setDescription(u.description || "")
    setUsageType(u.usage_type === "agent" ? "agent" : "external")
    setEnabled(u.enabled)
    setOneTimeToken(null)
    setMode("detail")
  }

  const backToList = () => {
    setMode("list")
    setCurrent(null)
    setIsDraft(false)
    setOneTimeToken(null)
    void load()
  }

  const save = async (): Promise<boolean> => {
    if (!name.trim()) { toast.error("请填写名称"); return false }
    setSaving(true)
    try {
      if (isDraft) {
        const created = await api.create({ name: name.trim(), description, enabled, usage_type: usageType })
        setCurrent(created)
        setIsDraft(false)
        setName(created.name); setDescription(created.description || "")
        setEnabled(created.enabled)
        setUsageType(created.usage_type === "agent" ? "agent" : "external")
        if (created.token && !created.masked && created.usage_type !== "agent") {
          setOneTimeToken(created.token)
        }
        toast.success("MCP 用户已创建")
        return true
      } else if (current) {
        const updated = await api.update(current.id, { name: name.trim(), description, enabled })
        setCurrent(updated)
        setUsers((rows) => rows.map((x) => (x.id === updated.id ? updated : x)))
        toast.success("MCP 用户已更新")
        return true
      }
      return false
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
      return false
    } finally {
      setSaving(false)
    }
  }

  /** 详情底部统一保存：先存属性，再存授权（属性失败则不存授权）。 */
  const saveAll = async () => {
    const ok = await save()
    if (!ok) return
    // 草稿态（刚创建或尚未落库）下授权编辑器尚未挂载，跳过。
    const grantsOk = await permissionEditorRef.current?.save()
    if (grantsOk) toast.success("授权已保存并热更新到运行时")
  }

  const toggleEnabledInline = async (u: ManagedMcpUser) => {
    setTogglingId(u.id)
    try {
      const updated = await api.update(u.id, { enabled: !u.enabled })
      setUsers((rows) => rows.map((x) => (x.id === updated.id ? updated : x)))
      if (current?.id === updated.id) {
        setCurrent(updated)
        setEnabled(updated.enabled)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败")
    } finally {
      setTogglingId(null)
    }
  }

  const rotate = async (u: ManagedMcpUser) => {
    if (!confirm(`重置「${u.name}」的 token？旧 token 立即失效。`)) return
    try {
      const updated = await api.rotate(u.id)
      setUsers((rows) => rows.map((x) => (x.id === updated.id ? updated : x)))
      if (current?.id === updated.id) setCurrent(updated)
      if (updated.token && !updated.masked) setOneTimeToken(updated.token)
      else toast.success("已重置 token")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重置失败")
    }
  }

  const remove = async (u: ManagedMcpUser) => {
    if (!confirm(`删除 MCP 用户「${u.name}」？其授权关系也会清除。`)) return
    try {
      await api.remove(u.id)
      setUsers((rows) => rows.filter((x) => x.id !== u.id))
      if (current?.id === u.id) backToList()
      else toast.success("已删除")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败")
    }
  }

  const copyToken = async () => {
    if (!oneTimeToken) return
    try {
      await navigator.clipboard.writeText(oneTimeToken)
      toast.success("token 已复制")
    } catch {
      toast.error("复制失败")
    }
  }

  const detailPrincipalId = current?.id ?? null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="flex !max-h-none !max-w-none h-[92vh] w-[98vw] flex-col gap-4 overflow-hidden p-0 sm:w-[1400px]">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            {mode === "detail" && (
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={backToList}>
                <ArrowLeft className="size-4" /> 返回
              </Button>
            )}
            {mode === "list" ? "MCP 用户管理" : isDraft ? "新建 MCP 用户" : `MCP 用户：${current?.name}`}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {mode === "list" ? (
            <ListMode
              users={users}
              loading={loading}
              onRefresh={() => void load()}
              onAdd={openCreate}
              onOpen={openDetail}
              onToggle={toggleEnabledInline}
              onRemove={remove}
              onRotate={rotate}
              onOpenAgent={onOpenAgent}
              togglingId={togglingId}
            />
          ) : (
            <DetailMode
              name={name} description={description} usageType={usageType} enabled={enabled} isDraft={isDraft}
              current={current} oneTimeToken={oneTimeToken} saving={saving} togglingId={togglingId}
              onChangeName={setName} onChangeDescription={setDescription} onChangeUsage={setUsageType}
              onChangeEnabled={setEnabled} onToggle={toggleEnabledInline}
              onRotate={rotate} onRemove={remove} onOpenAgent={onOpenAgent} onCopyToken={copyToken}
              api={api} principalId={detailPrincipalId} permissionEditorRef={permissionEditorRef}
            />
          )}
        </div>

        {mode === "detail" && (
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background px-6 py-3">
            <Button type="button" size="sm" variant="ghost" onClick={backToList}>取消</Button>
            <Button type="button" size="sm" disabled={saving || !name.trim()} onClick={() => void saveAll()}>
              {saving ? "保存中..." : isDraft ? "创建" : "保存"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── 列表模式 ───────────────────────────────────────────────────────────────

function ListMode({
  users, loading, onRefresh, onAdd, onOpen, onToggle, onRemove, onRotate, onOpenAgent, togglingId,
}: {
  users: ManagedMcpUser[]
  loading: boolean
  onRefresh: () => void
  onAdd: () => void
  onOpen: (u: ManagedMcpUser) => void
  onToggle: (u: ManagedMcpUser) => void
  onRemove: (u: ManagedMcpUser) => void
  onRotate: (u: ManagedMcpUser) => void
  onOpenAgent?: (principalId: number) => void
  togglingId: number | null
}) {
  interface Row extends Record<string, unknown> { u: ManagedMcpUser }
  const columns: SimpleTableColumn<Row>[] = [
    {
      key: "name",
      label: "名称",
      render: (_v, row) => (
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left"
          onClick={() => onOpen(row.u)}
          title="点击查看详情"
        >
          <span className="truncate text-sm font-medium">{row.u.name}</span>
          {row.u.description
            ? <span className="line-clamp-1 max-w-[16rem] text-xs text-muted-foreground">{row.u.description}</span>
            : null}
        </button>
      ),
    },
    {
      key: "usage_type",
      label: "用途",
      width: 110,
      render: (_v, row) => <Badge variant="outline" className="text-[10px]">{usageTypeLabel(row.u.usage_type)}</Badge>,
    },
    {
      key: "enabled",
      label: "启停",
      width: 80,
      render: (_v, row) => (
        <Switch
          checked={row.u.enabled}
          disabled={togglingId === row.u.id}
          onCheckedChange={() => onToggle(row.u)}
        />
      ),
    },
    {
      key: "token",
      label: "token",
      width: 110,
      render: (_v, row) => (
        row.u.token_hint
          ? <Badge variant="secondary" className="text-[10px]">已配置</Badge>
          : <Badge variant="outline" className="text-[10px]">未配置</Badge>
      ),
    },
    {
      key: "actions",
      label: "操作",
      width: 240,
      align: "right",
      render: (_v, row) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onOpen(row.u)}>详情</Button>
          {row.u.usage_type === "external" && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onRotate(row.u)}>轮换 token</Button>
          )}
          {row.u.usage_type === "agent" && onOpenAgent && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onOpenAgent(row.u.id)}>
              <ExternalLink className="size-3.5" /> Agent
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => onRemove(row.u)}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ]
  const rows: Row[] = users.map((u) => ({ u }))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">用户列表（{users.length}）</span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" className="h-7" disabled={loading} onClick={onRefresh}>
            <RefreshCw className="size-3.5" /> 刷新
          </Button>
          <Button type="button" size="sm" onClick={onAdd}>
            <Plus className="size-4" /> 添加 MCP 用户
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" /> 加载中...
        </div>
      ) : (
        <SimpleTable columns={columns} rows={rows} rowKey={(row) => String(row.u.id)} emptyText="暂无 MCP 用户，点「添加 MCP 用户」创建。" />
      )}
    </div>
  )
}

// ── 详情模式 ───────────────────────────────────────────────────────────────

function DetailMode({
  name, description, usageType, enabled, isDraft, current, oneTimeToken, saving, togglingId,
  onChangeName, onChangeDescription, onChangeUsage, onChangeEnabled, onToggle, onRotate,
  onRemove, onOpenAgent, onCopyToken, api, principalId, permissionEditorRef,
}: {
  name: string
  description: string
  usageType: "agent" | "external"
  enabled: boolean
  isDraft: boolean
  current: ManagedMcpUser | null
  oneTimeToken: string | null
  saving: boolean
  togglingId: number | null
  onChangeName: (v: string) => void
  onChangeDescription: (v: string) => void
  onChangeUsage: (v: "agent" | "external") => void
  onChangeEnabled: (v: boolean) => void
  onToggle: (u: ManagedMcpUser) => void
  onRotate: (u: ManagedMcpUser) => void
  onRemove: (u: ManagedMcpUser) => void
  onOpenAgent?: (principalId: number) => void
  onCopyToken: () => void
  api: McpUserManagerApi
  principalId: number | null
  permissionEditorRef: React.RefObject<PermissionEditorHandle | null>
}) {
  const [paramsCount, setParamsCount] = useState<number | null>(null)

  useEffect(() => {
    if (isDraft || !current || principalId == null) { setParamsCount(null); return }
    void api.permission.loadParams(principalId).then((p) => setParamsCount(p.length)).catch(() => setParamsCount(null))
  }, [api, current, isDraft, principalId])

  return (
    <div className="space-y-4">
      {/* 属性区：名称 + 启停一排，说明在下方；不显示用途（默认外部接入）。 */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[12rem] flex-1 items-center gap-2">
            <Label className="shrink-0 text-xs text-muted-foreground">名称</Label>
            <Input value={name} onChange={(e) => onChangeName(e.target.value)} placeholder="例如：外部接入" />
          </div>
          {!isDraft && current && (
            <div className="flex items-center gap-2">
              <Switch checked={enabled} disabled={togglingId === current.id} onCheckedChange={(v) => { onChangeEnabled(v); if (v !== current.enabled) onToggle(current) }} />
              <span className="text-[11px] text-muted-foreground">{enabled ? "启用" : "停用"}</span>
            </div>
          )}
        </div>
        <div className="flex items-start gap-2">
          <Label className="mt-2 shrink-0 text-xs text-muted-foreground">说明</Label>
          <Textarea value={description} onChange={(e) => onChangeDescription(e.target.value)} placeholder="用途说明" rows={2} className="flex-1" />
        </div>

        {oneTimeToken && (
          <div className="space-y-1 rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground">一次性明文 token（关闭后不再显示）：</p>
            <code className="block break-all font-mono text-xs">{oneTimeToken}</code>
            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={onCopyToken}>
              <Copy className="size-3.5" /> 复制
            </Button>
          </div>
        )}

        {!isDraft && current && usageType === "agent" && onOpenAgent && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onOpenAgent(current.id)}>
            <ExternalLink className="size-3.5" /> Agent 详情
          </Button>
        )}
        {saving && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" /> 处理中...
          </div>
        )}
      </div>

      {/* 内联权限资源编辑：仅已落库用户可改授权。保存由弹框底部统一按钮触发。 */}
      {!isDraft && current && principalId != null ? (
        <McpUserPermissionEditor
          ref={permissionEditorRef}
          principalId={principalId}
          api={api.permission}
          title={`操作参数（${paramsCount ?? "-"}）`}
        />
      ) : (
        <p className="text-xs text-muted-foreground">创建后即可配置操作参数（绑定 CDP 客户端 / 邮箱账户）。</p>
      )}
    </div>
  )
}
