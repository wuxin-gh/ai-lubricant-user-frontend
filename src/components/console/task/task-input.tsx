import { type DomainSkillListItem } from "@/api/Api";
import { useCommonData } from "@/components/console/data-provider";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupTextarea, InputGroupAddon } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/utils/requestUtils";
import { IconSend, IconSourceCode, IconMessage, IconRobot, IconFolder, IconPlug, IconBook } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { VoiceInputButton } from "./voice-input-button";
import { IS_OFFLINE_EDITION } from "@/utils/edition";
import { MAX_TASK_CONTENT_LENGTH } from "./task-content-limit";
import { fetchMarketIndex, MARKET_SOURCE, type MarketItem } from "@/api/marketplaceRaw";
import { EditorResourcePicker, type ConfigEntry, type ResourceItem } from "@/components/console/editor/resource-picker";
import { createUserTask } from "@/api/userTaskClient";
import { TaskBranchPicker, type TaskBranchMode } from "./task-form-fields";
import { isNodeUsable } from "@/api/nodes";
import { listEffectiveResources, type ResourceReference } from "@/api/resourceReferences";
import {
  createConversation,
  listAgents,
  listAvailableMcp,
  listUsableKeys,
  listChatModels,
  createChatConversation,
  DEFAULT_CHAT_SETTINGS,
  type AgentInstance,
  type AvailableMcpItem,
  type RuntimeKeyItem,
  type AvailableModel,
} from "@/api/agentClient";
import { useTranslation } from "react-i18next";

type DomainSkill = DomainSkillListItem & { tags?: string[] };

/**
 * 新任务模式：
 * - chat：普通对话任务，露出 API Key + 模型选择（默认）。
 * - agent：选择一个具体 Agent（子菜单），在当前页直接发起 Agent 会话。
 * - project：选择一个具体项目（子菜单）+ 该项目的编辑器，点执行跳到编辑器
 *   详情页并自动打开 session 创建弹框（那里支持父 Key、模型多选、内容等）。
 *
 * agent / project 必须从子菜单里选中具体条目才生效，只点父项不切换。
 */
type TaskMode = "chat" | "agent" | "project";

interface TaskInputProps {
  onTaskCreated?: () => void;
}

export function TaskInput({ onTaskCreated }: TaskInputProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [taskContent, setTaskContent] = useState<string>("");

  const [selectedModelId, setSelectedModelId] = useState<string>("");
  // 项目模式是模型多选：一个 session 携带整组模型，运行时可切换，第一个为激活模型。
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);

  const [creatingTask, setCreatingTask] = useState<boolean>(false);

  // ── 模式：对话（默认） / Agent 对话 / 项目 ────────────────────────────
  const [mode, setMode] = useState<TaskMode>("chat");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [agents, setAgents] = useState<AgentInstance[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [availableMcp, setAvailableMcp] = useState<AvailableMcpItem[]>([]);
  const [selectedMcp, setSelectedMcp] = useState<Record<string, unknown>[]>([]);
  // 项目模式的插件选择（与 MCP / 技能同口径，来自 /resources/effective）。
  const [pluginRows, setPluginRows] = useState<ResourceReference[]>([]);
  const [selectedPlugins, setSelectedPlugins] = useState<ConfigEntry[]>([]);
  const [runtimeKeys, setRuntimeKeys] = useState<RuntimeKeyItem[]>([]);
  const [selectedApiKeyId, setSelectedApiKeyId] = useState<number | null>(null);
  const [chatModels, setChatModels] = useState<AvailableModel[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  // 项目模式的技能选择（与 MCP / 插件同口径，复用 EditorResourcePicker）。
  const [skillList, setSkillList] = useState<DomainSkill[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<ConfigEntry[]>([]);
  // 项目模式的分支策略（自动创建 / 主分支 / 已有分支）。
  const [branchMode, setBranchMode] = useState<TaskBranchMode>("default");
  const [branch, setBranch] = useState("");

  const { projects, nodes } = useCommonData();

  // Agent 列表按需拉一次：模式菜单的 Agent 子菜单要列出可用 Agent。
  useEffect(() => {
    let active = true;
    listAgents()
      .then((list) => { if (active) setAgents(list.filter((a) => a.enabled)); })
      .catch(() => { if (active) setAgents([]); });
    return () => { active = false; };
  }, []);

  // 项目模式直接选择 canonical Task 的 execution node。
  useEffect(() => {
    if (mode !== "project") return;
    setSelectedNodeId((current) => current && nodes.some((node) => node.node_id === current && isNodeUsable(node))
      ? current
      : nodes.find((node) => node.node_role === "execution" && isNodeUsable(node))?.node_id || "");
  }, [mode, nodes]);

  // 项目模式恢复原有的 MCP 选择；这些选择随后预填到编辑器 session 创建弹框。
  useEffect(() => {
    if (mode !== "project" || availableMcp.length > 0) return;
    let active = true;
    listAvailableMcp()
      .then((response) => {
        if (active) setAvailableMcp([...response.builtin, ...response.admin, ...response.upstream]);
      })
      .catch(() => { if (active) setAvailableMcp([]); });
    return () => { active = false };
  }, [mode, availableMcp.length]);

  // 项目模式懒加载可用插件（你分组已授权的，来自 /resources/effective?type=plugin）。
  useEffect(() => {
    if (mode !== "project" || pluginRows.length > 0) return;
    let active = true;
    listEffectiveResources("plugin")
      .then((rows) => { if (active) setPluginRows(rows); })
      .catch(() => { if (active) setPluginRows([]); });
    return () => { active = false };
  }, [mode, pluginRows.length]);

  const fetchSkillList = useCallback(() => {
    apiRequest("v1SkillsList", {}, [], (response) => {
      if (response.code === 0) {
        const skills = response.data || [];
        // 任务创建处展示 Skill 列表，直接复用 modules/skills；市场不可用时静默回退。
        fetchMarketIndex("skills")
          .then((items) => items.filter((it) => it.kind === "skill"))
          .then((marketItems: MarketItem[]) => {
            const localIds = new Set(skills.map((s: DomainSkill) => s.id));
            const fresh = marketItems.filter((it) => !localIds.has(it.id));
            const mapped: DomainSkill[] = fresh.map((it) => ({
              id: it.id,
              name: it.name || it.id,
              description: it.summary || "",
              tags: it.tags || [],
              __source: MARKET_SOURCE,
            } as DomainSkill));
            setSkillList([...skills, ...mapped]);
          })
          .catch(() => setSkillList(skills));
        setSkillList(skills);
      } else {
        toast.error(response.message || t("taskWorkflow.toast.fetchSkillsFailed"));
      }
    });
  }, [t]);

  useEffect(() => {
    if (mode === "project" && skillList.length === 0) fetchSkillList();
  }, [fetchSkillList, mode, skillList.length]);

  // 对话模式需要 API Key；懒加载可用网关 Key（自有 + 分组授权系统 key）。
  useEffect(() => {
    if (mode === "agent" || runtimeKeys.length > 0) return;
    let active = true;
    listUsableKeys()
      .then((keys) => {
        if (!active) return;
        const enabled = keys.filter((k) => !k.disabled);
        setRuntimeKeys(enabled);
        if (enabled.length > 0) setSelectedApiKeyId((current) => current ?? enabled[0].id);
      })
      .catch(() => { if (active) setRuntimeKeys([]); });
    return () => { active = false; };
  }, [mode, runtimeKeys.length]);

  // API Key 变化 -> 重拉该 Key 白名单下可用模型，并校正当前选中模型（不在新列表则清空）。
  useEffect(() => {
    if (mode === "agent" || selectedApiKeyId == null) {
      setChatModels([]);
      return;
    }
    let active = true;
    listChatModels(selectedApiKeyId)
      .then((list) => {
        if (!active) return;
        setChatModels(list);
        setSelectedModelId((current) => (current && list.some((m) => m.id === current) ? current : list[0]?.id || ""));
        // 项目模式是模型多选（一个 session 携带整组模型，运行时可切换）：
        // 只保留仍在新列表里的。默认不选：空 = 不限制（继承该 Key 全部模型）。
        setSelectedModelIds((current) => current.filter((id) => list.some((m) => m.id === id)));
      })
      .catch(() => { if (active) setChatModels([]); });
    return () => { active = false; };
  }, [mode, selectedApiKeyId]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) || null,
    [agents, selectedAgentId]
  );
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const filteredChatModels = useMemo(() => {
    const keyword = modelSearch.trim().toLocaleLowerCase()
    if (!keyword) return chatModels
    return chatModels.filter((model) => [model.name, model.remark, model.id, model.description]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(keyword)))
  }, [chatModels, modelSearch])

  const selectedChatModel = useMemo(
    () => chatModels.find((model) => model.id === selectedModelId) || null,
    [chatModels, selectedModelId]
  );

  // 插件资源行映射成 EditorResourcePicker 的 item（与 canonical 创建弹框同口径）。
  const pluginItems = useMemo<ResourceItem[]>(
    () => pluginRows.map((row) => ({
      id: row.id,
      name: row.name,
      display_name: row.display_name || row.name,
      description: row.version ? `v${row.version}` : undefined,
    })),
    [pluginRows],
  );
  const selectedPluginIds = useMemo(
    () => selectedPlugins
      .map((entry) => String(entry.id || entry.name || entry.url || entry.entry || ""))
      .filter(Boolean),
    [selectedPlugins],
  );

  // 技能行映射成 EditorResourcePicker 的 item（与 MCP / 插件同口径）。
  const skillItems = useMemo<ResourceItem[]>(
    () => skillList.map((skill) => ({
      id: skill.id,
      name: skill.name,
      display_name: skill.name || skill.id,
      description: skill.description,
      __source: (skill as DomainSkill & { __source?: string }).__source,
    })),
    [skillList],
  );

  // MCP 服务实例映射成 picker item：勾选后的条目带 service_id，提交时作为
  // mcp_config 的绑定形态发给服务端 resolver。之前把浏览器侧的条目摘要
  // （id/display_name/tool_count）原样提交，服务端落库成无 transport/无命令的
  // 废 spec，节点侧根本不可用。
  const mcpItems = useMemo<ResourceItem[]>(
    () => availableMcp.map((item) => ({
      id: item.id,
      name: item.name,
      display_name: item.display_name || item.name,
      description: [item.description, item.tool_count ? `${item.tool_count} 个工具` : ""].filter(Boolean).join(" · ") || undefined,
      __badge: item.source === "builtin" ? "内置" : item.source === "admin" ? "平台" : item.source === "upstream" ? "个人" : item.source,
      disabled: item.enabled === false,
    })),
    [availableMcp],
  );
  const selectedSkillIds = useMemo(
    () => selectedSkills
      .map((entry) => String(entry.id || entry.name || entry.url || entry.entry || ""))
      .filter(Boolean),
    [selectedSkills],
  );

  const toggleModel = (modelId: string) => {
    setSelectedModelIds((current) =>
      current.includes(modelId) ? current.filter((id) => id !== modelId) : [...current, modelId]
    );
  };

  const modeLabel = useMemo(() => {
    if (mode === "agent") {
      return selectedAgent
        ? `Agent · ${selectedAgent.display_name || selectedAgent.name}`
        : "Agent 对话";
    }
    if (mode === "project") {
      return selectedProject ? `项目 · ${selectedProject.name}` : "项目";
    }
    return "对话";
  }, [mode, selectedAgent, selectedProject]);

  const ModeIcon = mode === "agent" ? IconRobot : mode === "project" ? IconFolder : IconMessage;

  /** 选中一个具体 Agent：切到 agent 模式并跳到 Agent 对话页新建会话。 */
  const handlePickAgent = (agent: AgentInstance) => {
    setMode("agent");
    setSelectedAgentId(agent.id);
    setModeMenuOpen(false);
  };

  /** 选中一个具体项目：切到 project 模式（编辑器列表按选中项目懒加载）。 */
  const handlePickProject = (projectId: string) => {
    setMode("project");
    setSelectedProjectId(projectId);
    setModeMenuOpen(false);
  };

  // 对话模式：用所选 API Key + 模型建一个 chat 会话，跳到聊天页并带上首条消息自动发出。
  const startChatConversation = async () => {
    if (!selectedApiKeyId) {
      toast.error("请选择 API Key");
      return;
    }
    if (!selectedModelId) {
      toast.error("请选择模型");
      return;
    }
    const content = taskContent.trim();
    setCreatingTask(true);
    try {
      const conversation = await createChatConversation({
        title: content.slice(0, 30) || "新对话",
        model: selectedModelId,
        chat_settings: { ...DEFAULT_CHAT_SETTINGS, apiKeyId: selectedApiKeyId, model: selectedModelId },
      });
      const params = new URLSearchParams();
      params.set("conversationId", conversation.id);
      if (content) params.set("send", content);
      navigate(`/console/chat?${params.toString()}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建对话失败");
    } finally {
      setCreatingTask(false);
    }
  };

  // Agent 模式：用所选 Agent 建一个会话，跳到 Agent 对话页并带上首条消息自动发出。
  const startAgentConversation = async () => {
    if (!selectedAgentId) {
      toast.error("请从模式菜单的 Agent 子菜单选择一个 Agent");
      return;
    }
    const content = taskContent.trim();
    setCreatingTask(true);
    try {
      const conversation = await createConversation({ agent_id: selectedAgentId });
      const params = new URLSearchParams();
      params.set("agentId", String(selectedAgentId));
      params.set("conversationId", conversation.id);
      if (content) params.set("send", content);
      navigate(`/console/agent-chat?${params.toString()}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建 Agent 会话失败");
    } finally {
      setCreatingTask(false);
    }
  };

  const inputPlaceholder = useMemo(() => {
    if (mode === "agent" && selectedAgent) {
      return `向 ${selectedAgent.display_name || selectedAgent.name} 提问…`
    }
    if (mode === "project" && selectedProject) {
      return `在项目「${selectedProject.name}」中开始开发（内容可为空，为空则会等待用户输入）…`
    }
    return t("taskWorkflow.input.placeholder")
  }, [mode, selectedAgent, selectedProject, t])

  const taskContentLength = taskContent.length;
  const taskContentTooLong = taskContentLength > MAX_TASK_CONTENT_LENGTH;

  const validateTaskContent = () => {
    if (!taskContent.trim()) {
      toast.error(t("taskWorkflow.toast.missingContent"));
      return false;
    }

    if (taskContentTooLong) {
      toast.error(t("taskWorkflow.input.contentTooLong", { maxCount: MAX_TASK_CONTENT_LENGTH }));
      return false;
    }

    return true;
  };

  const handleExecuteButtonClick = () => {
    if (!validateTaskContent()) {
      return;
    }

    // Agent 模式：建会话 → 跳 Agent 对话页 → 自动发首条。
    if (mode === "agent") {
      void startAgentConversation();
      return;
    }

    // 对话模式：建会话（带所选 Key/模型）→ 跳聊天页 → 自动发首条。
    if (mode === "chat") {
      void startChatConversation();
      return;
    }

    // 项目模式直接创建 canonical Task，不再经过 editor template/session。
    if (mode === "project") {
      if (!selectedProjectId || !selectedProject) {
        toast.error("请从模式菜单的项目子菜单选择一个项目");
        return;
      }
      if (!selectedNodeId) {
        toast.error("请选择执行节点");
        return;
      }
      if (!selectedApiKeyId) {
        toast.error("请选择父 API Key");
        return;
      }
      // 模型默认不选：空 = 不限制（任务继承该 Key 允许的全部模型）。
      setCreatingTask(true);
      void createUserTask({
        content: taskContent.trim(),
        provider: "opencode",
        cli_name: "opencode",
        node_id: selectedNodeId,
        parent_api_key_id: selectedApiKeyId,
        model_id: selectedModelIds[0],
        models: selectedModelIds.length ? selectedModelIds : undefined,
        repo: {
          repo_url: selectedProject.repo_url || undefined,
          branch_mode: branchMode,
          ...(branchMode === "existing" && branch.trim() ? { branch: branch.trim() } : {}),
        },
        extra: { project_id: selectedProjectId, skill_ids: selectedSkillIds, ...(selectedPluginIds.length ? { plugin_ids: selectedPluginIds } : {}) },
        mcp_config: selectedMcp,
        task_type: "develop",
        task_role: "manual",
      }).then((task) => {
        onTaskCreated?.();
        navigate(`/console/task/${task.id}`);
      }).catch((error) => {
        toast.error(error instanceof Error ? error.message : "创建任务失败");
      }).finally(() => setCreatingTask(false));
      return;
    }
  };

  return (
    <>
      <InputGroup className="rounded-4xl p-2 pb-0">
        <InputGroupTextarea 
          className="min-h-30 max-h-60 break-all" 
          aria-invalid={taskContentTooLong}
          placeholder={inputPlaceholder}
          value={taskContent} 
          onChange={(e) => setTaskContent(e.target.value)} 
        />
        <InputGroupAddon align="block-end" className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {/* 模式菜单：对话 / Agent 对话▸ / 项目▸。后两者必须从子菜单选中具体条目。 */}
            <DropdownMenu open={modeMenuOpen} onOpenChange={setModeMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn(
                    "rounded-full max-w-[220px] sm:max-w-full",
                    mode !== "chat" ? "text-primary hover:text-primary" : ""
                  )}
                >
                  <ModeIcon className="size-4" />
                  <span className="line-clamp-1 break-all text-ellipsis hidden sm:block">{modeLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[200px]">
                <DropdownMenuItem
                  onSelect={() => {
                    setMode("chat")
                    setSelectedAgentId(null)
                    setSelectedProjectId("")
                  }}
                >
                  <IconMessage className="size-4" />
                  对话
                </DropdownMenuItem>

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="w-full">
                    <IconRobot className="size-4" />
                    Agent 对话
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="max-h-72 min-w-[220px] overflow-y-auto">
                      {agents.length === 0 ? (
                        <div className="px-3 py-3 text-sm text-muted-foreground">
                          暂无可用 Agent
                        </div>
                      ) : (
                        agents.map((agent) => (
                          <DropdownMenuItem key={agent.id} onSelect={() => handlePickAgent(agent)}>
                            <IconRobot className="size-4" />
                            <span className="min-w-0 flex-1 truncate">
                              {agent.display_name || agent.name}
                            </span>
                            {agent.user_id == null && (
                              <span className="shrink-0 text-[10px] text-muted-foreground">平台</span>
                            )}
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="w-full">
                    <IconFolder className="size-4" />
                    项目
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="max-h-72 min-w-[220px] overflow-y-auto">
                      {projects.length === 0 ? (
                        <div className="px-3 py-3 text-sm text-muted-foreground">
                          暂无项目
                        </div>
                      ) : (
                        projects.map((project) => (
                          <DropdownMenuItem
                            key={project.id}
                            onSelect={() => handlePickProject(project.id || "")}
                          >
                            <IconFolder className="size-4" />
                            <span className="min-w-0 flex-1 truncate">{project.name}</span>
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 对话模式：API Key + 模型（随 API Key 变化重拉）。 */}
            {mode === "chat" && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="rounded-full max-w-[220px]">
                      <IconSourceCode className="size-4" />
                      <span className="line-clamp-1 break-all text-ellipsis hidden sm:block">
                        {runtimeKeys.find((k) => k.id === selectedApiKeyId)?.name || "API Key"}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[200px]">
                    {runtimeKeys.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">暂无可用 Key</div>
                    ) : (
                      runtimeKeys.map((key) => (
                        <DropdownMenuItem
                          key={key.id}
                          onSelect={() => setSelectedApiKeyId(key.id)}
                        >
                          <span className="min-w-0 flex-1 truncate">{key.name || `Key #${key.id}`}</span>
                          {key.id === selectedApiKeyId && <span className="text-xs text-primary">✓</span>}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="max-w-[260px] rounded-full"
                      disabled={selectedApiKeyId == null}
                    >
                      <span className="line-clamp-1 min-w-0 truncate text-ellipsis hidden sm:block">
                        {selectedChatModel?.name || selectedChatModel?.remark || selectedChatModel?.id || "选择模型"}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="min-w-[300px] p-1"
                  >
                    <div className="relative mb-1">
                      <IconSourceCode className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        onKeyDown={(event) => event.stopPropagation()}
                        placeholder="搜索模型…"
                        className="h-8 pl-8"
                      />
                    </div>
                    <div className="max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto">
                    {chatModels.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">当前 Key 暂无可用模型</div>
                    ) : filteredChatModels.length === 0 ? (
                      <div className="px-3 py-4 text-center text-sm text-muted-foreground">无匹配模型</div>
                    ) : (
                      filteredChatModels.map((model) => (
                        <DropdownMenuItem
                          key={model.id}
                          onSelect={() => setSelectedModelId(model.id)}
                          className="items-start gap-3"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">
                              {model.name || model.remark || model.id}
                            </span>
                            {(model.name || model.remark) && (
                              <span className="block truncate text-xs text-muted-foreground">{model.id}</span>
                            )}
                            {model.description && (
                              <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
                                {model.description}
                              </span>
                            )}
                          </span>
                          {model.id === selectedModelId && <span className="shrink-0 text-xs text-primary">✓</span>}
                        </DropdownMenuItem>
                      ))
                    )}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            {/* 项目模式：执行节点 → 模型（多选）→ MCP → 技能。 */}
            {mode === "project" && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="max-w-[260px] rounded-full">
                      <IconSourceCode className="size-4" />
                      <span className="line-clamp-1 min-w-0 truncate text-ellipsis hidden sm:block">
                        {nodes.find((node) => node.node_id === selectedNodeId)?.node_name || "选择执行节点"}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[240px]">
                    {nodes.filter((node) => node.node_role === "execution").map((node) => (
                      <DropdownMenuItem key={node.node_id} disabled={!isNodeUsable(node)} onSelect={() => setSelectedNodeId(node.node_id)}>
                        <span className="min-w-0 flex-1 truncate">{node.node_name || node.node_id}</span>
                        {!isNodeUsable(node) && <span className="text-xs text-destructive">不可用</span>}
                        {node.node_id === selectedNodeId && <span className="text-xs text-primary">✓</span>}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* 分支策略：自动创建 / 主分支 / 已有分支。已有分支时下拉真实分支。 */}
                {selectedProject?.git_identity_id && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="max-w-[220px] rounded-full">
                        <IconSourceCode className="size-4" />
                        <span className="line-clamp-1 min-w-0 truncate text-ellipsis hidden sm:block">
                          {branchMode === "auto" ? "自动创建分支" : branchMode === "existing" ? (branch || "已有分支") : "主分支"}
                        </span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-72 p-2">
                      <TaskBranchPicker
                        mode={branchMode}
                        onModeChange={setBranchMode}
                        branch={branch}
                        onBranchChange={setBranch}
                        gitIdentityId={selectedProject.git_identity_id}
                        repoFullName={selectedProject.full_name}
                        platform={selectedProject.platform}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* 模型多选：Task 携带整组模型，第一个为激活模型。 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="max-w-[260px] rounded-full"
                      disabled={selectedApiKeyId == null}
                    >
                      <IconSourceCode className="size-4" />
                      <span className="line-clamp-1 min-w-0 truncate text-ellipsis hidden sm:block">
                        {selectedModelIds.length === 0
                          ? "选择模型"
                          : selectedModelIds.length === 1
                            ? (chatModels.find((m) => m.id === selectedModelIds[0])?.name || selectedModelIds[0])
                            : `已选 ${selectedModelIds.length} 个模型`}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[300px] p-1">
                    <div className="relative mb-1">
                      <IconSourceCode className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        onKeyDown={(event) => event.stopPropagation()}
                        placeholder="搜索模型…"
                        className="h-8 pl-8"
                      />
                    </div>
                    <div className="max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto">
                    {chatModels.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">当前 Key 暂无可用模型</div>
                    ) : filteredChatModels.length === 0 ? (
                      <div className="px-3 py-4 text-center text-sm text-muted-foreground">无匹配模型</div>
                    ) : (
                      filteredChatModels.map((model) => (
                        <DropdownMenuItem
                          key={model.id}
                          onSelect={(event) => { event.preventDefault(); toggleModel(model.id); }}
                          className="items-start gap-3"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{model.name || model.remark || model.id}</span>
                            {(model.name || model.remark) && (
                              <span className="block truncate text-xs text-muted-foreground">{model.id}</span>
                            )}
                            {model.description && (
                              <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{model.description}</span>
                            )}
                          </span>
                          {selectedModelIds.includes(model.id) && <span className="shrink-0 text-xs text-primary">✓</span>}
                        </DropdownMenuItem>
                      ))
                    )}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* MCP 服务多选（与编辑器 session 配置同口径）。 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="rounded-full">
                      <IconSourceCode className="size-4" />
                      <span className="hidden sm:block">
                        MCP{selectedMcp.length > 0 ? ` · ${selectedMcp.length}` : ""}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72 p-2">
                    <EditorResourcePicker
                      label="MCP 服务"
                      items={mcpItems}
                      selected={selectedMcp}
                      onChange={setSelectedMcp}
                      // id 保留供 picker 判定勾选态；service_id 是服务端认的绑定形态
                      // （resolver 按它读 mcp_services 行、校验授权、构造 wire spec）。
                      mapItem={(item) => ({ id: item.id, service_id: Number(item.id) })}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* 插件多选（与 canonical 创建弹框同口径，取你分组已授权的）。 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="rounded-full">
                      <IconPlug className="size-4" />
                      <span className="hidden sm:block">
                        插件{selectedPlugins.length > 0 ? ` · ${selectedPlugins.length}` : ""}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72 p-2">
                    <EditorResourcePicker
                      label="插件"
                      items={pluginItems}
                      selected={selectedPlugins}
                      onChange={setSelectedPlugins}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* 技能多选（与 MCP / 插件同口径）。 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="rounded-full">
                      <IconBook className="size-4" />
                      <span className="hidden sm:block">
                        技能{selectedSkills.length > 0 ? ` · ${selectedSkills.length}` : ""}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72 p-2">
                    <EditorResourcePicker
                      label="技能"
                      items={skillItems}
                      selected={selectedSkills}
                      onChange={setSelectedSkills}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
          <div className="flex shrink-0 flex-row justify-end gap-2 self-end sm:self-auto">
            {!IS_OFFLINE_EDITION && (
              <VoiceInputButton
                disabled={false}
                onTextRecognized={(text) => setTaskContent(text)}
              />
            )}
            <Button size="sm" className="rounded-full" disabled={creatingTask || taskContentTooLong} onClick={handleExecuteButtonClick}>
              <span className="hidden sm:block">
                {mode === "chat" || mode === "agent" ? "发送" : t("taskWorkflow.input.execute")}
              </span>
              {creatingTask ? <Spinner /> : <IconSend />}
            </Button>
          </div>
        </InputGroupAddon>
      </InputGroup>
      {taskContentTooLong && (
        <div className="mt-1 px-1 text-xs text-destructive">
          {t("taskWorkflow.input.contentTooLongInline", {
            overCount: taskContentLength - MAX_TASK_CONTENT_LENGTH,
            maxCount: MAX_TASK_CONTENT_LENGTH,
          })}
        </div>
      )}
    </>
  );
}
