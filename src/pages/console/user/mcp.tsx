/**
 * MCP 服务顶级页面（用户侧）。
 *
 * 从设置对话框的「MCP 与工具」tab 提到侧栏顶级页面。这里只管用户自配的外部
 * SSE MCP（kind=sse, user_id=自己），鉴权统一为 Authorization: Bearer <token>。
 *
 * 数据层走 /mcp/my-services/*（mcpClient.ts）；管理端/内置服务不在此处改动。
 */
import { useCallback, useEffect, useState } from "react"
import { Blocks, MoreVertical, Package, Plus, RefreshCw, ServerCog, Sparkles } from "lucide-react"
import { IconPencil, IconTrash } from "@tabler/icons-react"

import {
  listMyMcpServices,
  createMyMcpService,
  updateMyMcpService,
  deleteMyMcpService,
  syncMyMcpService,
  type MyMcpService,
  type CreateMyMcpPayload,
  type McpPrincipal,
  createMcpPrincipal,
  deleteMcpPrincipal,
  listMcpAuthorizationOptions,
  listMcpPrincipalGrants,
  listMcpPrincipals,
  replaceMcpPrincipalGrants,
  rotateMcpPrincipalToken,
  updateMcpPrincipal,
} from "@/api/mcpClient"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { type PermissionEditorApi } from "@/components/console/mcp/McpUserPermissionEditor"
import { McpUserManagerDialog, type McpUserManagerApi } from "@/components/console/mcp/McpUserManagerDialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ResourceCenterShell } from "@/components/console/resource-center/resource-center-shell"
import { ResourceMarketPanel } from "@/pages/manager/platform/ResourceMarketPanel"
import { ResourceMarketBoard } from "@/pages/manager/platform/ResourceMarketBoard"
import { PromptResourcePanel } from "@/pages/manager/platform/PromptResourcePanel"
import { importPluginUpload, importPluginUrl, importSkillUpload, importSkillUrl, deletePluginResource, deleteSkillResource, fetchManagedPluginListing, fetchManagedSkillListing, updatePluginResource, updateSkillResource } from "@/lib/agent-resources-api"
import { manifestToPluginSpec, manifestToSkillSpec } from "@/api/marketplaceRaw"
import { McpGithubImportDialog, type McpGithubImportPayload } from "@/components/manager/McpGithubImportDialog"
import { getAgentByMcpUser } from "@/api/agentClient"
import { toast } from "sonner"

type EditorMode = "form" | "json"

interface EditorForm {
  name: string
  displayName: string
  description: string
  url: string
  token: string
  headersText: string
  enabled: boolean
  /** JSON 模式下粘贴的完整 mcp server 配置。 */
  configText: string
}

const EMPTY_FORM: EditorForm = {
  name: "",
  displayName: "",
  description: "",
  url: "",
  token: "",
  headersText: "",
  enabled: true,
  configText: "",
}

/** 把 dict 序列化为 JSON 文本（空对象 → 空串，方便编辑框占位）。 */
function serializeJsonObject(map: Record<string, string>): string {
  const entries = Object.entries(map).filter(([k]) => k)
  if (entries.length === 0) return ""
  return JSON.stringify(Object.fromEntries(entries), null, 2)
}

/** 解析 JSON headers 文本为 dict；空串 → {}。非法 JSON 抛 Error。 */
function parseHeadersJson(text: string): Record<string, string> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch (e) {
    throw new Error("Headers 不是合法 JSON：" + (e instanceof Error ? e.message : String(e)))
  }
  if (data == null) return {}
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Headers 必须是 JSON 对象")
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (k && (typeof v === "string" || typeof v === "number")) {
      out[String(k)] = String(v)
    }
  }
  return out
}

interface ParsedServerConfig {
  url?: string
  token?: string
  headers?: Record<string, string>
  description?: string
  display_name?: string
}

/**
 * 解析一段 mcp server 配置 JSON，兼容：
 *  - Claude Desktop / Cursor 的 ``{ "mcpServers": { "<name>": { ... } } }`` 包裹格式
 *  - 单条服务对象 ``{ "url": "...", "headers": {...} }``
 *  - stdio 形态的配置（command/args/env）不适用于本页（用户侧仅 SSE），会被忽略。
 *
 * 只取第一个 SSE/HTTP server。返回解析结果用于回填表单；失败抛 Error。
 */
function parseServerConfig(text: string, fallbackName?: string): { name?: string } & ParsedServerConfig {
  const trimmed = text.trim()
  if (!trimmed) throw new Error("配置为空")
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch (e) {
    throw new Error("JSON 解析失败：" + (e instanceof Error ? e.message : String(e)))
  }
  const pickServer = (obj: Record<string, unknown>): ParsedServerConfig & { name?: string } => {
    const url = typeof obj.url === "string" ? obj.url : undefined
    const headers = obj.headers && typeof obj.headers === "object" && !Array.isArray(obj.headers)
      ? Object.fromEntries(
          Object.entries(obj.headers as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string" || typeof v === "number")
            .map(([k, v]) => [String(k), String(v)]),
        )
      : undefined
    let token: string | undefined
    if (headers) {
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === "authorization") {
          const v = headers[k]
          if (v.toLowerCase().startsWith("bearer ")) token = v.slice(7).trim()
        }
      }
    }
    const description = typeof obj.description === "string" ? obj.description : undefined
    const display_name = typeof (obj as Record<string, unknown>).display_name === "string"
      ? (obj as Record<string, unknown>).display_name as string
      : undefined
    return { url, token, headers, description, display_name }
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object") {
        return pickServer(item as Record<string, unknown>)
      }
    }
    throw new Error("配置数组里没找到有效服务")
  }
  if (data && typeof data === "object") {
    const root = data as Record<string, unknown>
    const mcpServers = root.mcpServers
    if (mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers)) {
      for (const [name, val] of Object.entries(mcpServers as Record<string, unknown>)) {
        if (val && typeof val === "object") {
          return { name, ...pickServer(val as Record<string, unknown>) }
        }
      }
    }
    const servers = root.servers
    if (servers && typeof servers === "object" && !Array.isArray(servers)) {
      for (const [name, val] of Object.entries(servers as Record<string, unknown>)) {
        if (val && typeof val === "object") {
          return { name, ...pickServer(val as Record<string, unknown>) }
        }
      }
    }
    // 单条服务对象（带 url 即视为服务配置）。
    if (typeof root.url === "string") {
      return pickServer(root)
    }
  }
  // 兜底：用 fallbackName 提示无法识别。
  void fallbackName
  throw new Error("无法识别的 mcp server 配置：未找到 mcpServers/url 字段")
}

export default function McpPage() {
  const [services, setServices] = useState<MyMcpService[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [githubOpen, setGithubOpen] = useState(false)
  const [editing, setEditing] = useState<MyMcpService | null>(null)
  const [form, setForm] = useState<EditorForm>(EMPTY_FORM)
  const [mode, setMode] = useState<EditorMode>("form")
  const [saving, setSaving] = useState(false)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [principals, setPrincipals] = useState<McpPrincipal[]>([])
  // MCP 用户管理统一弹框（列表 + CRUD + 配置权限 + Agent 详情）。
  const [principalManageOpen, setPrincipalManageOpen] = useState(false)

  /** 通用授权编辑器注入的用户侧 API 适配器。 */
  const principalPermissionApi: PermissionEditorApi = {
    loadResources: async () => {
      const opts = await listMcpAuthorizationOptions()
      return { resources: opts.resources || [], param_kinds: opts.param_kinds || [] }
    },
    loadGrants: async (id: number) => (await listMcpPrincipalGrants(id)).grants,
    saveGrants: async (id: number, grants) => (await replaceMcpPrincipalGrants(id, grants)).grants,
  }

  /** MCP 用户管理弹框注入的用户侧 API 适配器。 */
  const userManagerApi: McpUserManagerApi = {
    list: async () => (await listMcpPrincipals()).principals,
    create: (payload) => createMcpPrincipal({ name: payload.name, description: payload.description, enabled: payload.enabled, usage_type: payload.usage_type }),
    update: (id, payload) => updateMcpPrincipal(id, payload),
    remove: (id) => deleteMcpPrincipal(id).then(() => undefined),
    rotate: (id) => rotateMcpPrincipalToken(id),
    permission: principalPermissionApi,
  }

  const reloadPrincipals = useCallback(async () => {
    try {
      setPrincipals((await listMcpPrincipals()).principals)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载 MCP 用户失败")
    }
  }, [])

  /** 打开「管理 MCP 用户」统一弹框。 */
  const openPrincipalManage = () => {
    void reloadPrincipals()
    setPrincipalManageOpen(true)
  }

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setServices(await listMyMcpServices())
      await reloadPrincipals()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [reloadPrincipals])

  useEffect(() => {
    void reload()
  }, [reload])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setMode("form")
    setDialogOpen(true)
  }

  const handleGithubCreate = async (p: McpGithubImportPayload) => {
    if (p.transport !== "streamable-http" || !p.url) {
      throw new Error("用户侧仅支持 SSE/HTTP MCP，请到管理端注册 stdio")
    }
    await createMyMcpService({
      name: p.name,
      display_name: p.display_name || undefined,
      description: p.description || undefined,
      url: p.url,
      enabled: true,
    })
    await reload()
    toast.success(`已从 GitHub 识别并创建 MCP「${p.name}」`)
  }

  const openEdit = (svc: MyMcpService) => {
    setEditing(svc)
    setForm({
      name: svc.name,
      displayName: svc.display_name,
      description: svc.description,
      url: svc.url,
      token: "",
      headersText: serializeJsonObject(svc.headers || {}),
      enabled: svc.enabled,
      configText: "",
    })
    setMode("form")
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("请填写服务名称")
      return
    }
    let url = form.url.trim()
    let token = form.token.trim()
    let headers: Record<string, string>
    let description = form.description
    let displayName = form.displayName.trim() || undefined

    if (mode === "json") {
      if (!form.configText.trim()) {
        toast.error("请粘贴 mcp server 配置")
        return
      }
      let parsed: ReturnType<typeof parseServerConfig>
      try {
        parsed = parseServerConfig(form.configText, form.name.trim())
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "配置解析失败")
        return
      }
      if (!parsed.url) {
        toast.error("配置里没有有效的 url（用户侧仅支持 SSE/HTTP MCP）")
        return
      }
      url = parsed.url
      headers = parsed.headers || {}
      if (parsed.display_name) displayName = parsed.display_name
      if (parsed.description) description = parsed.description
      if (parsed.token) token = parsed.token
    } else {
      try {
        headers = parseHeadersJson(form.headersText)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Headers 解析失败")
        return
      }
    }

    if (!url) {
      toast.error("请填写 SSE URL")
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const payload: Parameters<typeof updateMyMcpService>[1] = {
          display_name: displayName,
          description,
          url,
          enabled: form.enabled,
          headers,
        }
        if (token) payload.token = token
        await updateMyMcpService(editing.id, payload)
        toast.success("已保存")
      } else {
        const payload: CreateMyMcpPayload = {
          name: form.name.trim(),
          display_name: displayName,
          description,
          url,
          token,
          headers,
          enabled: form.enabled,
        }
        await createMyMcpService(payload)
        toast.success("已创建")
      }
      setDialogOpen(false)
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async (svc: MyMcpService) => {
    setSyncingId(svc.id)
    try {
      const res = await syncMyMcpService(svc.id)
      if (res.ok) {
        toast.success(`已同步，共 ${res.tool_count} 个工具`)
      } else {
        toast.error(res.error || "同步失败")
      }
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "同步失败")
    } finally {
      setSyncingId(null)
    }
  }

  const handleDelete = async (svc: MyMcpService) => {
    setDeletingId(svc.id)
    try {
      await deleteMyMcpService(svc.id)
      toast.success("已删除")
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败")
    } finally {
      setDeletingId(null)
    }
  }

  const handleToggleEnabled = async (svc: MyMcpService, enabled: boolean) => {
    setTogglingId(svc.id)
    try {
      await updateMyMcpService(svc.id, { enabled })
      setServices((prev) =>
        prev.map((s) => (s.id === svc.id ? { ...s, enabled } : s)),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败")
    } finally {
      setTogglingId(null)
    }
  }

  /** MCP 用户胶囊条：仅作预览，所有管理操作在「管理 MCP 用户」弹框内完成。 */
  const principalStrip = principals.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {principals.map((principal) => (
        <div key={principal.id} className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs">
          <span className="font-medium">{principal.name}</span>
          <Badge variant={principal.enabled && principal.token_status === "active" ? "secondary" : "outline"}>
            {principal.enabled && principal.token_status === "active" ? "启用" : "停用"}
          </Badge>
        </div>
      ))}
    </div>
  )

  const mcpDialogs = (
    <McpUserManagerDialog
      open={principalManageOpen}
      onClose={() => setPrincipalManageOpen(false)}
      api={userManagerApi}
      onOpenAgent={(principalId) => {
        void getAgentByMcpUser(principalId).then((r) => {
          if (r.agent_id != null) window.location.href = `/console/agents?agentId=${r.agent_id}`
          else toast.error("该 principal 未绑定 Agent")
        }).catch((e) => toast.error(e instanceof Error ? e.message : "反查 Agent 失败"))
      }}
    />
  )

  /** 「MCP」顶层 Tab：个人 MCP 服务列表 + MCP 用户授权。 */
  const mcpSection = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Blocks className="size-4" />
            个人 MCP 服务（{services.length}）
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            自配外部 SSE MCP；Agent 通过「MCP 用户」引用你的授权，不与 MCP 权限混为一体。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" variant="outline" onClick={openPrincipalManage}>
            <Plus className="size-4" />
            管理 MCP 用户
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setGithubOpen(true)}>
            GitHub 识别
          </Button>
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            新增
          </Button>
        </div>
      </div>
      {principalStrip}
      <div className="flex flex-col gap-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> 加载中...
          </div>
        ) : services.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            暂无 MCP 服务，点右上角「新增」配置你的第一个外部 MCP。
          </div>
        ) : (
          services.map((svc) => (
            <div
              key={svc.id}
              className="rounded-lg border bg-card p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    <ServerCog className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">
                        {svc.display_name || svc.name}
                      </span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {svc.tool_count} 工具
                      </Badge>
                      {svc.runtime_status === "error" && (
                        <Badge variant="destructive" className="text-[10px]">
                          异常
                        </Badge>
                      )}
                      {svc.runtime_status === "loaded" && (
                        <Badge variant="secondary" className="text-[10px]">
                          已加载
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 break-all text-xs text-muted-foreground">
                      {svc.url}
                    </div>
                    {svc.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {svc.description}
                      </p>
                    )}
                    {svc.runtime_last_error && (
                      <p className="mt-1 line-clamp-2 text-xs text-destructive">
                        {svc.runtime_last_error}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    {togglingId === svc.id && (
                      <Spinner className="size-3.5 text-muted-foreground" />
                    )}
                    <Switch
                      checked={svc.enabled}
                      disabled={togglingId === svc.id}
                      onCheckedChange={(v) => handleToggleEnabled(svc, v)}
                      aria-label="启用/停用"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSync(svc)}
                    disabled={syncingId === svc.id}
                  >
                    {syncingId === svc.id ? (
                      <>
                        <Spinner className="size-3.5" />
                        同步中
                      </>
                    ) : (
                      <>
                        <RefreshCw className="size-3.5" />
                        同步
                      </>
                    )}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm">
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => openEdit(svc)}
                        disabled={syncingId === svc.id || deletingId === svc.id}
                      >
                        <IconPencil />
                        编辑
                      </DropdownMenuItem>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem
                            className="text-destructive"
                            onSelect={(e) => e.preventDefault()}
                            disabled={syncingId === svc.id || deletingId === svc.id}
                          >
                            <IconTrash />
                            {deletingId === svc.id ? "删除中" : "删除"}
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>删除 MCP 服务</AlertDialogTitle>
                            <AlertDialogDescription>
                              确定删除「{svc.display_name || svc.name}」？该操作不可撤销。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={deletingId === svc.id}>
                              取消
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(svc)}
                              disabled={deletingId === svc.id}
                            >
                              删除
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {svc.tools.length > 0 && (
                <div className="mt-3 space-y-1 border-t pt-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    工具列表
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {svc.tools.map((t) => (
                      <Badge
                        key={t.name}
                        variant="secondary"
                        className="font-mono text-[11px]"
                        title={t.description}
                      >
                        {t.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <ResourceCenterShell
        defaultTab="mcp"
        tabs={[
          { value: "mcp", label: "MCP", content: mcpSection },
          {
            value: "skills",
            label: "Skill",
            content: (
              <ResourceMarketPanel
                userMode
                forcedView="local"
                noun="Skill"
                icon={Sparkles}
                fetchLocal={fetchManagedSkillListing}
                module="skills"
                resourceType="skill"
                manifestToSpec={manifestToSkillSpec}
                specLabel="SkillSpec"
                localCrud={{ importUpload: importSkillUpload, importUrl: importSkillUrl, update: updateSkillResource, remove: deleteSkillResource }}
              />
            ),
          },
          {
            value: "plugins",
            label: "插件",
            content: (
              <ResourceMarketPanel
                userMode
                forcedView="local"
                noun="插件"
                icon={Package}
                fetchLocal={fetchManagedPluginListing}
                module="plugins"
                resourceType="plugin"
                manifestToSpec={manifestToPluginSpec}
                specLabel="NodePluginSpec"
                localCrud={{ importUpload: importPluginUpload, importUrl: importPluginUrl, update: updatePluginResource, remove: deletePluginResource }}
              />
            ),
          },
          { value: "prompts", label: "项目提示词", content: <PromptResourcePanel userMode forcedView="local" /> },
          { value: "market", label: "市场", content: <ResourceMarketBoard userMode /> },
        ]}
      />
      {mcpDialogs}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-4 overflow-hidden p-0 sm:max-w-[760px]">
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle>
              {editing ? "编辑 MCP 服务" : "新增 MCP 服务"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-2">
            {/* 顶部：名称 / 显示名 / 启用 —— 这三项始终由本页配置，不接受配置覆盖 */}
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel>名称</FieldLabel>
                <FieldContent>
                  <Input
                    placeholder="my-mcp"
                    value={form.name}
                    disabled={!!editing}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                  {editing && (
                    <p className="text-xs text-muted-foreground">名称创建后不可修改。</p>
                  )}
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel>显示名</FieldLabel>
                <FieldContent>
                  <Input
                    placeholder="可选，缺省同名称"
                    value={form.displayName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, displayName: e.target.value }))
                    }
                  />
                </FieldContent>
              </Field>
            </div>
            <Field>
              <FieldLabel>描述</FieldLabel>
              <FieldContent>
                <Textarea
                  className="min-h-16"
                  placeholder="可选"
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </FieldContent>
            </Field>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label>启用</Label>
                <p className="text-xs text-muted-foreground">
                  停用后该服务不会被 runtime 加载，也无法挂载到 Agent。
                </p>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              />
            </div>

            <Tabs value={mode} onValueChange={(v) => setMode(v as EditorMode)}>
              <TabsList className="w-full">
                <TabsTrigger value="form" className="flex-1">表单填写</TabsTrigger>
                <TabsTrigger value="json" className="flex-1">粘贴 MCP 配置</TabsTrigger>
              </TabsList>
              <TabsContent value="form" className="mt-4 flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel>SSE URL</FieldLabel>
                    <FieldContent>
                      <Input
                        placeholder="https://example.com/sse"
                        value={form.url}
                        onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                      />
                      <p className="text-xs text-muted-foreground">
                        完整 SSE 入口地址，可带查询串。
                      </p>
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel>Token</FieldLabel>
                    <FieldContent>
                      <Input
                        type="password"
                        placeholder={
                          editing ? "留空不修改（已脱敏存储）" : "Authorization: Bearer <token>"
                        }
                        value={form.token}
                        onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
                      />
                      <p className="text-xs text-muted-foreground">
                        统一以 Authorization: Bearer 发往上游；无鉴权可留空。
                      </p>
                    </FieldContent>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel>自定义 Headers（JSON）</FieldLabel>
                    <FieldContent>
                      <Textarea
                        className="min-h-24 font-mono text-xs"
                        placeholder={'{\n  "X-Api-Key": "your-key",\n  "X-Signature": "sign-value"\n}'}
                        value={form.headersText}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, headersText: e.target.value }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        JSON 对象，用于网关签名头等。Authorization 由 Token 承载，无需重复填写；编辑时敏感值留空 = 保留。
                      </p>
                    </FieldContent>
                  </Field>
                </div>
              </TabsContent>
              <TabsContent value="json" className="mt-4 flex flex-col gap-4">
                <Field>
                  <FieldLabel>MCP Server 配置（JSON）</FieldLabel>
                  <FieldContent>
                    <Textarea
                      className="min-h-[220px] font-mono text-xs"
                      placeholder={
'{\n'
 + '  "mcpServers": {\n'
 + '    "my-server": {\n'
 + '      "url": "https://example.com/sse",\n'
 + '      "headers": { "Authorization": "Bearer xxx", "X-Api-Key": "yyy" }\n'
 + '    }\n'
 + '  }\n'
 + '}'
                      }
                      value={form.configText}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, configText: e.target.value }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      粘贴 Claude Desktop / Cursor 的 ``mcpServers`` 配置或单条服务对象。识别 ``url``、``headers``（含 Authorization→Token）、``description``；名称与启用状态以上方为准。用户侧仅支持 SSE/HTTP MCP。
                    </p>
                  </FieldContent>
                </Field>
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter className="shrink-0 border-t bg-popover px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              取消
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={saving}>
              {saving ? "保存中..." : editing ? "保存" : "新增"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <McpGithubImportDialog
        userMode
        open={githubOpen}
        onOpenChange={setGithubOpen}
        onConfirm={handleGithubCreate}
      />
    </div>
  )
}
