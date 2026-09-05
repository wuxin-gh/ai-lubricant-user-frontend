import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { IconArrowLeft } from "@tabler/icons-react"
import { Check } from "lucide-react"
import { useCommonData } from "@/components/console/data-provider"
import EditorDetail from "@/components/console/editor/editor-detail"
import { EditorResourcePicker } from "@/components/console/editor/resource-picker"
import { listAvailableMcp, listRuntimeModelOptions, type AvailableMcpItem } from "@/api/agentClient"
import { fetchSkillListingWithMarket, fetchPluginListingWithMarket, type SkillListingItem, type PluginListingItem } from "@/lib/agent-resources-api"
import { useMarketSpecMappers } from "@/components/console/editor/use-market-specs"
import {
  getEditorDetail,
  listParentKeys,
  updateProjectEditor,
  type EditorInstance,
  type ParentKeyItem,
  type UpdateEditorPayload,
} from "@/api/editorClient"
import { ProjectPromptSelector } from "@/components/console/editor/project-prompt-selector"

type ConfigEntry = Record<string, unknown>

function configEntries(value: unknown): ConfigEntry[] {
  return Array.isArray(value)
    ? value.filter((item): item is ConfigEntry => Boolean(item && typeof item === "object")).map((item) => ({ ...item }))
    : []
}

/**
 * 编辑器详情独立路由页 (/console/editor/:editorId)。
 * 编辑器与项目一对一，项目 id 从编辑器详情返回体取得，仅用于项目级兼容操作。
 */
export default function EditorDetailPage() {
  const { editorId = "" } = useParams<{ editorId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const autoOpenTask = searchParams.get("new") === "session"
  const initialContent = searchParams.get("content") || ""
  const initialModels = searchParams.get("models")?.split(",").filter(Boolean) || []
  const { nodes, reloadNodes } = useCommonData()

  const [editor, setEditor] = useState<EditorInstance | null>(null)
  const [parentKeys, setParentKeys] = useState<ParentKeyItem[]>([])
  const [gatewayModels, setGatewayModels] = useState<Array<{ value: string; label: string }>>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [availableMcp, setAvailableMcp] = useState<AvailableMcpItem[]>([])
  const [availableSkills, setAvailableSkills] = useState<SkillListingItem[]>([])
  const [availablePlugins, setAvailablePlugins] = useState<PluginListingItem[]>([])

  const [configOpen, setConfigOpen] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [editName, setEditName] = useState("")
  const [editBranch, setEditBranch] = useState("")
  const [editPromptId, setEditPromptId] = useState("")
  const [editMcp, setEditMcp] = useState<ConfigEntry[]>([])
  const [editSkills, setEditSkills] = useState<ConfigEntry[]>([])
  const [editPlugins, setEditPlugins] = useState<ConfigEntry[]>([])

  const load = useCallback(async () => {
    if (!editorId) return
    setLoading(true)
    try {
      const [nextEditor, nextKeys] = await Promise.all([
        getEditorDetail(editorId),
        listParentKeys().then((keys) => keys.filter((key) => !key.disabled)).catch(() => [] as ParentKeyItem[]),
      ])
      setEditor(nextEditor)
      setParentKeys(nextKeys)
      setNotFound(false)
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [editorId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    void Promise.all([
      listAvailableMcp().then((response) => setAvailableMcp([...response.builtin, ...response.admin, ...response.upstream])).catch(() => setAvailableMcp([])),
      fetchSkillListingWithMarket().then(setAvailableSkills).catch(() => setAvailableSkills([])),
      fetchPluginListingWithMarket().then(setAvailablePlugins).catch(() => setAvailablePlugins([])),
    ])
  }, [])

  // 编辑器执行 Key 变化时按该 Key 的白/黑名单拉可用模型；不再用全局 /v1/models。
  // session.models 优先；本列表仅作回退，保证回退路径也按 Key 过滤。
  useEffect(() => {
    const apiKeyId = editor?.api_key_id
    if (!apiKeyId) {
      setGatewayModels([])
      return
    }
    const controller = new AbortController()
    void listRuntimeModelOptions(apiKeyId, controller.signal)
      .then((options) => { if (!controller.signal.aborted) setGatewayModels(options) })
      .catch(() => { if (!controller.signal.aborted) setGatewayModels([]) })
    return () => { controller.abort() }
  }, [editor?.api_key_id])

  const { mapSkillItem, mapPluginItem, skillItemState, pluginItemState } = useMarketSpecMappers(availableSkills, availablePlugins)

  const projectId = editor?.project_id || ""

  function backToTable() {
    if (projectId) navigate(`/console/project/${projectId}?tab=editors`)
    else navigate("/console/tasks")
  }

  function openConfig() {
    if (!editor) return
    setEditName(editor.name || "")
    setEditBranch(editor.branch || "")
    setEditPromptId(editor.prompt_id || "")
    setEditMcp(configEntries(editor.mcp_config))
    setEditSkills(configEntries(editor.skill_config))
    setEditPlugins(configEntries(editor.plugin_config))
    setConfigOpen(true)
  }

  async function submitConfig() {
    if (!editor) return
    const pid = editor.project_id || ""
    const payload: UpdateEditorPayload = {
      name: editName.trim(),
      prompt_id: editPromptId,
      mcp_config: editMcp,
      skill_config: editSkills,
      plugin_config: editPlugins,
    }
    setConfigSaving(true)
    try {
      const next = await updateProjectEditor(pid, payload)
      setEditor((current) => (current ? { ...current, ...next } : next))
      setConfigOpen(false)
      const failed = (next as EditorInstance & { config_resync?: { failed?: string[] } }).config_resync?.failed || []
      if (failed.length) toast.warning(`配置已保存，但 ${failed.length} 项下发失败：${failed[0]}`)
      else toast.success("编辑器配置已更新")
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新编辑器失败")
    } finally {
      setConfigSaving(false)
    }
  }

  if (loading && !editor) {
    return <div className="flex h-full items-center justify-center"><Spinner /></div>
  }

  if (notFound || !editor) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">编辑器不存在或已删除</p>
            <Button variant="outline" size="sm" onClick={backToTable}><IconArrowLeft className="size-4" />返回编辑器列表</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-4 md:p-6">
      <EditorDetail
        projectId={projectId}
        editor={editor}
        parentKeys={parentKeys}
        models={gatewayModels}
        nodes={nodes}
        autoOpenTask={autoOpenTask}
        initialContent={initialContent}
        initialModels={initialModels}
        onRefreshNodes={reloadNodes}
        onBack={backToTable}
        onRemoved={backToTable}
        onEditConfig={openConfig}
        onMutated={() => void load()}
      />

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>编辑器配置</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">编辑器类型属于编辑器身份，不可就地修改；换类型请新建编辑器。保存后 MCP / Skills / Plugins 会重新下发给活跃任务并重启运行时。</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2"><Label>名称</Label><Input value={editName} onChange={(event) => setEditName(event.target.value)} /></div>
              <div className="grid gap-2"><Label>分支（不可修改，换分支请新建编辑器）</Label><Input value={editBranch} disabled readOnly placeholder="main" /></div>
            </div>
            <ProjectPromptSelector value={editPromptId} onChange={setEditPromptId} provider={editor.provider} />
            <EditorResourcePicker label="MCP 服务" items={availableMcp} selected={editMcp} onChange={setEditMcp} />
            <EditorResourcePicker label="Skills" items={availableSkills} selected={editSkills} onChange={setEditSkills} mapItem={mapSkillItem} itemState={skillItemState} />
            <EditorResourcePicker label="Plugins" items={availablePlugins} selected={editPlugins} onChange={setEditPlugins} mapItem={mapPluginItem} itemState={pluginItemState} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>取消</Button>
            <Button onClick={() => void submitConfig()} disabled={configSaving}>{configSaving ? <Spinner /> : <Check className="size-4" />} 保存并下发</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
