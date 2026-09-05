import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Check, CirclePlus, Copy, Eye, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { useCommonData } from "@/components/console/data-provider"
import NodeTree from "@/components/console/editor/node-tree"
import { EditorResourcePicker } from "@/components/console/editor/resource-picker"
import { ProjectPromptSelector } from "@/components/console/editor/project-prompt-selector"
import { listAvailableMcp, type AvailableMcpItem } from "@/api/agentClient"
import { fetchSkillListingWithMarket, fetchPluginListingWithMarket, type SkillListingItem, type PluginListingItem } from "@/lib/agent-resources-api"
import { useMarketSpecMappers } from "@/components/console/editor/use-market-specs"
import { machineInfoLine, machineSpecsLine } from "@/pages/manager/platform/nodes/types"
import { editorNodeHealth } from "@/api/nodes"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiRequest } from "@/utils/requestUtils"
import {
  createProjectEditor,
  deleteProjectEditor,
  duplicateProjectEditor,
  editorDisplayName,
  listProjectEditors,
  updateProjectEditor,
  type CreateEditorPayload,
  type EditorBranchMode,
  type EditorInstance,
  type EditorProvider,
  type UpdateEditorPayload,
} from "@/api/editorClient"
import type { DomainBranch } from "@/api/Api"
import { ConstsGitPlatform } from "@/api/Api"

const PROVIDERS: Array<{ value: EditorProvider; label: string }> = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
]

type ConfigEntry = Record<string, unknown>

function configEntries(value: unknown): ConfigEntry[] {
  return Array.isArray(value) ? value.filter((item): item is ConfigEntry => Boolean(item && typeof item === "object")).map((item) => ({ ...item })) : []
}

/**
 * 表格行用的节点信息串：机器 + 规格。节点不在可见列表里时只回落到 node_id 片段，
 * 「节点不存在 / 离线」这类异常由独立的状态列（{@link editorNodeHealth}）表达。
 */
function nodeInfoLine(editor: EditorInstance, nodes: ReturnType<typeof useCommonData>["nodes"]): string {
  const node = nodes.find((item) => item.node_id === editor.node_id)
  if (!node) return editor.node_id || "自动节点"
  return [machineInfoLine(node.capabilities), machineSpecsLine(node.capabilities)].filter(Boolean).join(" · ") || node.node_name || node.node_id
}

export default function ProjectOverviewEditorTab({ projectId, focusEditorId, autoOpen }: { projectId: string; focusEditorId?: string; autoOpen?: "editor" | "session" }) {
  const { nodes, loadingNodes, reloadNodes, projects } = useCommonData()
  const project = useMemo(() => projects.find((item) => item.id === projectId), [projects, projectId])
  const navigate = useNavigate()
  const [editors, setEditors] = useState<EditorInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [configTarget, setConfigTarget] = useState<EditorInstance | null>(null)
  const [configSaving, setConfigSaving] = useState(false)

  const [provider, setProvider] = useState<EditorProvider>("claude")
  const [name, setName] = useState("")
  const [branchMode, setBranchMode] = useState<EditorBranchMode>("default")
  const [branch, setBranch] = useState("")
  const [branches, setBranches] = useState<string[]>([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [branchFetchFailed, setBranchFetchFailed] = useState(false)
  const branchRequestIdRef = useRef(0)
  const [nodeId, setNodeId] = useState("")
  const [createPromptId, setCreatePromptId] = useState("")
  const [createMcp, setCreateMcp] = useState<ConfigEntry[]>([])
  const [createSkills, setCreateSkills] = useState<ConfigEntry[]>([])
  const [createPlugins, setCreatePlugins] = useState<ConfigEntry[]>([])
  const [editName, setEditName] = useState("")
  const [editBranch, setEditBranch] = useState("")
  const [editPromptId, setEditPromptId] = useState("")
  const [editMcp, setEditMcp] = useState<ConfigEntry[]>([])
  const [editSkills, setEditSkills] = useState<ConfigEntry[]>([])
  const [editPlugins, setEditPlugins] = useState<ConfigEntry[]>([])
  const [availableMcp, setAvailableMcp] = useState<AvailableMcpItem[]>([])
  const [availableSkills, setAvailableSkills] = useState<SkillListingItem[]>([])
  const [availablePlugins, setAvailablePlugins] = useState<PluginListingItem[]>([])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    else setRefreshing(true)
    try {
      setEditors(await listProjectEditors(projectId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载编辑器失败")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    void Promise.all([
      listAvailableMcp().then((response) => setAvailableMcp([...response.builtin, ...response.admin, ...response.upstream])).catch(() => setAvailableMcp([])),
      fetchSkillListingWithMarket().then(setAvailableSkills).catch(() => setAvailableSkills([])),
      fetchPluginListingWithMarket().then(setAvailablePlugins).catch(() => setAvailablePlugins([])),
    ])
  }, [])

  // GitHub 市场项选中时映射成 SkillSpec / NodePluginSpec wire shape（见 use-market-specs.ts）。
  const { mapSkillItem, mapPluginItem, skillItemState, pluginItemState } = useMarketSpecMappers(availableSkills, availablePlugins)

  useEffect(() => {
    if (!createOpen) return
    void reloadNodes().catch(() => {})
    const timer = window.setInterval(() => { void reloadNodes().catch(() => {}) }, 5_000)
    return () => window.clearInterval(timer)
  }, [createOpen, reloadNodes])

  // 弹框打开时按当前项目的 Git 身份拉取真实分支列表，供「分支列表」下拉使用。
  // 无 Git 身份 / 内部仓库 / 拉取失败时退化为空列表，下拉仍保留「主分支 / 自动创建」。
  useEffect(() => {
    if (!createOpen) {
      branchRequestIdRef.current += 1
      return
    }
    const requestId = ++branchRequestIdRef.current
    const identityId = project?.git_identity_id
    const fullName = project?.full_name || ""
    const platform = project?.platform
    if (!identityId || !fullName || platform === ConstsGitPlatform.GitPlatformInternal) {
      setBranches([])
      setBranchFetchFailed(false)
      setLoadingBranches(false)
      return
    }
    setLoadingBranches(true)
    setBranchFetchFailed(false)
    setBranches([])
    void apiRequest(
      "v1UsersGitIdentitiesBranchesDetail",
      {},
      [identityId, encodeURIComponent(fullName)],
      (resp) => {
        if (requestId !== branchRequestIdRef.current) return
        if (resp.code === 0 && Array.isArray(resp.data)) {
          const list = resp.data.map((item: DomainBranch) => item.name || "").filter(Boolean)
          setBranches(list)
          setBranchFetchFailed(list.length === 0)
          if (!list.includes(branch)) {
            setBranch(list.includes("main") ? "main" : list.includes("master") ? "master" : list[0] || "")
          }
        } else {
          setBranchFetchFailed(true)
        }
        setLoadingBranches(false)
      },
      () => {
        if (requestId !== branchRequestIdRef.current) return
        setBranchFetchFailed(true)
        setLoadingBranches(false)
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOpen, project?.git_identity_id, project?.full_name, project?.platform])

  // 侧边栏/表格：focusEditorId 或 new=session 直接进独立详情页；new=editor 在表格弹新建。
  const autoHandledRef = useRef<string | null>(null)
  useEffect(() => {
    if (autoHandledRef.current) return
    if (autoOpen === "editor") {
      autoHandledRef.current = "editor"
      openCreateDialog()
      return
    }
    if (focusEditorId) {
      autoHandledRef.current = "focus"
      const suffix = autoOpen === "session" ? "?new=session" : ""
      navigate(`/console/editor/${focusEditorId}${suffix}`)
    }
  }, [autoOpen, focusEditorId, projectId, navigate])

  function openCreateDialog() {
    resetCreateForm()
    setCreateOpen(true)
  }

  function resetCreateForm() {
    setProvider("claude")
    setName("")
    setBranchMode("default")
    setBranch("")
    setNodeId("")
    setCreatePromptId("")
    setCreateMcp([])
    setCreateSkills([])
    setCreatePlugins([])
  }

  function openConfig(editor: EditorInstance) {
    setConfigTarget(editor)
    setEditName(editor.name || "")
    setEditBranch(editor.branch || "")
    setEditPromptId(editor.prompt_id || "")
    setEditMcp(configEntries(editor.mcp_config))
    setEditSkills(configEntries(editor.skill_config))
    setEditPlugins(configEntries(editor.plugin_config))
  }

  async function submitCreate() {
    const payload: CreateEditorPayload = {
      provider,
      branch_mode: branchMode,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(branchMode === "existing" && branch ? { branch } : {}),
      ...(nodeId ? { node_id: nodeId } : {}),
      ...(createPromptId ? { prompt_id: createPromptId } : {}),
      mcp_config: createMcp,
      skill_config: createSkills,
      plugin_config: createPlugins,
    }
    setCreating(true)
    try {
      const created = await createProjectEditor(projectId, payload)
      await load(true)
      setCreateOpen(false)
      navigate(`/console/editor/${created.id}`)
      toast.success("编辑器已创建")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建编辑器失败")
    } finally {
      setCreating(false)
    }
  }

  async function submitConfig() {
    if (!configTarget) return
    const payload: UpdateEditorPayload = {
      name: editName.trim(),
      prompt_id: editPromptId,
      mcp_config: editMcp,
      skill_config: editSkills,
      plugin_config: editPlugins,
    }
    setConfigSaving(true)
    try {
      const next = await updateProjectEditor(projectId, payload)
      setEditors((current) => current.map((item) => item.id === next.id ? { ...item, ...next } : item))
      setConfigTarget(null)
      const failed = (next as EditorInstance & { config_resync?: { failed?: string[] } }).config_resync?.failed || []
      if (failed.length) toast.warning(`配置已保存，但 ${failed.length} 个任务重下发失败`)
      else toast.success("编辑器配置已更新")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新编辑器失败")
    } finally {
      setConfigSaving(false)
    }
  }

  async function removeEditor(editor: EditorInstance) {
    if (!window.confirm(`确认删除编辑器“${editorDisplayName(editor)}”？`)) return
    try {
      await deleteProjectEditor(projectId, editor.id)
      await load(true)
      toast.success("编辑器已删除，历史日志保留")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除编辑器失败")
    }
  }

  async function duplicateEditor(editor: EditorInstance) {
    try {
      const created = await duplicateProjectEditor(projectId, editor.id)
      await load(true)
      navigate(`/console/editor/${created.id}`)
      toast.success("编辑器已复制")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制编辑器失败")
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="font-medium">编辑器 <span className="text-muted-foreground">{editors.length}</span></h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /> 刷新
          </Button>
          <Button size="sm" onClick={openCreateDialog}>
            <CirclePlus className="size-4" /> 新建编辑器
          </Button>
        </div>
      </div>

      {loading ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>编辑器名字</TableHead>
                <TableHead className="w-[120px]">类型</TableHead>
                <TableHead>节点信息</TableHead>
                <TableHead className="w-[150px]">状态</TableHead>
                <TableHead className="w-[90px]">任务数</TableHead>
                <TableHead className="w-[180px] text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {editors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    还没有编辑器，点击「新建编辑器」开始。
                  </TableCell>
                </TableRow>
              ) : editors.map((editor) => (
                <TableRow key={editor.id}>
                  <TableCell className="font-medium">
                    {/* 红点：该编辑器下有任务出错，等用户处理。与编辑器详情页同一提示语义。 */}
                    <span className="flex items-center gap-1.5">
                      {(editor.sessions || []).some((session) => session.status === "error") && (
                        <span
                          aria-label="需要处理"
                          title="该编辑器有任务需要你处理"
                          className="inline-block size-2 shrink-0 rounded-full bg-destructive"
                        />
                      )}
                      {editorDisplayName(editor)}
                    </span>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{editor.provider}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{nodeInfoLine(editor, nodes)}</TableCell>
                  <TableCell>{(() => {
                    const health = editorNodeHealth(editor.node_id, nodes)
                    if (health.state === "auto") return <span className="text-xs text-muted-foreground">自动节点</span>
                    if (!health.abnormal) return <Badge variant="outline" className="text-green-600 dark:text-green-400">正常</Badge>
                    return <Badge variant="destructive" title={`异常 · ${health.reason}`}>异常 · {health.reason}</Badge>
                  })()}</TableCell>
                  <TableCell>{(editor.sessions || []).length}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="size-7" title="查看详情" onClick={() => navigate(`/console/editor/${editor.id}`)}><Eye className="size-4" /></Button>
                      <Button variant="ghost" size="icon" className="size-7" title="创建任务" onClick={() => navigate(`/console/editor/${editor.id}?new=session`)}><Plus className="size-4" /></Button>
                      <Button variant="ghost" size="icon" className="size-7" title="编辑配置" onClick={() => openConfig(editor)}><Pencil className="size-4" /></Button>
                      <Button variant="ghost" size="icon" className="size-7" title="复制编辑器" onClick={() => void duplicateEditor(editor)}><Copy className="size-4" /></Button>
                      <Button variant="ghost" size="icon" className="size-7" title="删除编辑器" onClick={() => void removeEditor(editor)}><Trash2 className="size-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl"><DialogHeader><DialogTitle>新建编辑器</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2"><Label>编辑器类型</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={provider} onChange={(event) => { setProvider(event.target.value as EditorProvider); setNodeId("") }}>{PROVIDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
              <div className="grid gap-2"><Label>名称</Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：主项目 Claude" /></div>
            </div>
            <div className="grid gap-2">
              <Label>分支</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select value={branchMode} onValueChange={(value) => setBranchMode(value as EditorBranchMode)}>
                  <SelectTrigger className="h-9 w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">主分支</SelectItem>
                    <SelectItem value="auto">自动创建</SelectItem>
                    <SelectItem value="existing">分支列表</SelectItem>
                  </SelectContent>
                </Select>
                {branchMode === "existing" ? (
                  <Select value={branch} onValueChange={setBranch}>
                    <SelectTrigger className="h-9 flex-1">
                      <SelectValue placeholder={loadingBranches ? "加载分支中…" : branchFetchFailed ? "分支加载失败，可重开弹框重试" : branches.length === 0 ? "暂无可用分支" : "选择分支"} />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : branchMode === "auto" ? (
                  <span className="text-xs text-muted-foreground">首次初始化时从默认分支创建 <code className="rounded bg-muted px-1">editor/&lt;编辑器ID&gt;</code>，无需手动命名。</span>
                ) : (
                  <span className="text-xs text-muted-foreground">克隆时跟随仓库默认分支（HEAD），不指定具体分支名。</span>
                )}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>
                执行节点 <span className="text-xs font-normal text-muted-foreground">共 {nodes.filter((item) => item.node_role === "execution").length} 个</span>
              </Label>
              {loadingNodes && nodes.length === 0 ? (
                <div className="flex h-20 items-center justify-center rounded-md border text-sm text-muted-foreground">
                  <Spinner /> 正在获取节点实时信息…
                </div>
              ) : (
                <NodeTree nodes={nodes} value={nodeId} onChange={setNodeId} provider={provider} />
              )}
            </div>
            <ProjectPromptSelector value={createPromptId} onChange={setCreatePromptId} provider={provider} />
            <EditorResourcePicker label="MCP 服务" items={availableMcp} selected={createMcp} onChange={setCreateMcp} />
            <EditorResourcePicker label="Skills" items={availableSkills} selected={createSkills} onChange={setCreateSkills} mapItem={mapSkillItem} itemState={skillItemState} />
            <EditorResourcePicker label="Plugins" items={availablePlugins} selected={createPlugins} onChange={setCreatePlugins} mapItem={mapPluginItem} itemState={pluginItemState} />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button onClick={() => void submitCreate()} disabled={creating || (branchMode === "existing" && !branch)}>{creating ? <Spinner /> : <Check className="size-4" />} 创建</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {configTarget && <ConfigDialog />}
    </div>
  )

  function ConfigDialog() {
    return (
      <Dialog open={Boolean(configTarget)} onOpenChange={(open) => { if (!open) setConfigTarget(null) }}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl"><DialogHeader><DialogTitle>编辑器配置</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">编辑器类型属于编辑器身份，不可就地修改；换类型请新建编辑器。分支不可修改，换分支请新建编辑器。保存后 MCP / Skills / Plugins 会重新下发给活跃任务并重启运行时。</div>
            <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-2"><Label>名称</Label><Input value={editName} onChange={(event) => setEditName(event.target.value)} /></div><div className="grid gap-2"><Label>分支（不可修改）</Label><Input value={editBranch} disabled readOnly placeholder="main" /></div></div>
            {configTarget && <ProjectPromptSelector value={editPromptId} onChange={setEditPromptId} provider={configTarget.provider} />}
            <EditorResourcePicker label="MCP 服务" items={availableMcp} selected={editMcp} onChange={setEditMcp} />
            <EditorResourcePicker label="Skills" items={availableSkills} selected={editSkills} onChange={setEditSkills} mapItem={mapSkillItem} itemState={skillItemState} />
            <EditorResourcePicker label="Plugins" items={availablePlugins} selected={editPlugins} onChange={setEditPlugins} mapItem={mapPluginItem} itemState={pluginItemState} />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setConfigTarget(null)}>取消</Button><Button onClick={() => void submitConfig()} disabled={configSaving}>{configSaving ? <Spinner /> : <Check className="size-4" />} 保存并下发</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }
}
