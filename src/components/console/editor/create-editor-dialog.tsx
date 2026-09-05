import { useEffect, useState } from "react"
import { Check } from "lucide-react"
import { toast } from "sonner"

import { listAvailableMcp, type AvailableMcpItem } from "@/api/agentClient"
import {
  createProjectEditor,
  type CreateEditorPayload,
  type EditorBranchMode,
  type EditorInstance,
  type EditorProvider,
} from "@/api/editorClient"
import { useCommonData } from "@/components/console/data-provider"
import NodeTree from "@/components/console/editor/node-tree"
import { EditorResourcePicker } from "@/components/console/editor/resource-picker"
import { ProjectPromptSelector } from "@/components/console/editor/project-prompt-selector"
import { useMarketSpecMappers } from "@/components/console/editor/use-market-specs"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { fetchPluginListingWithMarket, fetchSkillListingWithMarket, type PluginListingItem, type SkillListingItem } from "@/lib/agent-resources-api"

type ConfigEntry = Record<string, unknown>

const PROVIDERS: Array<{ value: EditorProvider; label: string }> = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
]

export default function CreateEditorDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  onCreated?: (editor: EditorInstance) => void
}) {
  const { nodes, loadingNodes, reloadNodes } = useCommonData()
  const [provider, setProvider] = useState<EditorProvider>("claude")
  const [name, setName] = useState("")
  const [branchMode, setBranchMode] = useState<EditorBranchMode>("default")
  const [branch, setBranch] = useState("")
  const [nodeId, setNodeId] = useState("")
  const [promptId, setPromptId] = useState("")
  const [mcp, setMcp] = useState<ConfigEntry[]>([])
  const [skills, setSkills] = useState<ConfigEntry[]>([])
  const [plugins, setPlugins] = useState<ConfigEntry[]>([])
  const [availableMcp, setAvailableMcp] = useState<AvailableMcpItem[]>([])
  const [availableSkills, setAvailableSkills] = useState<SkillListingItem[]>([])
  const [availablePlugins, setAvailablePlugins] = useState<PluginListingItem[]>([])
  const [creating, setCreating] = useState(false)
  const { mapSkillItem, mapPluginItem, skillItemState, pluginItemState } = useMarketSpecMappers(availableSkills, availablePlugins)

  useEffect(() => {
    if (!open) return
    setProvider("claude")
    setName("")
    setBranchMode("default")
    setBranch("")
    setNodeId("")
    setPromptId("")
    setMcp([])
    setSkills([])
    setPlugins([])
    void reloadNodes().catch(() => {})
    void Promise.all([
      listAvailableMcp().then((response) => setAvailableMcp([...response.builtin, ...response.admin, ...response.upstream])).catch(() => setAvailableMcp([])),
      fetchSkillListingWithMarket().then(setAvailableSkills).catch(() => setAvailableSkills([])),
      fetchPluginListingWithMarket().then(setAvailablePlugins).catch(() => setAvailablePlugins([])),
    ])
  }, [open, reloadNodes])

  async function submit() {
    const payload: CreateEditorPayload = {
      provider,
      branch_mode: branchMode,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(branchMode === "existing" && branch.trim() ? { branch: branch.trim() } : {}),
      ...(nodeId ? { node_id: nodeId } : {}),
      ...(promptId ? { prompt_id: promptId } : {}),
      mcp_config: mcp,
      skill_config: skills,
      plugin_config: plugins,
    }
    setCreating(true)
    try {
      const created = await createProjectEditor(projectId, payload)
      toast.success("编辑器已创建")
      onCreated?.(created)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建编辑器失败")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>新建编辑器</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>编辑器类型</Label>
              <select className="h-9 rounded-md border bg-background px-3 text-sm" value={provider} onChange={(event) => { setProvider(event.target.value as EditorProvider); setNodeId("") }}>
                {PROVIDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            <div className="grid gap-2"><Label>名称</Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：主项目 Claude" /></div>
          </div>
          <div className="grid gap-2">
            <Label>分支</Label>
            <div className="flex gap-2">
              <Select value={branchMode} onValueChange={(value) => setBranchMode(value as EditorBranchMode)}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="default">主分支</SelectItem><SelectItem value="auto">自动创建</SelectItem><SelectItem value="existing">已有分支</SelectItem></SelectContent>
              </Select>
              {branchMode === "existing" && <Input className="flex-1" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="输入已有分支名" />}
            </div>
          </div>
          <div className="grid gap-2">
            <Label>执行节点</Label>
            {loadingNodes && nodes.length === 0 ? <div className="flex h-20 items-center justify-center rounded-md border"><Spinner /></div> : <NodeTree nodes={nodes} value={nodeId} onChange={setNodeId} provider={provider} />}
          </div>
          <ProjectPromptSelector value={promptId} onChange={setPromptId} provider={provider} />
          <EditorResourcePicker label="MCP 服务" items={availableMcp} selected={mcp} onChange={setMcp} />
          <EditorResourcePicker label="Skills" items={availableSkills} selected={skills} onChange={setSkills} mapItem={mapSkillItem} itemState={skillItemState} />
          <EditorResourcePicker label="Plugins" items={availablePlugins} selected={plugins} onChange={setPlugins} mapItem={mapPluginItem} itemState={pluginItemState} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => void submit()} disabled={creating || (branchMode === "existing" && !branch.trim())}>{creating ? <Spinner /> : <Check className="size-4" />}创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
