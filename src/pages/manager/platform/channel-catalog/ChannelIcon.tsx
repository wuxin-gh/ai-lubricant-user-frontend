import {
  Bot,
  Brain,
  Braces,
  Cloud,
  Code2,
  Cpu,
  Database,
  Flame,
  Globe2,
  Layers,
  MessageSquare,
  Rocket,
  Server,
  Sparkles,
  Terminal,
  Wand2,
} from "lucide-react"

const ICONS: Record<string, typeof Bot> = {
  bot: Bot,
  brain: Brain,
  cloud: Cloud,
  code: Code2,
  cpu: Cpu,
  database: Database,
  flame: Flame,
  globe: Globe2,
  layers: Layers,
  message: MessageSquare,
  rocket: Rocket,
  server: Server,
  sparkles: Sparkles,
  terminal: Terminal,
  wand: Wand2,
  json: Braces,
}

const PROTOCOL_ICONS: Record<string, string> = {
  openai: "bot",
  anthropic: "brain",
  gemini: "sparkles",
  responses: "json",
}

/** 图标值是否应渲染成 <img>：HTTP/HTTPS 图片 URL 或 base64 data URL。 */
export function isImageUrl(value: string | null | undefined): boolean {
  const v = (value || "").trim()
  if (!v) return false
  return /^https?:\/\//i.test(v) || /^data:image\//i.test(v)
}

/** 是否配置了可渲染的渠道图标：已知 lucide 图标键，或图片 URL。
 *  空字符串或未知名值视为未配置，列表页据此决定是否渲染图标位。 */
export function isChannelIconConfigured(value: string | null | undefined): boolean {
  const v = (value || "").trim()
  if (!v) return false
  return isImageUrl(v) || v in ICONS
}

const BUILTIN_ICONS: Record<string, string> = {
  "kimi-ai": "message",
  cloudflare: "cloud",
  "mimocode-free": "cpu",
  codex: "terminal",
  qwen: "message",
  xiaomi: "sparkles",
  jiekou: "layers",
  puter: "cloud",
  gemini: "sparkles",
  tabbit: "wand",
}


export function channelIconKey(input: {
  icon?: string | null
  builtin_type?: string | null
  id?: string | null
  category?: string | null
  protocols?: string[]
}): string {
  const rawIcon = (input.icon || "").trim()
  if (rawIcon && (ICONS[rawIcon] || isImageUrl(rawIcon))) return rawIcon
  const builtin = (input.builtin_type || "").trim().toLowerCase()
  if (builtin && BUILTIN_ICONS[builtin]) return BUILTIN_ICONS[builtin]
  const id = (input.id || "").trim().toLowerCase()
  if (id && BUILTIN_ICONS[id]) return BUILTIN_ICONS[id]
  const protocol = (input.protocols?.[0] || "").trim().toLowerCase()
  if (protocol && PROTOCOL_ICONS[protocol]) return PROTOCOL_ICONS[protocol]
  const category = (input.category || "").trim().toLowerCase()
  if (category.includes("image")) return "wand"
  if (category.includes("video")) return "rocket"
  if (category.includes("语音")) return "message"
  return "server"
}

export function ChannelIcon(props: { name?: string | null; className?: string }) {
  const raw = (props.name || "").trim()
  if (isImageUrl(raw)) {
    return (
      <img
        src={raw}
        alt=""
        className={props.className}
        onError={(e) => {
          const el = e.currentTarget
          el.style.display = "none"
          // 让父容器继续展示占位：父容器有内置 fallback（如 Server 图标背景）。
        }}
      />
    )
  }
  const Icon = ICONS[raw] || Server
  return <Icon className={props.className} />
}
