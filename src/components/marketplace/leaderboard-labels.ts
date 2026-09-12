/**
 * 外部榜单的共享标签与选项常量。
 *
 * 容器/草稿视图/已发布视图/详情抽屉四处都要渲染同一套中文标签，抽出来避免各写一份
 * 之后漂移（比如详情里显示「MCP」而卡片显示「mcp」）。
 */

/** 我们市场的安装形态。board 是「主题」，这里是「安装形态」，两者不等价。
 * skills（技能集）已归入 plugin 容器——保留键仅作存量行展示兼容。 */
export const MODULE_LABELS: Record<string, string> = {
  mcp: "MCP",
  skill: "Skill",
  skills: "插件（技能集）",
  prompt: "提示词",
  plugin: "插件",
}

/** 来源（source）的中文标签。每个内容源/手动添加一个值，卡片顶部展示用。 */
export const SOURCE_LABELS: Record<string, string> = {
  "agent-leaderboard": "Agent-Leaderboard",
  "agency-agents": "agency-agents",
  "agency-agents-zh": "agency-agents-zh",
  "agentscope": "agentscope",
  "skillhub": "SkillHub",
  manual: "手动添加",
}

/** 编辑器/客户端的中性展示名。skill entries.editors、prompt providers、plugin provider 都用它。 */
export const EDITOR_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  cursor: "Cursor",
  gemini: "Gemini",
}

/** 分类单选的固定顺序（与后端 TARGET_MODULES 对齐）。skills 已归入 plugin 容器——
 * 不再作为新分类选项，仅 normalizeModules 兼容存量值。 */
export const ALL_MODULES = ["mcp", "skill", "plugin", "prompt"] as const

export type LeaderboardModuleOption = typeof ALL_MODULES[number]

/** normalizeModules 认识的值：新四类 + 存量 skills（读侧映射展示用）。 */
const _KNOWN_MODULES = [...ALL_MODULES, "skills"] as const

/**
 * 把分类收口成数组。兼容：
 * - 新后端：string[]
 * - 未重启的旧后端：JSON 字符串（'["mcp","skill"]'）
 * - 更老数据：只有 target_module 单值列
 * - 存量 skills 行：技能集已归 plugin 容器，读侧仍按原值透出（展示层标签兼容）。
 */
export function normalizeModules(raw: unknown, primary = ""): string[] {
  let value = raw
  if (typeof value === "string") {
    try { value = JSON.parse(value) } catch { value = value ? [value] : [] }
  }
  if (Array.isArray(value)) {
    const modules = value.map((m) => String(m)).filter((m) => (_KNOWN_MODULES as readonly string[]).includes(m))
    if (modules.length > 0) return [...new Set(modules)]
  }
  return primary && (_KNOWN_MODULES as readonly string[]).includes(primary) ? [primary] : []
}

/** JSONB 在旧服务进程上可能以字符串返回；统一收口成 external_data 对象。 */
export function normalizeExternalData(raw: unknown): Record<string, unknown> {
  let value = raw
  if (typeof value === "string") {
    try { value = JSON.parse(value) } catch { value = {} }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** skill 安装条目：一个仓库可产出 N 个可独立安装的 skill（技能包），各带目标编辑器。 */
export interface SkillEntry {
  name: string
  path: string
  entry: string
  editors: string[]
  /** 子技能说明（探针读 SKILL.md frontmatter description；展示/搜索用）。 */
  description?: string
}

/**
 * install_spec.skill 收口成 entries 形态（与后端 normalize_skill_install_spec 同口径，幂等）。
 * 旧单对象 {install_method, path, ref} → 一个 claude entry；已是 entries 形态 → 原样。
 *
 * 插件容器（原技能集）：落库后 install_spec 形如 ``{plugin: {...entries}}``——
 * entries 在 plugin 壳里时也读出来，让卡片/编辑弹框按容器展开子技能。
 */
export function normalizeSkillInstallSpec(spec: unknown): {
  install_method?: string
  ref?: string
  entries: SkillEntry[]
} {
  const source = (spec && typeof spec === "object" && !Array.isArray(spec)
    ? spec as Record<string, unknown>
    : {}) as Record<string, unknown>
  // skill 壳优先（单 skill / 旧集合形态）；否则 plugin 壳（插件容器）——纯 zip
  // 插件（plugin 壳无 entries）不认作容器，返回空。
  const skill = source.skill && typeof source.skill === "object" && !Array.isArray(source.skill)
    ? source.skill as Record<string, unknown>
    : undefined
  if (!skill) {
    const plugin = source.plugin && typeof source.plugin === "object" && !Array.isArray(source.plugin)
      ? source.plugin as Record<string, unknown>
      : undefined
    if (plugin && Array.isArray(plugin.entries) && plugin.entries.length > 0) {
      return {
        install_method: plugin.install_method ? String(plugin.install_method) : undefined,
        ref: plugin.ref ? String(plugin.ref) : undefined,
        entries: plugin.entries.map((e) => {
          const row = (e && typeof e === "object" ? e : {}) as Record<string, unknown>
          return {
            name: String(row.name || ""),
            path: String(row.path || ""),
            entry: String(row.entry || "SKILL.md"),
            editors: Array.isArray(row.editors) ? row.editors.map(String) : [],
            description: String(row.description || ""),
          }
        }),
      }
    }
    return { entries: [] }
  }
  const rawEntries = Array.isArray(skill.entries) ? skill.entries : []
  if (rawEntries.length > 0) {
    return {
      install_method: skill.install_method ? String(skill.install_method) : undefined,
      ref: skill.ref ? String(skill.ref) : undefined,
      entries: rawEntries.map((e) => {
        const row = (e && typeof e === "object" ? e : {}) as Record<string, unknown>
        return {
          name: String(row.name || ""),
          path: String(row.path || ""),
          entry: String(row.entry || "SKILL.md"),
          editors: Array.isArray(row.editors) ? row.editors.map(String) : [],
          description: String(row.description || ""),
        }
      }),
    }
  }
  // 旧单对象：path/ref → 一个 claude entry
  const path = String(skill.path || "").replace(/^\/+|\/+$/g, "")
  return {
    install_method: skill.install_method ? String(skill.install_method) : undefined,
    ref: skill.ref ? String(skill.ref) : undefined,
    entries: [{
      name: path ? path.split("/").pop() || "" : "",
      path,
      entry: "SKILL.md",
      editors: ["claude"],
    }],
  }
}

/**
 * 从 external_data 推分类（与后端 derive_target_modules 同口径）：
 * - 榜单类型必选：skills→skill、mcp→mcp、prompts→prompt
 * - 上游 category 里的 mcp/skill/prompt/plugin/extension 只负责追加
 * - frameworks/research 与 awesome 目录保持仅浏览
 */
export function deriveModulesFromExternal(
  raw: unknown,
  fallbackBoard = "",
  fallbackCategory = "",
): string[] {
  const external = normalizeExternalData(raw)
  const board = String(external.board || fallbackBoard || "").toLowerCase()
  const category = String(external.upstream_category || fallbackCategory || "").toLowerCase()
  const fullName = String(external.repo_full_name || "")
  const description = String(external.description || "")
  if (["frameworks", "research"].includes(board)
    || /\bawesome\b|\bcurated\b|\bcollection\b|\blist of\b|\bdirectory\b|\bresources\b/i.test(`${fullName} ${description}`)) {
    return []
  }
  const boardMap: Record<string, string> = { mcp: "mcp", skills: "skill", prompts: "prompt" }
  const result = boardMap[board] ? [boardMap[board]] : []
  const hints: Array<[string, string]> = [
    ["mcp", "mcp"], ["skill", "skill"], ["prompt", "prompt"],
    ["plugin", "plugin"], ["extension", "plugin"],
  ]
  for (const [keyword, module] of hints) {
    if (category.includes(keyword) && !result.includes(module)) result.push(module)
  }
  return result
}

/** 上游榜单。与后端 leaderboard_sync.BOARD_FILES 的键一一对应。 */
export const BOARD_LABELS: Record<string, string> = {
  skills: "Skills 榜",
  mcp: "MCP 榜",
  prompts: "提示词榜",
  frameworks: "开发框架榜",
  research: "研究程序榜",
  manual: "手动添加",
}

/** 配置里可多选的榜单，顺序即展示顺序。 */
export const ALL_BOARDS = ["skills", "mcp", "prompts", "frameworks", "research"] as const

/** 同步间隔档位（小时）。后端上下限 1–720，这里只给常用档，避免手输越界。 */
export const INTERVAL_OPTIONS = [
  { value: 1, label: "每小时" },
  { value: 6, label: "每 6 小时" },
  { value: 12, label: "每 12 小时" },
  { value: 24, label: "每天" },
  { value: 48, label: "每 2 天" },
  { value: 168, label: "每周" },
] as const

/** MCP 远程启动方式的合法 transport（与后端 _ALLOWED_TRANSPORTS 对齐）。 */
export const LAUNCH_TRANSPORTS = ["sse", "streamable-http"] as const

/**
 * 同步时间显示：把后端 UTC ISO 串（``...+00:00``）转成**当前客户端时区**。
 * 解析失败/为空回落原值——配置回落路径存的是历史字符串，格式可能不齐。
 */
export function fmtSyncAt(iso: string | null | undefined): string {
  const raw = String(iso || "").trim()
  if (!raw) return ""
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleString(undefined, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  })
}
