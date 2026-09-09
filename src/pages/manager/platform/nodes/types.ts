/**
 * 节点管理页的共享 UI 类型与常量。
 *
 * 三种创建入口对应三种 onboard 角色：
 * - 纯分组容器 → passive_management（无凭证、不安装、只归拢执行节点）
 * - 管理节点客户端 → management（有凭证、装客户端拨号连回、能启停执行节点）
 * - 执行节点 → execution（有凭证、跑任务、必须归属某个管理节点）
 *
 * 列表投影后 passive_management 与 management 都归一成 role="management"，靠
 * NodeInfo.is_passive 区分（见 @admin-port/api/nodes）。
 */
import type { NodeStartupMethod } from "@/@admin-port/api/nodes"

/** 顶部创建入口 / 入驻弹窗要处理的节点种类。 */
export type NodeKind = "container" | "management" | "execution"

export const ROLE_LABEL: Record<string, string> = {
  execution: "执行节点",
  management: "管理节点",
  ios_host: "iOS 设备主机",
}

export const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: "待审批", className: "text-orange-600 dark:text-orange-400" },
  approved: { label: "可用", className: "text-green-600 dark:text-green-400" },
  revoked: { label: "不可用", className: "text-muted-foreground" },
  unknown: { label: "未知", className: "text-muted-foreground" },
}

export const OS_LABEL: Record<string, string> = {
  linux: "Linux",
  darwin: "macOS",
  windows: "Windows",
}

export const ARCH_LABEL: Record<string, string> = {
  amd64: "x86_64 / amd64",
  arm64: "ARM64",
}

/** 节点上报的编辑器/Provider 友好名。未知值直出。 */
export const EDITOR_LABEL: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  cursor: "Cursor",
  openai: "OpenAI",
  anthropic: "Anthropic",
}

/** 一个带客户端节点（执行 / 管理客户端）入驻弹窗提交的表单值。 */
export interface OnboardFormValues {
  node_name: string
  /** 仅执行节点用：归属的管理节点 id。 */
  manager_node_id: string
}

/** 执行节点默认安装方式：一键脚本自识别平台。 */
export const EXECUTION_DEFAULT_METHOD: NodeStartupMethod = "standalone"
/** 管理客户端默认安装方式：只支持容器化。 */
export const MANAGEMENT_DEFAULT_METHOD: NodeStartupMethod = "docker"

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ""
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** 节点上报的能力标签形状（capabilities）。均为字符串，缺省即未上报。 */
export interface NodeCaps {
  os?: string
  arch?: string
  hostname?: string
  cpu?: string
  cpu_cores?: string
  memory_total?: string
  client_version?: string
  providers?: string
  /** 节点自报的内网 IPv4。 */
  internal_ip?: string
  /** 节点自报的公网 IPv4（三个网站一致后确认）。 */
  public_ip?: string
  /** 节点自报的公网 IPv6（三个网站一致后确认）。 */
  public_ipv6?: string
  /** 服务端视角看到的对端地址（代理感知，可能带端口）。 */
  server_seen_address?: string
  /** 节点在注册握手时上报的每个编辑器（CLI）探测出的权限方式列表。 */
  editors?: EditorCapability[]
  /** 节点是否开启系统内置环境（env_mode=system，注册时上报的能力位）。 */
  system_env?: string
  /** macOS + Xcode 节点上报的 xcodebuild 版本（hostTools 探针）；空则无构建能力。 */
  xcodebuild_version?: string
  [key: string]: string | EditorCapability[] | undefined
}

/** 编辑器权限方式的语义画像（CLI 探测时上报，用于驱动权限说明文案）。 */
export interface EditorModeSemantics {
  can_read?: boolean
  can_edit_workspace?: boolean
  can_run_commands?: boolean
  requires_approval?: boolean
  network_access?: boolean
}

/** 单个权限方式：id 透传给节点 runtime（如 --mode <id>），label 供 UI 展示。 */
export interface EditorModeSpec {
  id: string
  label: string
  source?: string
  native?: Record<string, string>
  semantics?: EditorModeSemantics
}

/** 节点上报的单个编辑器（CLI）能力：它探测出的可用权限方式集合。 */
export interface EditorCapability {
  provider: string
  version?: string
  modes: EditorModeSpec[]
  supports_interactive?: boolean
  supports_model_switch?: boolean
  probe_status?: string
  probe_error?: string
  probed_at?: string
}

/**
 * 节点网络地址明细：始终展示客户端内网、公网 IPv4、公网 IPv6 与服务端检测地址。
 * 缺项以「尚未上报」占位而非隐藏，这样三项状态一目了然——旧版本节点或探测失败时
 * 能看出是哪一项没上报，节点带新二进制重连后自动填上。
 */
export function nodeNetwork(caps: NodeCaps | undefined | null): { label: string; value: string }[] {
  const c = caps || {}
  return [
    { label: "客户端内网 IP", value: (c.internal_ip || "").trim() || "尚未上报" },
    { label: "客户端公网 IPv4", value: (c.public_ip || "").trim() || "尚未上报" },
    { label: "客户端公网 IPv6", value: (c.public_ipv6 || "").trim() || "尚未上报" },
    { label: "服务端检测到的 IP", value: (c.server_seen_address || "").trim() || "尚未上报" },
  ]
}

/** 系统信息：`OS / Arch`；未知枚举原样展示，无上报时返回空串。 */
export function machineSystem(caps: NodeCaps | undefined | null): string {
  const c = caps || {}
  return [OS_LABEL[c.os || ""] || c.os, ARCH_LABEL[c.arch || ""] || c.arch]
    .filter(Boolean)
    .join(" / ")
}

/** 机器信息主行：`hostname · OS/Arch`；无上报时返回空串。 */
export function machineInfoLine(caps: NodeCaps | undefined | null): string {
  const c = caps || {}
  return [c.hostname, machineSystem(c)].filter(Boolean).join(" · ")
}

/**
 * 详情页稳定展示的机器事实。字段缺失时保留该行并明确标记未上报，避免把
 * “节点没有上报”误看成“页面不支持这个字段”。
 */
export function machineFactRows(
  caps: NodeCaps | undefined | null,
  missing = "尚未上报",
): { key: string; label: string; value: string; reported: boolean }[] {
  const c = caps || {}
  const cpu = c.cpu || c.cpu_cores
    ? [c.cpu, c.cpu_cores ? `${c.cpu_cores} 核` : ""].filter(Boolean).join(" · ")
    : ""
  const memoryBytes = Number(c.memory_total)
  const memory = c.memory_total
    ? Number.isFinite(memoryBytes) && memoryBytes > 0
      ? formatBytes(memoryBytes)
      : c.memory_total
    : ""
  const values = [
    { key: "hostname", label: "主机名", value: (c.hostname || "").trim() },
    { key: "system", label: "系统", value: machineSystem(c) },
    { key: "cpu", label: "CPU", value: cpu },
    { key: "memory", label: "内存", value: memory },
    { key: "client_version", label: "节点客户端版本", value: (c.client_version || "").trim() },
  ]
  return values.map((row) => ({ ...row, reported: Boolean(row.value), value: row.value || missing }))
}

/** 规格明细：CPU 型号（核数）、内存、客户端版本。缺省项省略。 */
export function machineSpecs(caps: NodeCaps | undefined | null): { label: string; value: string }[] {
  return machineFactRows(caps)
    .filter((row) => row.reported && ["cpu", "memory", "client_version"].includes(row.key))
    .map((row) => ({
      label: row.key === "client_version" ? "客户端版本" : row.label,
      value: row.value,
    }))
}

/**
 * 列表行用的紧凑规格串：`8 核 · 16.0 GB · v1.2.3`。缺项省略；全无返回空串。
 * 与 machineSpecs 不同，这里用更短的值文案（不带 "CPU"/"内存" 标签），方便塞进副行。
 */
export function machineSpecsLine(caps: NodeCaps | undefined | null): string {
  const c = caps || {}
  const parts: string[] = []
  if (c.cpu_cores) parts.push(`${c.cpu_cores} 核`)
  else if (c.cpu) parts.push(c.cpu)
  if (c.memory_total) {
    const bytes = Number(c.memory_total)
    parts.push(Number.isFinite(bytes) && bytes > 0 ? formatBytes(bytes) : c.memory_total)
  }
  if (c.client_version) parts.push(`v${c.client_version.replace(/^v/i, "")}`)
  return parts.join(" · ")
}

/** 本系统支持安装/升级/版本上报的编辑器 CLI（与 Go agent.SupportedEditors 对齐）。 */
export const SUPPORTED_EDITORS = ["claude", "codex", "gemini", "opencode", "cursor"] as const

/** 已安装的编辑器/Provider 列表（来自 capabilities.providers 逗号串）。 */
export function nodeEditors(caps: NodeCaps | undefined | null): string[] {
  const providers = caps?.providers
  if (!providers) return []
  const str = String(providers)
  return str.split(",").map((p) => p.trim()).filter(Boolean).map((p) => EDITOR_LABEL[p.toLowerCase()] || p)
}

/**
 * 每个受支持编辑器的安装状态与版本。
 *
 * 「是否已安装」以 capabilities.providers 为真相源——那是节点用 LookPath 直接探测
 * 出来的，可靠；版本号则来自 capabilities["editor_version_<editor>"]（跑
 * `<editor> --version` 抓 semver，best-effort，可能缺失）。两者数据源不同：装了但
 * 版本探测失败时，installed=true 而 version="", UI 应显示「已安装·版本未知」而不是
 * 误判为未安装。
 */
export function nodeEditorVersions(
  caps: NodeCaps | undefined | null,
): { editor: string; label: string; version: string; installed: boolean }[] {
  const c = caps || {}
  const installedSet = new Set(
    String(c.providers || "")
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  )
  return SUPPORTED_EDITORS.map((editor) => {
    const version = String(c[`editor_version_${editor}`] || "").trim()
    return {
      editor,
      label: EDITOR_LABEL[editor] || editor,
      version,
      installed: installedSet.has(editor) || version !== "",
    }
  })
}

// ── Node.js/npm 版本门禁 ─────────────────────────────────────────────────────
// 编辑器 CLI（claude-code 等）的 postinstall 脚本用新 Node 语法，Node 10.x 这类
// 系统自带旧版上直接跑挂。低于下限的节点按「需升级」处理：审批门禁拦截 +
// 环境 Tab 给升级按钮（InstallHostTool 装 LTS 到自管目录，装即升级）。

/** Node.js 最低主版本（编辑器 CLI 与 runtime 的实际下限）。 */
export const NODE_FLOOR_MAJOR = 18
/** npm 最低主版本（随 Node LTS 自带，旧 npm 装不上新编辑器包）。 */
export const NPM_FLOOR_MAJOR = 9

/** 解析 "10.15.3" / "v10.15.3" 的主版本号；无版本/解析失败返回 -1（视为缺失）。 */
export function versionMajor(version: string | undefined | null): number {
  const m = String(version || "").trim().match(/^v?(\d+)/)
  return m ? Number(m[1]) : -1
}

/** Node.js 缺失或低于下限（审批按需升级拦截）。 */
export function nodeBelowFloor(caps: NodeCaps | undefined | null): boolean {
  const raw = String((caps || {}).node_version || "").trim()
  return !raw || versionMajor(raw) < NODE_FLOOR_MAJOR
}

/** npm 缺失或低于下限。 */
export function npmBelowFloor(caps: NodeCaps | undefined | null): boolean {
  const raw = String((caps || {}).npm_version || "").trim()
  return !raw || versionMajor(raw) < NPM_FLOOR_MAJOR
}
