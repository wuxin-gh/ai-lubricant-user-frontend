/**
 * 节点终端 AI 助手悬浮浮窗（薄壳）。
 *
 * 与市场管理页的 EmbeddedAgentChat 同样走 FloatingPanel + 气泡入口，但这里带上节点
 * 终端上下文：受控会话/消息按 nodeId 持久化，发送时取最新 cwd/terminal_id/recent
 * lines，Agent 命令运行时锁输入，并保留配置 Agent 的弹窗入口。新建 Agent 统一走
 * 管理页 (/console/agent-manager?create=1)，气泡内不放「新建」按钮。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { IconArrowLeft, IconShieldLock } from "@tabler/icons-react"
import { type TerminalHandle } from "@/components/common/terminal"
import { AgentConversation } from "@/components/console/agent/agent-conversation"
import { mergeAgentToolResults, type AgentDisplayMessage } from "@/components/console/agent/agent-message-list"
import {
  approvalFromRow,
  type AgentApprovalRequest,
} from "@/components/console/agent/agent-stream-events"
import { Button } from "@/components/ui/button"
import { FloatingPanel } from "@/components/ui/floating-panel"
import AgentManagerDialog from "@/pages/console/user/agent-manager-dialog"
import { NodeShellApproval } from "@/pages/manager/platform/nodes/node-shell-approval"
import ShellApprovalSettings from "@/components/console/settings/shell-approval"
import {
  getConversation,
  listAgents,
  listApprovals,
  type AgentInstance,
} from "@/api/agentClient"

function conversationStorageKey(nodeId: string): string {
  return `node-terminal-agent-conversation:${nodeId}`
}

export function NodeTerminalAgentChat({
  nodeId,
  nodeName,
  open,
  onOpenChange,
  terminalHandleRef,
  filePath,
  agentCommandRunning,
  scope = "admin",
  className,
}: {
  nodeId: string
  nodeName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  terminalHandleRef: React.RefObject<TerminalHandle | null>
  filePath: string
  agentCommandRunning: boolean
  /**
   * 「命令授权配置」视图的口径：
   * - `admin` → 该节点的免审清单（`/api/v1/admin/nodes/{id}/shell-approval`），管理员为节点配置
   * - `user`  → 当前用户自己的免审清单（`/api/v1/users/shell-approval`），只作用于本人发起的命令
   */
  scope?: "admin" | "user"
  /** 透给浮窗：嵌在弹框里的终端要抬层级，否则被 Dialog 的 z-50 盖住。 */
  className?: string
}) {
  const [agents, setAgents] = useState<AgentInstance[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)
  const [agentsError, setAgentsError] = useState("")
  const [chatMessages, setChatMessages] = useState<AgentDisplayMessage[]>([])
  const [chatConversationId, setChatConversationId] = useState<string | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)
  // 浮窗内切到「命令授权配置」视图：用 hidden 切换而不是卸载对话区，避免
  // 丢失输入草稿与滚动位置。授权配置只对执行节点有意义，但此处 nodeId 已由
  // 调用方保证是当前终端节点，无需额外判断角色。
  const [approvalView, setApprovalView] = useState(false)
  // 用 ref 透传最新文件目录，避免 getTerminalContext 闭包陈旧。
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath

  const refreshAgents = useCallback(() => {
    return listAgents()
      .then((items) => {
        const usable = items.filter((item) => item.enabled)
        setAgents(usable)
        setSelectedAgentId((current) => (
          current && usable.some((item) => item.id === current) ? current : null
        ))
        setAgentsError("")
      })
      .catch((error) => {
        setAgentsError(error instanceof Error ? error.message : String(error))
      })
  }, [])

  useEffect(() => {
    let cancelled = false
    listAgents()
      .then((items) => {
        if (cancelled) return
        const usable = items.filter((item) => item.enabled)
        setAgents(usable)
        setSelectedAgentId((current) => current && usable.some((item) => item.id === current) ? current : null)
      })
      .catch((error) => {
        if (!cancelled) setAgentsError(error instanceof Error ? error.message : String(error))
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!nodeId) return
    const saved = localStorage.getItem(conversationStorageKey(nodeId))
    if (!saved) return
    let cancelled = false
    setChatConversationId(saved)
    void Promise.all([getConversation(saved), listApprovals(saved)])
      .then(([detail, pending]) => {
        if (cancelled) return
        // 恢复历史消息：审批卡要挂在 assistant 消息上，和流式时一致，避免再单独列出。
        const restoredApprovals = pending.approvals
          .map((row) => approvalFromRow(row as unknown as Record<string, unknown>))
          .filter((item): item is AgentApprovalRequest => Boolean(item))
        const messages = detail.messages
          .filter((message) => message.role === "user" || message.role === "assistant")
        const lastAssistantIndex = messages.map((message) => message.role).lastIndexOf("assistant")
        const restored = messages.map<AgentDisplayMessage>((message, index) => {
          const isAssistant = message.role === "assistant"
          // 未决审批归到当前最后一条 assistant 消息上：历史上审批总是出现在
          // agent 生成命令那一轮，因此这样最贴近原语义。
          const approvals = isAssistant && index === lastAssistantIndex ? restoredApprovals.slice() : []
          return {
            id: String(message.id),
            role: message.role as "user" | "assistant",
            content: message.content || "",
            status: message.status,
            error: message.error || undefined,
            model: message.model,
            reasoning: message.reasoning || undefined,
            toolCalls: mergeAgentToolResults(message.tool_calls || [], message.tool_results),
            subagents: [],
            approvals,
          }
        })
        setChatMessages(restored)
        if (detail.conversation.agent_id) setSelectedAgentId(detail.conversation.agent_id)
      })
      .catch(() => {
        if (cancelled) return
        localStorage.removeItem(conversationStorageKey(nodeId))
        setChatConversationId(null)
      })
    return () => { cancelled = true }
  }, [nodeId])

  const getTerminalContext = useCallback(() => {
    const identity = terminalHandleRef.current?.getIdentity()
    return {
      cwd: filePathRef.current,
      terminalId: identity?.connected ? identity.terminalId : "",
      recentLines: terminalHandleRef.current?.getRecentLines(30) ?? [],
    }
  }, [terminalHandleRef])

  return (
    <FloatingPanel open={open} onOpenChange={onOpenChange} title="节点 AI 助手" storageKey={`node-agent-chat:${nodeId}`} className={className}>
      <div className="flex h-full min-h-0 flex-col">
        <div className={approvalView ? "hidden" : "flex h-full min-h-0 flex-col"}>
        {agentsError ? <div className="border-b px-3 py-2 text-xs text-destructive">Agent 加载失败：{agentsError}</div> : null}
        {!agentsError && agents.length === 0 ? <div className="border-b px-3 py-2 text-xs text-muted-foreground">暂无可用 Agent，请先配置 Agent、网关 Key 和模型。</div> : null}
        <AgentConversation
          agents={agents}
          selectedAgentId={selectedAgentId}
          onSelectedAgentIdChange={(id) => {
            if (nodeId) localStorage.removeItem(conversationStorageKey(nodeId))
            setChatMessages([])
            setChatConversationId(null)
            setSelectedAgentId(id)
          }}
          conversationId={chatConversationId}
          onConversationIdChange={(id) => {
            setChatConversationId(id)
            if (!nodeId) return
            if (id) localStorage.setItem(conversationStorageKey(nodeId), id)
            else localStorage.removeItem(conversationStorageKey(nodeId))
          }}
          messages={chatMessages}
          onMessagesChange={setChatMessages}
          getCreateConversationPayload={() => ({ title: `节点 ${nodeName || nodeId}`, node_id: nodeId })}
          getTerminalContext={getTerminalContext}
          historyNodeId={nodeId}
          inputDisabled={agentCommandRunning}
          placeholder="让 AI 操作当前节点..."
          emptyHint={{ title: "节点 AI 助手", desc: "可以让 AI 查看节点状态、读取文件或执行命令（执行命令需审批）。" }}
          onConfigureAgent={() => setManagerOpen(true)}
          onManageAgents={() => setManagerOpen(true)}
          composerActions={
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-lg"
              title="命令授权配置"
              onClick={() => setApprovalView(true)}
            >
              <IconShieldLock className="size-4" />
            </Button>
          }
          className="min-h-0 flex-1"
        />
        </div>
        <div className={approvalView ? "flex h-full min-h-0 flex-col" : "hidden"}>
          <div className="flex items-center gap-2 border-b px-2 py-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-lg"
              title="返回对话"
              onClick={() => setApprovalView(false)}
            >
              <IconArrowLeft className="size-4" />
            </Button>
            <span className="text-sm font-medium">命令授权配置</span>
            <span className="ml-auto truncate text-xs text-muted-foreground">{nodeName || nodeId}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {/* 管理端配的是「这个节点」的免审清单；用户侧只能配「自己」的。 */}
            {scope === "user" ? <ShellApprovalSettings /> : <NodeShellApproval nodeId={nodeId} />}
          </div>
        </div>
      </div>
      <AgentManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        initialAgentId={selectedAgentId}
        showAgentList
        onChanged={() => { void refreshAgents() }}
      />
    </FloatingPanel>
  )
}
