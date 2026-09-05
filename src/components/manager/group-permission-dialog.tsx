/**
 * 分组权限配置弹窗：一个分组对四类资源的授权统一在这里。
 *
 * - API Key：系统 Key
 * - MCP：内部 MCP 服务（不是对外 MCP User/token）
 * - 管理节点：按节点列表同款父子表展示
 * - Skills：团队技能
 *
 * 取消 / 保存是弹窗外层按钮；各 tab 只负责勾选，保存时按当前 tab 提交。
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  machineInfoLine,
  machineSpecsLine,
  nodeEditors,
  ROLE_LABEL,
  STATUS_META,
} from "@/pages/manager/platform/nodes/types"
import { apiRequest } from "@/utils/requestUtils"
import {
  listGroupResources,
  listResourceReferences,
  setGroupResources,
  type ResourceReference,
  type ResourceType,
} from "@/api/resourceReferences"

interface GroupPermissionDialogProps {
  group: { id: string; name: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface GroupApiKeyRow {
  id: number
  name: string
  key_masked: string
  disabled: boolean
  bound: boolean
}

interface McpServiceRow {
  id: number
  name: string
  display_name?: string
  description?: string
  transport?: string
  kind?: string
  expose?: string
  enabled: boolean
  builtin?: boolean
  runtime_status?: string
  runtime_restarts?: number
  bound: boolean
}

interface NodeCandidateRow {
  node_id: string
  node_name: string
  role?: string
  node_role?: string
  status: string
  connected: boolean
  is_passive?: boolean
  manager_node_id?: string
  last_heartbeat_at?: string
  capabilities?: Record<string, string>
  bound: boolean
}

type TabKey = "api-keys" | "mcp" | "nodes" | "skills" | "plugins" | "prompts"

export function GroupPermissionDialog({
  group,
  open,
  onOpenChange,
}: GroupPermissionDialogProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("api-keys")
  const [saving, setSaving] = useState(false)

  const [apiKeys, setApiKeys] = useState<GroupApiKeyRow[]>([])
  const [selectedKeyIds, setSelectedKeyIds] = useState<Set<number>>(new Set())
  const [apiLoading, setApiLoading] = useState(false)

  const [mcpServices, setMcpServices] = useState<McpServiceRow[]>([])
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<number>>(new Set())
  const [mcpLoading, setMcpLoading] = useState(false)

  const [nodes, setNodes] = useState<NodeCandidateRow[]>([])
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
  const [nodesLoading, setNodesLoading] = useState(false)

  const [skills, setSkills] = useState<ResourceReference[]>([])
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set())
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [plugins, setPlugins] = useState<ResourceReference[]>([])
  const [selectedPluginIds, setSelectedPluginIds] = useState<Set<string>>(new Set())
  const [pluginsLoading, setPluginsLoading] = useState(false)
  const [prompts, setPrompts] = useState<ResourceReference[]>([])
  const [selectedPromptIds, setSelectedPromptIds] = useState<Set<string>>(new Set())
  const [promptsLoading, setPromptsLoading] = useState(false)

  const groupId = group?.id || ""

  useEffect(() => {
    if (!open) {
      setActiveTab("api-keys")
      return
    }
    if (!groupId) return
    void loadApiKeys(groupId)
    void loadMcpServices(groupId)
    void loadNodes(groupId)
    void loadSkills(groupId)
    void loadReferenceResources(groupId, "plugin")
    void loadReferenceResources(groupId, "project_prompt")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groupId])

  const loadApiKeys = async (gid: string) => {
    setApiLoading(true)
    await apiRequest("v1TeamsGroupsApiKeysList", {}, [gid], (resp) => {
      if (resp.code === 0) {
        const list: GroupApiKeyRow[] = resp.data?.keys || []
        setApiKeys(list)
        setSelectedKeyIds(new Set(list.filter((k) => k.bound).map((k) => k.id)))
      } else {
        toast.error(resp.message || "获取 API Key 列表失败")
      }
    })
    setApiLoading(false)
  }

  const loadMcpServices = async (gid: string) => {
    setMcpLoading(true)
    await apiRequest("v1TeamsGroupsMcpServicesList", {}, [gid], (resp) => {
      if (resp.code === 0) {
        const list: McpServiceRow[] = resp.data?.services || []
        setMcpServices(list)
        setSelectedServiceIds(new Set(list.filter((s) => s.bound).map((s) => s.id)))
      } else {
        toast.error(resp.message || "获取 MCP 服务列表失败（若刚改过接口，请重启后端）")
      }
    })
    setMcpLoading(false)
  }

  const loadNodes = async (gid: string) => {
    setNodesLoading(true)
    await apiRequest("v1TeamsGroupsNodePickerList", {}, [gid], (resp) => {
      if (resp.code === 0) {
        const list: NodeCandidateRow[] = resp.data?.nodes || []
        setNodes(list)
        setSelectedNodeIds(new Set(list.filter((n) => n.bound).map((n) => n.node_id)))
      } else {
        toast.error(resp.message || "获取节点列表失败")
      }
    })
    setNodesLoading(false)
  }

  const loadSkills = async (gid: string) => {
    setSkillsLoading(true)
    try {
      const [available, selected] = await Promise.all([
        listResourceReferences("skill"),
        listGroupResources(gid, "skill"),
      ])
      setSkills(available)
      setSelectedSkillIds(new Set(selected.map((item) => item.id)))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "获取技能列表失败")
    } finally {
      setSkillsLoading(false)
    }
  }

  const loadReferenceResources = async (gid: string, type: "plugin" | "project_prompt") => {
    const setLoading = type === "plugin" ? setPluginsLoading : setPromptsLoading
    setLoading(true)
    try {
      const [available, selected] = await Promise.all([
        listResourceReferences(type),
        listGroupResources(gid, type),
      ])
      if (type === "plugin") {
        setPlugins(available)
        setSelectedPluginIds(new Set(selected.map((item) => item.id)))
      } else {
        setPrompts(available)
        setSelectedPromptIds(new Set(selected.map((item) => item.id)))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "获取资源列表失败")
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => onOpenChange(false)

  const handleSave = async () => {
    if (!groupId) return
    setSaving(true)
    try {
      if (activeTab === "api-keys") {
      await apiRequest(
        "v1TeamsGroupsApiKeysUpdate",
        { key_ids: Array.from(selectedKeyIds) },
        [groupId],
        (resp) => {
          if (resp.code === 0) {
            toast.success("分组可用的 API Key 已更新")
            void loadApiKeys(groupId)
          } else {
            toast.error(resp.message || "更新分组 API Key 失败")
          }
        },
      )
    } else if (activeTab === "mcp") {
      await apiRequest(
        "v1TeamsGroupsMcpServicesUpdate",
        { service_ids: Array.from(selectedServiceIds) },
        [groupId],
        (resp) => {
          if (resp.code === 0) {
            toast.success("分组可用的 MCP 服务已更新")
            void loadMcpServices(groupId)
          } else {
            toast.error(resp.message || "更新分组 MCP 服务失败（若刚改过接口，请重启后端）")
          }
        },
      )
    } else if (activeTab === "skills") {
      try {
        await setGroupResources(groupId, "skill", Array.from(selectedSkillIds))
        toast.success("分组可用的 Skills 已更新")
        await loadSkills(groupId)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "更新分组 Skills 失败")
      }
    } else if (activeTab === "plugins" || activeTab === "prompts") {
      const type: ResourceType = activeTab === "plugins" ? "plugin" : "project_prompt"
      const selected = activeTab === "plugins" ? selectedPluginIds : selectedPromptIds
      try {
        await setGroupResources(groupId, type, Array.from(selected))
        toast.success(activeTab === "plugins" ? "分组可用的插件已更新" : "分组可用的项目提示词已更新")
        await loadReferenceResources(groupId, type)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "更新分组资源失败")
      }
    } else if (activeTab === "nodes") {
      const bound = new Set(nodes.filter((n) => n.bound).map((n) => n.node_id))
      const next = selectedNodeIds
      const toBind = Array.from(next).filter((id) => !bound.has(id))
      const toUnbind = Array.from(bound).filter((id) => !next.has(id))
      let failed = 0
      for (const nodeId of toBind) {
        await apiRequest("v1TeamsGroupsNodesBind", { node_id: nodeId }, [groupId], (resp) => {
          if (resp.code !== 0) failed += 1
        })
      }
      for (const nodeId of toUnbind) {
        await apiRequest("v1TeamsGroupsNodesUnbind", {}, [groupId, nodeId], (resp) => {
          if (resp.code !== 0) failed += 1
        })
      }
      if (failed === 0) {
        toast.success("分组节点权限已更新")
        void loadNodes(groupId)
      } else {
        toast.error(`有 ${failed} 个节点绑定更新失败`)
        void loadNodes(groupId)
      }
    }
    } finally {
      setSaving(false)
    }
  }

  const tabLoading =
    (activeTab === "api-keys" && apiLoading) ||
    (activeTab === "mcp" && mcpLoading) ||
    (activeTab === "nodes" && nodesLoading) ||
    (activeTab === "skills" && skillsLoading) ||
    (activeTab === "plugins" && pluginsLoading) ||
    (activeTab === "prompts" && promptsLoading)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[min(96vw,1100px)] max-w-[min(96vw,1100px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1100px)]">
        <div className="border-b px-6 py-4">
          <DialogHeader>
            <DialogTitle>权限配置 · {group?.name || ""}</DialogTitle>
            <DialogDescription>
              勾选该分组可用的资源。取消 / 保存在弹窗底部；当前只提交正在查看的标签页。
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-6 pt-4">
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as TabKey)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="grid w-full shrink-0 grid-cols-6">
              <TabsTrigger value="api-keys">API Key</TabsTrigger>
              <TabsTrigger value="mcp">MCP</TabsTrigger>
              <TabsTrigger value="nodes">管理节点</TabsTrigger>
              <TabsTrigger value="skills">Skills</TabsTrigger>
              <TabsTrigger value="plugins">插件</TabsTrigger>
              <TabsTrigger value="prompts">提示词</TabsTrigger>
            </TabsList>

            <TabsContent value="api-keys" className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden">
              <ApiKeyPanel
                loading={apiLoading}
                rows={apiKeys}
                selected={selectedKeyIds}
                onToggle={(id, checked) =>
                  setSelectedKeyIds((prev) => toggleSet(prev, id, checked))
                }
              />
            </TabsContent>
            <TabsContent value="mcp" className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden">
              <McpPanel
                loading={mcpLoading}
                rows={mcpServices}
                selected={selectedServiceIds}
                onToggle={(id, checked) =>
                  setSelectedServiceIds((prev) => toggleSet(prev, id, checked))
                }
              />
            </TabsContent>
            <TabsContent value="nodes" className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden">
              <NodesPanel
                loading={nodesLoading}
                rows={nodes}
                selected={selectedNodeIds}
                onToggle={(id, checked) =>
                  setSelectedNodeIds((prev) => toggleSet(prev, id, checked))
                }
              />
            </TabsContent>
            <TabsContent value="skills" className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden">
              <SkillsPanel
                loading={skillsLoading}
                rows={skills}
                selected={selectedSkillIds}
                onToggle={(id, checked) =>
                  setSelectedSkillIds((prev) => toggleSet(prev, id, checked))
                }
              />
            </TabsContent>
            <TabsContent value="plugins" className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden">
              <ReferencedResourcePanel
                noun="插件"
                loading={pluginsLoading}
                rows={plugins}
                selected={selectedPluginIds}
                onToggle={(id, checked) => setSelectedPluginIds((prev) => toggleSet(prev, id, checked))}
              />
            </TabsContent>
            <TabsContent value="prompts" className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden">
              <ReferencedResourcePanel
                noun="项目提示词"
                loading={promptsLoading}
                rows={prompts}
                selected={selectedPromptIds}
                onToggle={(id, checked) => setSelectedPromptIds((prev) => toggleSet(prev, id, checked))}
              />
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || tabLoading}>
            {saving && <Spinner className="mr-2 size-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function toggleSet<T>(prev: Set<T>, id: T, checked: boolean): Set<T> {
  const next = new Set(prev)
  if (checked) next.add(id)
  else next.delete(id)
  return next
}

function LoadingBlock() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="size-6" />
    </div>
  )
}

function EmptyBlock({ text }: { text: string }) {
  return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">{text}</div>
}

function ResourceRow({
  checked,
  disabled,
  onToggle,
  title,
  meta,
  badges,
  detail,
}: {
  checked: boolean
  disabled?: boolean
  onToggle: (next: boolean) => void
  title: string
  meta?: string
  badges?: ReactNode
  detail?: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 hover:bg-accent">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onToggle(next === true)}
        className="mt-1"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          {badges}
        </div>
        {meta ? <div className="mt-0.5 text-xs text-muted-foreground">{meta}</div> : null}
        {detail}
      </div>
    </label>
  )
}

function ApiKeyPanel({
  loading,
  rows,
  selected,
  onToggle,
}: {
  loading: boolean
  rows: GroupApiKeyRow[]
  selected: Set<number>
  onToggle: (id: number, checked: boolean) => void
}) {
  if (loading) return <LoadingBlock />
  if (rows.length === 0) return <EmptyBlock text="暂无系统 Key 可选。" />
  return (
    <ScrollArea className="h-[min(52vh,520px)] rounded-md border">
      <div className="divide-y">
        {rows.map((k) => (
          <ResourceRow
            key={k.id}
            checked={selected.has(k.id)}
            disabled={k.disabled}
            onToggle={(checked) => onToggle(k.id, checked)}
            title={k.name || `Key #${k.id}`}
            meta={`ID ${k.id} · ${k.key_masked}`}
            badges={
              k.disabled ? (
                <Badge variant="outline">已停用</Badge>
              ) : (
                <Badge variant="outline" className="text-green-600 dark:text-green-400">
                  可用
                </Badge>
              )
            }
            detail={
              <div className="mt-1 text-xs text-muted-foreground">
                系统 API Key · 组内成员可直接使用该 Key 的模型路由与限流策略
              </div>
            }
          />
        ))}
      </div>
    </ScrollArea>
  )
}

function McpPanel({
  loading,
  rows,
  selected,
  onToggle,
}: {
  loading: boolean
  rows: McpServiceRow[]
  selected: Set<number>
  onToggle: (id: number, checked: boolean) => void
}) {
  if (loading) return <LoadingBlock />
  if (rows.length === 0) {
    return (
      <EmptyBlock text="暂无内部 MCP 服务。若刚改过接口仍为空，请先重启后端后再试。" />
    )
  }
  return (
    <ScrollArea className="h-[min(52vh,520px)] rounded-md border">
      <div className="divide-y">
        {rows.map((service) => (
          <ResourceRow
            key={service.id}
            checked={selected.has(service.id)}
            onToggle={(checked) => onToggle(service.id, checked)}
            title={service.display_name || service.name}
            meta={`${service.name} · ${service.transport || service.kind || "mcp"} · ${service.runtime_status || "未运行"}`}
            badges={
              <>
                {service.builtin ? <Badge variant="outline">内置</Badge> : null}
                {!service.enabled ? <Badge variant="outline">已停用</Badge> : null}
                {service.expose ? <Badge variant="secondary">{service.expose}</Badge> : null}
              </>
            }
            detail={
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {service.description || "无描述"}
                {service.runtime_restarts ? ` · 重启 ${service.runtime_restarts} 次` : ""}
              </div>
            }
          />
        ))}
      </div>
    </ScrollArea>
  )
}

function SkillsPanel({
  loading,
  rows,
  selected,
  onToggle,
}: {
  loading: boolean
  rows: ResourceReference[]
  selected: Set<string>
  onToggle: (id: string, checked: boolean) => void
}) {
  return <ReferencedResourcePanel noun="Skill" loading={loading} rows={rows} selected={selected} onToggle={onToggle} />
}

function ReferencedResourcePanel({
  noun,
  loading,
  rows,
  selected,
  onToggle,
}: {
  noun: string
  loading: boolean
  rows: ResourceReference[]
  selected: Set<string>
  onToggle: (id: string, checked: boolean) => void
}) {
  if (loading) return <LoadingBlock />
  if (rows.length === 0) {
    return <EmptyBlock text={`暂无可分配的${noun}。请先在「资源」页引用市场资源。`} />
  }
  return (
    <ScrollArea className="h-[min(52vh,520px)] rounded-md border">
      <div className="divide-y">
        {rows.map((resource) => (
          <ResourceRow
            key={resource.id}
            checked={selected.has(resource.id)}
            onToggle={(checked) => onToggle(resource.id, checked)}
            title={resource.display_name || resource.name}
            meta={`${resource.market_module} · ${resource.version || "latest"} · ${resource.market_id}`}
            badges={<Badge variant="secondary">已引用</Badge>}
            detail={
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {String((resource.manifest as { summary?: string }).summary || "无描述")}
              </div>
            }
          />
        ))}
      </div>
    </ScrollArea>
  )
}

function nodeRole(node: NodeCandidateRow): string {
  return node.role || node.node_role || ""
}

function isManagement(node: NodeCandidateRow): boolean {
  const role = nodeRole(node)
  return role === "management" || role === "passive_management"
}

function isExecution(node: NodeCandidateRow): boolean {
  return nodeRole(node) === "execution"
}

/** 与节点管理页 renderNodeCell 同款：名称 + 角色徽标 + 机器信息/规格/编辑器。 */
function PermissionNodeCell({
  node,
  kindLabel,
  badgeClass,
  subTag,
}: {
  node: NodeCandidateRow
  kindLabel: string
  badgeClass: string
  subTag?: { label: string; className: string }
}) {
  const caps = node.capabilities
  const isContainer = Boolean(node.is_passive)
  const showSpecs = !isContainer
  const infoLine = machineInfoLine(caps)
  const specsLine = showSpecs ? machineSpecsLine(caps) : ""
  const editors = showSpecs ? nodeEditors(caps) : []
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{node.node_name || node.node_id}</span>
        <Badge variant="outline" className={badgeClass}>
          {kindLabel}
        </Badge>
        {subTag ? (
          <Badge variant="secondary" className={subTag.className}>
            {subTag.label}
          </Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {infoLine ? (
          <span>{infoLine}</span>
        ) : (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{node.node_id}</code>
        )}
      </div>
      {specsLine ? <div className="text-xs text-muted-foreground">{specsLine}</div> : null}
      {editors.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {editors.map((editor) => (
            <Badge key={editor} variant="secondary" className="text-[11px]">
              {editor}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 与节点管理页 renderClientStatus 同款：审批通过后只显示在线/离线。 */
function PermissionNodeStatus({ node }: { node: NodeCandidateRow }) {
  if (node.is_passive) {
    return <span className="text-xs text-muted-foreground">即用 · 无需安装</span>
  }
  if (node.status === "approved") {
    return (
      <Badge
        variant={node.connected ? "outline" : "secondary"}
        className={node.connected ? "text-green-600 dark:text-green-400" : ""}
      >
        {node.connected ? "在线" : "离线"}
      </Badge>
    )
  }
  const meta = STATUS_META[node.status] || STATUS_META.unknown
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  )
}

function NodesPanel({
  loading,
  rows,
  selected,
  onToggle,
}: {
  loading: boolean
  rows: NodeCandidateRow[]
  selected: Set<string>
  onToggle: (id: string, checked: boolean) => void
}) {
  // 与节点管理页 nodeGroups 同款：管理节点父行 + 执行节点子行 + 未受管组。
  const nodeGroups = useMemo(() => {
    const managers = rows.filter(isManagement)
    const executions = rows.filter(isExecution)
    const childrenByManager = new Map<string, NodeCandidateRow[]>()
    for (const exe of executions) {
      const key = exe.manager_node_id || ""
      const list = childrenByManager.get(key) || []
      list.push(exe)
      childrenByManager.set(key, list)
    }
    const managerIds = new Set(managers.map((m) => m.node_id))
    const result: { key: string; manager: NodeCandidateRow | null; children: NodeCandidateRow[] }[] =
      managers.map((manager) => ({
        key: manager.node_id,
        manager,
        children: childrenByManager.get(manager.node_id) || [],
      }))
    const orphans = executions.filter(
      (e) => !e.manager_node_id || !managerIds.has(e.manager_node_id),
    )
    if (orphans.length > 0) {
      result.push({ key: "__unmanaged__", manager: null, children: orphans })
    }
    return result
  }, [rows])

  if (loading) return <LoadingBlock />
  if (rows.length === 0) {
    return <EmptyBlock text="暂无可选节点。请在管理端「节点」页先 onboard 并审批。" />
  }

  return (
    <ScrollArea className="h-[min(52vh,520px)] rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[48px]" />
            <TableHead>节点</TableHead>
            <TableHead className="w-[140px]">状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodeGroups.map((grp) => {
            const manager = grp.manager
            const container = Boolean(manager?.is_passive)
            // 勾选了管理节点 → 其下执行子节点默认随之被授权（服务端派生权限），
            // 前端把子节点展示为已勾选且不可编辑，避免误以为需要逐个勾。
            const managerSelected = manager ? selected.has(manager.node_id) : false
            return (
              <Fragment key={grp.key}>
                {/* 父行：管理节点（分组容器 / 管理客户端）或未受管合成组。 */}
                <TableRow className="bg-muted/40">
                  <TableCell className="align-top">
                    {manager ? (
                      <Checkbox
                        checked={selected.has(manager.node_id)}
                        onCheckedChange={(next) => onToggle(manager.node_id, next === true)}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top">
                    {manager ? (
                      <PermissionNodeCell
                        node={manager}
                        kindLabel="管理节点"
                        badgeClass="text-purple-600 dark:text-purple-400"
                        subTag={
                          container
                            ? { label: "不可管理", className: "text-slate-600 dark:text-slate-300" }
                            : { label: "可管理", className: "text-emerald-600 dark:text-emerald-400" }
                        }
                      />
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-muted-foreground">未受管 / 直连</span>
                        <span className="text-xs text-muted-foreground">
                          未归属任何管理节点的执行节点
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    {manager ? <PermissionNodeStatus node={manager} /> : null}
                  </TableCell>
                </TableRow>

                {/* 子行：该管理节点下的执行节点。 */}
                {grp.children.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-2 pl-10 text-xs text-muted-foreground">
                      {manager
                        ? "该管理节点下暂无执行节点。"
                        : "无未受管执行节点。"}
                    </TableCell>
                  </TableRow>
                ) : (
                  grp.children.map((child) => (
                    <TableRow key={child.node_id}>
                      <TableCell className="align-top pl-4">
                        <Checkbox
                          checked={managerSelected || selected.has(child.node_id)}
                          disabled={managerSelected}
                          onCheckedChange={(next) => onToggle(child.node_id, next === true)}
                        />
                      </TableCell>
                      <TableCell className="align-top pl-10">
                        <PermissionNodeCell
                          node={child}
                          kindLabel={ROLE_LABEL.execution}
                          badgeClass="text-blue-600 dark:text-blue-400"
                          subTag={
                            managerSelected
                              ? {
                                  label: "随管理节点授权",
                                  className: "text-purple-600 dark:text-purple-400",
                                }
                              : undefined
                          }
                        />
                      </TableCell>
                      <TableCell className="align-top">
                        <PermissionNodeStatus node={child} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  )
}
