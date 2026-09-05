import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import {
  Plus,
  Send,
  Settings2,
  X,
  Square,
  MessageSquare,
  ImageIcon,
  Video,
  Volume2,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
  ChevronsUpDown,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { formatTokens } from "@/utils/common"
import {
  listChatConversations,
  createChatConversation,
  getChatConversation,
  deleteChatConversation,
  updateChatConversation,
  appendChatMessage,
  listChatModels,
  listUsableKeys,
  chatSendStream,
  chatMedia,
  DEFAULT_CHAT_SETTINGS,
  type ChatConversation,
  type ChatMode,
  type ChatSettings,
  type ChatMediaItem,
  type AvailableModel,
  type RuntimeKeyItem,
} from "@/api/agentClient"

import {
  ChatMessageBubble,
  type ChatDisplayMessage,
  type ChatMessageStatus,
  type ChatTokenUsage,
} from "@/components/console/chat/chat-message-list"

// ── 常量 ──────────────────────────────────────────────────────────────
const MODE_OPTIONS: { value: ChatMode; label: string; icon: typeof MessageSquare }[] = [
  { value: "chat", label: "对话", icon: MessageSquare },
  { value: "image", label: "图片", icon: ImageIcon },
  { value: "video", label: "视频", icon: Video },
  { value: "tts", label: "语音", icon: Volume2 },
]

const IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024", "1792x1024", "1024x1792", "512x512"]
const VIDEO_SIZES = ["1280x720", "1920x1080", "720x1280", "1080x1920", "1024x1024"]
const TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "ash", "ballad", "coral", "sage", "verse"]
const TTS_FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm"]
// 生成模型按 output_modalities 匹配当前模式
const MODALITY_MAP: Record<ChatMode, string> = { chat: "text", image: "image", video: "video", tts: "audio" }

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

function formatTime(value?: string) {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })
}

// blob: URL 是会话内临时对象，落库无意义；只存可回放的 url/b64
function toPersistableMedia(items?: ChatMediaItem[] | null): ChatMediaItem[] | null {
  if (!items || items.length === 0) return null
  const keep = items
    .map((item) => ({
      type: item.type,
      url: item.url && !item.url.startsWith("blob:") ? item.url : undefined,
      b64: item.b64,
      mimeType: item.mimeType,
    }))
    .filter((item) => item.url || item.b64)
  return keep.length > 0 ? keep : null
}

// ── 主页面 ──────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialConversationId = searchParams.get("conversationId")
  // 智能任务快捷入口带过来的首条消息：会话已在入口建好，这里只负责发出第一条。
  // 用 ref 在挂载时快照一次，避免 selectConversation 重写 URL 把 send 参数抹掉后取不到。
  const initialSendTextRef = useRef(searchParams.get("send") || "")
  const initialSendText = initialSendTextRef.current
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(initialConversationId)
  const [messages, setMessages] = useState<ChatDisplayMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS)
  const [settingsDraft, setSettingsDraft] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS)
  const [settingsDraftConvId, setSettingsDraftConvId] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [convToDelete, setConvToDelete] = useState<string | null>(null)

  const [runtimeKeys, setRuntimeKeys] = useState<RuntimeKeyItem[]>([])
  const [models, setModels] = useState<AvailableModel[]>([])

  const abortRef = useRef<(() => void) | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const activeConvIdRef = useRef(activeConvId)
  activeConvIdRef.current = activeConvId
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // 初始加载：runtime keys + 对话列表
  useEffect(() => {
    listUsableKeys()
      .then((keys) => {
        const enabled = keys.filter((k) => !k.disabled)
        setRuntimeKeys(enabled)
        if (enabled.length > 0) {
          setSettings((s) => (s.apiKeyId ? s : { ...s, apiKeyId: enabled[0].id }))
        }
      })
      .catch(() => setRuntimeKeys([]))
    refreshConversations()
  }, [])

  // 当前编辑态的 key 变化后拉取可用模型
  const editorApiKeyId = settingsOpen ? settingsDraft.apiKeyId : settings.apiKeyId
  useEffect(() => {
    if (!editorApiKeyId) {
      setModels([])
      return
    }
    listChatModels(editorApiKeyId)
      .then((list) => {
        setModels(list)
        const applyFirstAvailableModel = (current: ChatSettings) => {
          if (current.model && list.some((m) => m.id === current.model)) return current
          return { ...current, model: list[0]?.id || "" }
        }
        if (settingsOpen) {
          setSettingsDraft(applyFirstAvailableModel)
        } else {
          setSettings(applyFirstAvailableModel)
        }
      })
      .catch(() => setModels([]))
  }, [editorApiKeyId, settingsOpen])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // 卸载时中断
  useEffect(() => () => abortRef.current?.(), [])

  const refreshConversations = useCallback(() => {
    listChatConversations()
      .then(setConversations)
      .catch(() => setConversations([]))
  }, [])

  const handleSettingsOpenChange = useCallback((open: boolean) => {
    if (!open && savingSettings) return
    if (open) {
      setSettingsDraft({ ...settingsRef.current })
      setSettingsDraftConvId(activeConvIdRef.current)
    }
    setSettingsOpen(open)
  }, [savingSettings])

  const saveSettings = useCallback(async () => {
    const targetConvId = settingsDraftConvId
    const draft = { ...settingsDraft }
    setSavingSettings(true)
    try {
      if (targetConvId) {
        await updateChatConversation(targetConvId, { chat_settings: draft })
        if (activeConvIdRef.current !== targetConvId) return
        refreshConversations()
      } else if (activeConvIdRef.current !== targetConvId) {
        return
      }
      setSettings(draft)
      setSettingsOpen(false)
      toast.success("对话设置已保存")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存对话设置失败")
    } finally {
      setSavingSettings(false)
    }
  }, [refreshConversations, settingsDraft, settingsDraftConvId])

  // 按当前模式过滤模型（output_modalities）
  const filteredModels = useMemo(() => {
    const mode = settingsOpen ? settingsDraft.mode : settings.mode
    const need = MODALITY_MAP[mode]
    return models.filter((m) => {
      const out = m.output_modalities
      if (!out || out.length === 0) return mode === "chat"
      return out.includes(need)
    })
  }, [models, settings.mode, settingsDraft.mode, settingsOpen])

  const hasDraftChanges = useMemo(() => {
    return JSON.stringify(settingsDraft) !== JSON.stringify(settings)
  }, [settings, settingsDraft])

  const selectConversation = useCallback(async (convId: string) => {
    if (settingsOpen || savingSettings) return
    setActiveConvId(convId)
    setSearchParams({ conversationId: convId }, { replace: true })
    try {
      const { conversation, messages: msgs } = await getChatConversation(convId)
      setMessages(
        msgs.map((m) => ({
          id: String(m.id),
          role: m.role,
          content: m.content,
          status: (m.status as ChatMessageStatus) || "done",
          error: m.error || undefined,
          media: m.media || undefined,
          model: m.model || undefined,
          createdAt: m.created_at,
        })),
      )
      if (conversation.chat_settings) {
        setSettings((s) => ({ ...s, ...conversation.chat_settings }))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载对话失败")
    }
  }, [savingSettings, setSearchParams, settingsOpen])

  // 深链恢复：从智能任务快捷入口带 conversationId 进来时，打开该会话。
  const restoredConvRef = useRef<string | null>(null)
  useEffect(() => {
    if (!initialConversationId || restoredConvRef.current === initialConversationId) return
    restoredConvRef.current = initialConversationId
    void selectConversation(initialConversationId)
  }, [initialConversationId, selectConversation])

  const newConversation = useCallback(() => {
    if (settingsOpen || savingSettings) return
    setActiveConvId(null)
    setMessages([])
    setSearchParams({}, { replace: true })
  }, [savingSettings, setSearchParams, settingsOpen])

  const removeConversation = useCallback(
    async (convId: string) => {
      try {
        await deleteChatConversation(convId)
        if (convId === activeConvId) newConversation()
        refreshConversations()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "删除失败")
      }
    },
    [activeConvId, newConversation, refreshConversations],
  )

  // 确保有一个 chat 会话，返回其 id
  const ensureConversation = useCallback(async (): Promise<string> => {
    if (activeConvId) return activeConvId
    const conv = await createChatConversation({
      title: "新对话",
      model: settingsRef.current.model,
      chat_settings: settingsRef.current,
    })
    setActiveConvId(conv.id)
    refreshConversations()
    return conv.id
  }, [activeConvId, refreshConversations])

  const persistRound = useCallback(
    async (convId: string, userText: string, assistant: ChatDisplayMessage) => {
      try {
        await appendChatMessage(convId, { role: "user", content: userText, status: "done" })
        await appendChatMessage(convId, {
          role: "assistant",
          content: assistant.content,
          status: assistant.status,
          error: assistant.error,
          media: toPersistableMedia(assistant.media),
          model: assistant.model,
        })
        await updateChatConversation(convId, { chat_settings: settingsRef.current })
        refreshConversations()
      } catch {
        // 持久化失败不阻塞对话
      }
    },
    [refreshConversations],
  )

  const sendChat = useCallback(async (convId: string, userText: string) => {
    const st = settingsRef.current
    if (!st.apiKeyId) {
      toast.error("请先在设置中选择 API Key")
      return
    }
    const history = messages
      .filter((m) => m.status === "done" && m.content)
      .map((m) => ({ role: m.role, content: m.content }))
    const reqMessages = [
      ...(st.systemPrompt ? [{ role: "system", content: st.systemPrompt }] : []),
      ...history,
      { role: "user", content: userText },
    ]
    const assistantId = makeId()
    const assistantCreatedAt = new Date().toISOString()
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", status: "streaming", createdAt: assistantCreatedAt }])

    const { response, abort } = chatSendStream({
      api_key_id: st.apiKeyId,
      model: st.model,
      messages: reqMessages,
      temperature: st.temperature,
      max_tokens: st.maxTokens,
    })
    abortRef.current = abort

    let acc = ""
    let usage: ChatTokenUsage | undefined
    try {
      const resp = await response
      if (!resp.ok || !resp.body) {
        const detail = await resp.text().catch(() => "")
        throw new Error(detail || `HTTP ${resp.status}`)
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data:")) continue
          const data = trimmed.slice(5).trim()
          if (data === "[DONE]") continue
          try {
            const chunk = JSON.parse(data)
            if (chunk.error) throw new Error(chunk.error.message || "上游错误")
            const delta = chunk.choices?.[0]?.delta?.content
            if (delta) {
              acc += delta
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m)),
              )
            }
            if (chunk.usage) usage = chunk.usage
          } catch (err) {
            if (err instanceof Error && err.message !== "Unexpected end of JSON input") {
              // 局部解析失败忽略，SSE 分片常见
            }
          }
        }
      }
      const finalMsg: ChatDisplayMessage = { id: assistantId, role: "assistant", content: acc, status: "done", usage, model: st.model, createdAt: assistantCreatedAt }
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? finalMsg : m)))
      await persistRound(convId, userText, finalMsg)
    } catch (e) {
      const errText = e instanceof Error ? e.message : "发送失败"
      const finalMsg: ChatDisplayMessage = { id: assistantId, role: "assistant", content: acc, status: "error", error: errText, model: st.model, createdAt: assistantCreatedAt }
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? finalMsg : m)))
      await persistRound(convId, userText, finalMsg)
    } finally {
      abortRef.current = null
    }
  }, [messages, persistRound])

  const sendMediaMessage = useCallback(async (convId: string, userText: string, mode: ChatMode) => {
    const st = settingsRef.current
    if (!st.apiKeyId) {
      toast.error("请先在设置中选择 API Key")
      return
    }
    const assistantId = makeId()
    const assistantCreatedAt = new Date().toISOString()
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", status: "pending", createdAt: assistantCreatedAt }])
    try {
      const payload: Parameters<typeof chatMedia>[0] = {
        api_key_id: st.apiKeyId,
        mode: mode as "image" | "video" | "tts",
        model: st.model,
      }
      if (mode === "image") {
        payload.prompt = userText
        payload.size = st.imageSize
        payload.n = st.imageN
      } else if (mode === "video") {
        payload.prompt = userText
        payload.size = st.videoSize
        payload.seconds = st.videoSeconds
      } else {
        payload.input = userText
        payload.voice = st.ttsVoice
        payload.response_format = st.ttsFormat
        payload.speed = st.ttsSpeed
      }
      const result = await chatMedia(payload)
      const media = extractMedia(result, mode)
      const finalMsg: ChatDisplayMessage = { id: assistantId, role: "assistant", content: "", status: "done", media, model: st.model, createdAt: assistantCreatedAt }
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? finalMsg : m)))
      await persistRound(convId, userText, finalMsg)
    } catch (e) {
      const errText = e instanceof Error ? e.message : "生成失败"
      const finalMsg: ChatDisplayMessage = { id: assistantId, role: "assistant", content: "", status: "error", error: errText, model: st.model, createdAt: assistantCreatedAt }
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? finalMsg : m)))
      await persistRound(convId, userText, finalMsg)
    }
  }, [persistRound])

  const handleSend = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim()
    if (!text || loading) return
    if (!settings.model) {
      toast.error("请先在设置中选择模型")
      return
    }
    if (textOverride === undefined) setInput("")
    setLoading(true)
    const userMsg: ChatDisplayMessage = { id: makeId(), role: "user", content: text, status: "done", createdAt: new Date().toISOString() }
    setMessages((prev) => [...prev, userMsg])
    try {
      const convId = await ensureConversation()
      if (settings.mode === "chat") {
        await sendChat(convId, text)
      } else {
        await sendMediaMessage(convId, text, settings.mode)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "发送失败")
    } finally {
      setLoading(false)
    }
  }, [input, loading, settings.model, settings.mode, ensureConversation, sendChat, sendMediaMessage])

  const stop = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setLoading(false)
  }, [])

  // 智能任务快捷入口：会话在入口已建好并带 ?conversationId&send=，进来后自动把首条
  // 消息发出去（等模型就绪，避免「请先选择模型」）。只触发一次，随后清掉 send 参数。
  const autoSentRef = useRef(false)
  useEffect(() => {
    if (autoSentRef.current || !initialSendText || !settings.model) return
    autoSentRef.current = true
    const text = initialSendText
    const next = new URLSearchParams(searchParams)
    next.delete("send")
    setSearchParams(next, { replace: true })
    void handleSend(text)
  }, [initialSendText, settings.model, searchParams, setSearchParams, handleSend])

  const renderConversationRow = (conv: ChatConversation) => (
    <div
      key={conv.id}
      className={cn(
        "group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
        activeConvId === conv.id && "bg-accent",
      )}
      onClick={() => selectConversation(conv.id)}
    >
      <div className="min-w-0 flex-1 truncate">{conv.title || "新对话"}</div>
      <span className="shrink-0 text-xs text-muted-foreground">{formatTime(conv.updated_at)}</span>
      <button
        type="button"
        className="shrink-0 opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation()
          setConvToDelete(conv.id)
        }}
      >
        <X className="size-3.5 text-muted-foreground hover:text-destructive" />
      </button>
    </div>
  )

  const totalUsage = useMemo(() => {
    return messages.reduce(
      (acc, m) => {
        if (m.usage) {
          acc.input += m.usage.prompt_tokens || 0
          acc.output += m.usage.completion_tokens || 0
        }
        return acc
      },
      { input: 0, output: 0 },
    )
  }, [messages])

  const currentModeLabel = MODE_OPTIONS.find((o) => o.value === settings.mode)?.label || "对话"

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* 侧栏：对话列表 */}
      {sidebarOpen && (
        <div className="flex w-64 shrink-0 flex-col rounded-lg border bg-card">
          <div className="flex gap-2 p-2">
            <Button variant="outline" className="min-w-0 flex-1 justify-start" onClick={newConversation}>
              <Plus className="size-4" /> 新建对话
            </Button>
            <Sheet open={settingsOpen} onOpenChange={handleSettingsOpenChange}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="icon" className="shrink-0" aria-label="对话设置">
                      <Settings2 className="size-4" />
                    </Button>
                  </SheetTrigger>
                </TooltipTrigger>
                <TooltipContent>对话设置</TooltipContent>
              </Tooltip>
              <SheetContent className="flex w-[380px] flex-col gap-0 overflow-y-auto sm:max-w-[380px]">
                <SheetHeader>
                  <SheetTitle>对话设置</SheetTitle>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <SettingsForm
                    settings={settingsDraft}
                    setSettings={setSettingsDraft}
                    runtimeKeys={runtimeKeys}
                    filteredModels={filteredModels}
                  />
                </div>
                <SheetFooter className="flex-row justify-end gap-2 border-t">
                  <Button
                    variant="outline"
                    onClick={() => handleSettingsOpenChange(false)}
                    disabled={savingSettings}
                  >
                    取消
                  </Button>
                  <Button
                    onClick={() => void saveSettings()}
                    disabled={savingSettings || !hasDraftChanges}
                  >
                    {savingSettings ? (
                      <>
                        <Spinner className="size-4" /> 保存中
                      </>
                    ) : (
                      "保存"
                    )}
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </div>
          <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
            {conversations.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">暂无对话</div>
            ) : (
              <div className="flex flex-col gap-0.5 p-1">
                {conversations.map(renderConversationRow)}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {/* 主聊天区 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
        {/* 头部 */}
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setSidebarOpen((v) => !v)}>
            {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </Button>
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MessageSquare className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="truncate text-sm font-medium">聊天 · {currentModeLabel}</div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 gap-1.5 px-2 text-[11px] font-normal text-muted-foreground"
                    aria-label={`Token 用量：输入 ${totalUsage.input}，输出 ${totalUsage.output}`}
                  >
                    <span>输入 {formatTokens(totalUsage.input)}</span>
                    <span>输出 {formatTokens(totalUsage.output)}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-1">
                    <div>输入 Token：{totalUsage.input.toLocaleString("zh-CN")}</div>
                    <div>输出 Token：{totalUsage.output.toLocaleString("zh-CN")}</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {settings.model || "未选择模型"}
            </div>
          </div>
          {loading && <Spinner className="size-4" />}
        </div>

        {/* 消息列表 */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex w-full flex-col gap-4 px-5 py-6">
            {messages.length === 0 ? (
              <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <MessageSquare className="size-6" />
                </div>
                <p className="text-sm">
                  {settings.mode === "chat"
                    ? "开始一段新对话吧"
                    : `输入提示词生成${currentModeLabel}`}
                </p>
              </div>
            ) : (
              messages.map((m) => <ChatMessageBubble key={m.id} message={m} />)
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* 输入栏 */}
        <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent px-4 pb-4 pt-2">
          <div className="w-full rounded-2xl border bg-card p-3 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={
                settings.mode === "chat"
                  ? "输入消息，Enter 发送，Shift+Enter 换行"
                  : `输入${currentModeLabel}提示词`
              }
              className="min-h-[60px] max-h-40 resize-none overflow-y-auto border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <div className="mt-2 flex items-center justify-end">
              {loading ? (
                <Button variant="destructive" size="sm" className="rounded-xl" onClick={stop}>
                  <Square className="size-4" /> 停止
                </Button>
              ) : (
                <Button size="sm" className="rounded-xl" onClick={() => void handleSend()} disabled={!input.trim()}>
                  <Send className="size-4" /> {settings.mode === "chat" ? "发送" : "生成"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={!!convToDelete} onOpenChange={(o) => !o && setConvToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除对话</AlertDialogTitle>
            <AlertDialogDescription>删除后不可恢复，确认删除该对话？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const id = convToDelete
                setConvToDelete(null)
                if (id) await removeConversation(id)
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// 从媒体生成结果里抽取 ChatMediaItem[]
function extractMedia(result: Record<string, unknown>, mode: ChatMode): ChatMediaItem[] {
  const items: ChatMediaItem[] = []
  if (mode === "tts") {
    const audio = result.audio as string | undefined
    if (audio) {
      const ct = (result.content_type as string) || "audio/mpeg"
      items.push({ type: "audio", b64: audio, mimeType: ct })
    }
    return items
  }
  // image / video：OpenAI 风格 {data:[{url|b64_json}]}
  const data = (result.data as Array<Record<string, unknown>>) || []
  const type = mode === "image" ? "image" : "video"
  for (const d of data) {
    const url = d.url as string | undefined
    const b64 = (d.b64_json as string) || (d.b64 as string) || undefined
    if (url || b64) items.push({ type, url, b64 })
  }
  return items
}

// ── 可搜索单选下拉 ─────────────────────────────────────────────────────
// Popover + Command（cmdk 按 keywords/value 自动过滤），触发器占满整行。
// 每项支持副标题（description）多行展示，用于模型的一段说明。
interface SearchableOption {
  value: string
  label: string
  description?: string
  keywords?: string[]
}

function SearchableSelect({
  value,
  options,
  placeholder,
  searchPlaceholder = "搜索...",
  emptyText = "无匹配项",
  onChange,
}: {
  value: string
  options: SearchableOption[]
  placeholder: string
  searchPlaceholder?: string
  emptyText?: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-auto min-h-9 w-full justify-between px-2.5 py-1.5 font-normal"
        >
          <span className="flex min-w-0 flex-col items-start">
            {selected ? (
              <>
                <span className="truncate">{selected.label}</span>
                {selected.description && (
                  <span className="truncate text-xs text-muted-foreground">
                    {selected.description}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  keywords={[o.label, ...(o.keywords || [])]}
                  onSelect={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  <Check className={cn("size-4 shrink-0", o.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{o.label}</span>
                    {o.description && (
                      <span className="truncate text-xs text-muted-foreground">{o.description}</span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ── 设置表单 ──────────────────────────────────────────────────────────
function SettingsForm({
  settings,
  setSettings,
  runtimeKeys,
  filteredModels,
}: {
  settings: ChatSettings
  setSettings: React.Dispatch<React.SetStateAction<ChatSettings>>
  runtimeKeys: RuntimeKeyItem[]
  filteredModels: AvailableModel[]
}) {
  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      {/* 模式 */}
      <div className="space-y-1.5">
        <Label>模式</Label>
        <div className="grid grid-cols-4 gap-1">
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon
            return (
              <button
                key={opt.value}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md border py-2 text-xs transition-colors",
                  settings.mode === opt.value ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent",
                )}
                onClick={() => setSettings((s) => ({ ...s, mode: opt.value }))}
              >
                <Icon className="size-4" />
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* API Key —— 占满整行，支持搜索 */}
      <div className="space-y-1.5">
        <Label>API Key</Label>
        <SearchableSelect
          value={settings.apiKeyId ? String(settings.apiKeyId) : ""}
          placeholder="选择 API Key"
          searchPlaceholder="搜索 Key..."
          emptyText="无匹配的 Key"
          onChange={(v) => setSettings((s) => ({ ...s, apiKeyId: Number(v) }))}
          options={runtimeKeys.map((k) => ({
            value: String(k.id),
            label: k.name || `Key #${k.id}`,
            description: k.key_masked,
            keywords: [k.key_masked],
          }))}
        />
        {runtimeKeys.length === 0 && (
          <p className="text-xs text-muted-foreground">暂无可用 Key，请先在设置中创建 API Key</p>
        )}
      </div>

      {/* 模型 —— 占满整行，支持搜索，展示模型说明 */}
      <div className="space-y-1.5">
        <Label>模型</Label>
        <SearchableSelect
          value={settings.model}
          placeholder="选择模型"
          searchPlaceholder="搜索模型..."
          emptyText="当前模式无可用模型"
          onChange={(v) => setSettings((s) => ({ ...s, model: v }))}
          options={filteredModels.map((m) => ({
            // 展示模型 ID 为主标题，后端合成的说明（上下文/能力）作副标题。
            value: m.id,
            label: m.id,
            description: m.description || m.name || undefined,
            keywords: [m.id, m.name || "", m.description || ""].filter(Boolean),
          }))}
        />
        {filteredModels.length === 0 && (
          <p className="text-xs text-muted-foreground">当前模式无可用模型</p>
        )}
      </div>

      {/* chat 参数 */}
      {settings.mode === "chat" && (
        <>
          <div className="space-y-1.5">
            <Label>Temperature: {settings.temperature.toFixed(2)}</Label>
            <Slider
              min={0}
              max={2}
              step={0.05}
              value={[settings.temperature]}
              onValueChange={([v]) => setSettings((s) => ({ ...s, temperature: v }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Max Tokens</Label>
            <Input
              type="number"
              value={settings.maxTokens}
              onChange={(e) => setSettings((s) => ({ ...s, maxTokens: Number(e.target.value) || 0 }))}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>流式输出</Label>
            <Switch checked={settings.stream} onCheckedChange={(v) => setSettings((s) => ({ ...s, stream: v }))} />
          </div>
          <div className="space-y-1.5">
            <Label>系统提示词</Label>
            <Textarea
              value={settings.systemPrompt}
              onChange={(e) => setSettings((s) => ({ ...s, systemPrompt: e.target.value }))}
              placeholder="可选"
              className="min-h-[80px]"
            />
          </div>
        </>
      )}

      {/* image 参数 */}
      {settings.mode === "image" && (
        <>
          <div className="space-y-1.5">
            <Label>尺寸</Label>
            <Select value={settings.imageSize} onValueChange={(v) => setSettings((s) => ({ ...s, imageSize: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_SIZES.map((sz) => (
                  <SelectItem key={sz} value={sz}>
                    {sz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>数量</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={settings.imageN}
              onChange={(e) => setSettings((s) => ({ ...s, imageN: Number(e.target.value) || 1 }))}
            />
          </div>
        </>
      )}

      {/* video 参数 */}
      {settings.mode === "video" && (
        <>
          <div className="space-y-1.5">
            <Label>尺寸</Label>
            <Select value={settings.videoSize} onValueChange={(v) => setSettings((s) => ({ ...s, videoSize: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_SIZES.map((sz) => (
                  <SelectItem key={sz} value={sz}>
                    {sz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>时长（秒）</Label>
            <Input
              type="number"
              min={1}
              max={60}
              value={settings.videoSeconds}
              onChange={(e) => setSettings((s) => ({ ...s, videoSeconds: Number(e.target.value) || 1 }))}
            />
          </div>
        </>
      )}

      {/* tts 参数 */}
      {settings.mode === "tts" && (
        <>
          <div className="space-y-1.5">
            <Label>声音</Label>
            <Select value={settings.ttsVoice} onValueChange={(v) => setSettings((s) => ({ ...s, ttsVoice: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTS_VOICES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>格式</Label>
            <Select value={settings.ttsFormat} onValueChange={(v) => setSettings((s) => ({ ...s, ttsFormat: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTS_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>语速: {settings.ttsSpeed.toFixed(2)}x</Label>
            <Slider
              min={0.25}
              max={4}
              step={0.05}
              value={[settings.ttsSpeed]}
              onValueChange={([v]) => setSettings((s) => ({ ...s, ttsSpeed: v }))}
            />
          </div>
        </>
      )}
    </div>
  )
}
