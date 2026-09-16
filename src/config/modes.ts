/**
 * 六模式信息架构：单一事实来源。
 *
 * 控制台不再按「用户端 /console」与「管理端 /manager」两套壳组织，而是按用户
 * 意图分成六个模式，每个模式一个 URL 前缀。同一模式内，管理项（adminOnly）
 * 与普通用户项共存，由导航按角色过滤。
 *
 * 前缀选择的关键约束：后端已占用 `/agent`（`agentClient.ts` 的 AGENT_BASE，
 * 且在 main.py 的 _API_PREFIXES 里），前端路由用它会刷新 404，故 Agent 模式
 * 走 `/agent-mode`。其余前缀均已逐一核对未被后端占用。
 *
 * 旧路径（/console/*、/manager/*）在 App.tsx 里保留 <Navigate> 重定向，书签
 * 与外部链接继续可用。
 */
import {
  BarChart3,
  Blocks,
  Bot,
  Boxes,
  FileCode2,
  FolderGit2,
  KeyRound,
  LayoutDashboard,
  Mail,
  MessageSquare,
  MessagesSquare,
  Network,
  Package,
  ScrollText,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  Waypoints,
} from "lucide-react"
import type { ComponentType } from "react"

export type ModeId = "llm" | "agent" | "coding" | "resources" | "devices" | "ops"

export type ModeNavItem = {
  /** 模式内相对路径，拼到 ModeDef.prefix 后面，如 "/keys" → "/llm/keys"。 */
  to: string
  /**
   * 可选 query 串（不带 `?`），拼到最终 href 后面。用于「同一路径、不同 Tab」的
   * 导航项（资源中心把二级 Tab 提为一级项时，5 项共用 /resources 只有 tab 不同）。
   * 匹配高亮时会一并比对 query，避免同一路径的多项同时高亮。
   */
  query?: string
  /**
   * 该项对应的 query 缺失时是否也算命中。用于「默认 Tab」：/resources 裸路径没有
   * `?tab=`，但实际渲染的就是默认 Tab（MCP），故 MCP 项要标 true，否则裸路径下
   * 侧栏一个项都不高亮。
   *
   * 注意只在路径**恰好等于**该项 base 时生效：/resources/admin、/resources/marketplace
   * 这些子路径不渲染默认 Tab，不能也算命中（否则子页与 MCP 项会同时高亮）。
   */
  queryDefault?: boolean
  labelKey: string
  fallback: string
  icon: ComponentType<{ className?: string }>
  /** 仅 role==admin（或应急管理员 token）可见。 */
  adminOnly?: boolean
  /** 仅非 admin 可见。 */
  userOnly?: boolean
  /** 仅在市场可写（服务端配了 github_token）时显示。 */
  marketplaceOnly?: boolean
  /** 仅离线版显示。 */
  offlineOnly?: boolean
}

export type ModeDef = {
  id: ModeId
  prefix: string
  labelKey: string
  fallback: string
  icon: ComponentType<{ className?: string }>
  items: ModeNavItem[]
  /**
   * 模式入口覆盖。缺省时入口 = 第一个导航项（modeEntryPath）。
   *
   * Coding 需要覆盖：它没有导航项，但模式入口不能是空——要走 /coding 的 index 路由，
   * 那里有「当前项目」分流逻辑（有就直达项目，没有才落在选择页）。
   */
  entry?: string
}

/** 模式内相对路径的拼接工具：modePath("llm", "/keys") → "/llm/keys"。 */
export function modePath(prefix: string, to: string): string {
  if (!to || to === "/") return prefix
  return `${prefix}${to.startsWith("/") ? "" : "/"}${to}`
}

/** 导航项的完整 href（含 query）：modeHref(mode, item) → "/resources?tab=market"。 */
export function modeHref(mode: ModeDef, item: ModeNavItem): string {
  const base = modePath(mode.prefix, item.to)
  return item.query ? `${base}?${item.query}` : base
}

/**
 * 导航项是否命中当前 URL。pathname 必须匹配；带 query 的项还要求 query 一致
 * （按项声明的键逐一比对），使 /resources 下 5 个 Tab 项互不抢高亮。
 */
export function modeItemMatches(mode: ModeDef, item: ModeNavItem, pathname: string, search: string): boolean {
  const base = modePath(mode.prefix, item.to)
  const normalized = pathname !== "/" ? pathname.replace(/\/$/, "") : pathname
  const pathHit = normalized === base || normalized.startsWith(`${base}/`)
  if (!pathHit) return false
  if (!item.query) return true
  const want = new URLSearchParams(item.query)
  const have = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  for (const [key, value] of want.entries()) {
    const actual = have.get(key)
    if (actual === null) {
      // 该项声明的键在 URL 里缺失：只有「默认 Tab」且路径恰好是本项 base 时才算命中
      // （子路径如 /resources/admin 不渲染默认 Tab，不能算）。
      if (item.queryDefault && normalized === base) continue
      return false
    }
    if (actual !== value) return false
  }
  return true
}

/** 模式入口（点模式名时跳的第一个导航项；ModeDef.entry 可覆盖）。 */
export function modeEntryPath(mode: ModeDef): string {
  if (mode.entry) return mode.entry
  const first = mode.items[0]
  return first ? modeHref(mode, first) : mode.prefix
}

export const MODES: ModeDef[] = [
  {
    id: "llm",
    prefix: "/llm",
    labelKey: "modes.llm.label",
    fallback: "供应商",
    icon: MessageSquare,
    items: [
      { to: "/chat", labelKey: "modes.llm.chat", fallback: "试跑对话", icon: MessageSquare },
      { to: "/dashboard", labelKey: "modes.llm.dashboard", fallback: "用量与额度", icon: BarChart3, adminOnly: true },
      { to: "/channels", labelKey: "modes.llm.channels", fallback: "供应商", icon: Boxes, adminOnly: true },
      { to: "/models", labelKey: "modes.llm.models", fallback: "模型元数据", icon: Waypoints, adminOnly: true },
      { to: "/routing", labelKey: "modes.llm.routing", fallback: "模型策略", icon: Network, adminOnly: true },
      { to: "/keys", labelKey: "modes.llm.keys", fallback: "密钥", icon: KeyRound, adminOnly: true },
      { to: "/request-logs", labelKey: "modes.llm.requestLogs", fallback: "请求日志", icon: ScrollText, adminOnly: true },
    ],
  },
  {
    id: "agent",
    // 不能是 /agent：后端 agentClient.ts 的 AGENT_BASE="/agent" 占用该前缀，
    // 且在 main.py 的 _API_PREFIXES 里，前端路由用它会刷新 404。
    prefix: "/agent-mode",
    labelKey: "modes.agent.label",
    fallback: "Agent",
    icon: Bot,
    // 「Agent 对话」入口已下线（原 /agent-mode/chat 路由与页面仍保留，供侧栏
    // 活跃 Agent 平铺列表 ?agentId= 深链进入；不再作为顶部导航项）。
    // 「对话记录」已移至运维（/ops/conversations）。
    items: [
      { to: "/manage", labelKey: "modes.agent.manage", fallback: "Agent 管理", icon: Boxes },
    ],
  },
  {
    id: "coding",
    prefix: "/coding",
    labelKey: "modes.coding.label",
    fallback: "Coding",
    icon: FileCode2,
    // 无导航项：Coding 的「切换项目」入口在侧栏模式选择器正下方（ProjectSwitcher
    // 按钮，显示当前项目名，点开弹框切换）。内容由侧栏项目树（NavProject，选任务）
    // 与主内容区（项目概览 / 任务详情）承担。
    items: [],
    // 点「Coding」走 /coding：有「上次进入的项目」就直达，否则落在项目选择页。
    entry: "/coding",
  },
  {
    id: "resources",
    prefix: "/resources",
    labelKey: "modes.resources.label",
    fallback: "资源管理",
    icon: Blocks,
    // 资源中心的二级 Tab 提为一级导航项（用户要求）：5 项共用 /resources 路径，
    // 只有 ?tab= 不同，由 modeItemMatches 按 query 区分高亮。
    items: [
      // 裸 /resources 渲染的就是 MCP（ResourceCenterShell 的 defaultTab），故 MCP 项
      // 标 queryDefault：没带 ?tab= 时也算它命中，避免裸路径下侧栏一个都不高亮。
      { to: "/", query: "tab=mcp", queryDefault: true, labelKey: "modes.resources.mcp", fallback: "MCP", icon: Blocks },
      { to: "/", query: "tab=skills", labelKey: "modes.resources.skills", fallback: "Skill", icon: Sparkles },
      { to: "/", query: "tab=plugins", labelKey: "modes.resources.plugins", fallback: "插件", icon: Package },
      { to: "/", query: "tab=prompts", labelKey: "modes.resources.prompts", fallback: "项目提示词", icon: ScrollText },
      { to: "/", query: "tab=market", labelKey: "modes.resources.market", fallback: "市场", icon: Store },
      { to: "/marketplace", labelKey: "modes.resources.marketplace", fallback: "市场管理", icon: Store, adminOnly: true, marketplaceOnly: true },
    ],
  },
  {
    id: "devices",
    prefix: "/devices",
    labelKey: "modes.devices.label",
    fallback: "设备工具",
    icon: Smartphone,
    // 页面内的四个工具 Tab 提为一级导航项（用户要求）：共用 /devices 路径，
    // 只有 ?kind= 不同，由 modeItemMatches 按 query 区分高亮。
    items: [
      { to: "/", query: "kind=cdp", queryDefault: true, labelKey: "modes.devices.browser", fallback: "浏览器", icon: Network },
      { to: "/", query: "kind=mail", labelKey: "modes.devices.mail", fallback: "邮箱", icon: Mail },
      { to: "/", query: "kind=android", labelKey: "modes.devices.android", fallback: "Android 控制", icon: Smartphone },
      { to: "/", query: "kind=ios", labelKey: "modes.devices.ios", fallback: "iOS 控制", icon: Smartphone },
    ],
  },
  {
    id: "ops",
    prefix: "/ops",
    labelKey: "modes.ops.label",
    fallback: "运维",
    icon: Server,
    items: [
      { to: "/nodes", labelKey: "modes.ops.nodes", fallback: "执行节点", icon: Server },
      // 项目列表与对话记录：原在 Coding / Agent 模式，收敛到运维统一查看。
      { to: "/projects", labelKey: "modes.ops.projects", fallback: "项目", icon: FolderGit2 },
      { to: "/conversations", labelKey: "modes.ops.conversations", fallback: "对话记录", icon: MessagesSquare, adminOnly: true },
      { to: "/overview", labelKey: "modes.ops.overview", fallback: "概览", icon: LayoutDashboard, adminOnly: true },
      { to: "/members", labelKey: "modes.ops.members", fallback: "用户", icon: Boxes, adminOnly: true },
      // 代理池 / 内网穿透：后端按 owner 隔离（普通用户只见自己的），对所有人可见。
      { to: "/proxy-pool", labelKey: "modes.ops.proxyPool", fallback: "代理池", icon: Network },
      { to: "/tunnels", labelKey: "modes.ops.tunnels", fallback: "内网穿透", icon: Network },
      { to: "/logs", labelKey: "modes.ops.logs", fallback: "系统日志", icon: ScrollText, adminOnly: true },
      { to: "/security", labelKey: "modes.ops.security", fallback: "安全", icon: ShieldCheck, adminOnly: true },
      { to: "/notifications", labelKey: "modes.ops.notifications", fallback: "通知中心", icon: Mail },
    ],
  },
]

/** 按 id 取模式定义。 */
export function getMode(id: ModeId): ModeDef | undefined {
  return MODES.find((mode) => mode.id === id)
}

/**
 * 从 pathname 反推当前模式：前缀最长匹配优先，避免 "/resources" 与
 * "/resources/admin" 这类包含关系误判。
 */
export function resolveModeFromPath(pathname: string): ModeDef | null {
  const normalized = pathname !== "/" ? pathname.replace(/\/$/, "") : pathname
  let best: ModeDef | null = null
  for (const mode of MODES) {
    if (normalized === mode.prefix || normalized.startsWith(`${mode.prefix}/`)) {
      if (!best || mode.prefix.length > best.prefix.length) best = mode
    }
  }
  return best
}
