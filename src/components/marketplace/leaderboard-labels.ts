/**
 * 外部榜单的共享标签与选项常量。
 *
 * 容器/草稿视图/已发布视图/详情抽屉四处都要渲染同一套中文标签，抽出来避免各写一份
 * 之后漂移（比如详情里显示「MCP」而卡片显示「mcp」）。
 */

/** 我们市场的四种安装形态。board 是「主题」，这里是「安装形态」，两者不等价。 */
export const MODULE_LABELS: Record<string, string> = {
  mcp: "MCP",
  skill: "Skill",
  prompt: "提示词",
  plugin: "插件",
}

/** 分类多选的固定顺序（与后端 TARGET_MODULES 对齐）。 */
export const ALL_MODULES = ["mcp", "skill", "plugin", "prompt"] as const

export type LeaderboardModuleOption = typeof ALL_MODULES[number]

/**
 * 把分类收口成数组。兼容：
 * - 新后端：string[]
 * - 未重启的旧后端：JSON 字符串（'["mcp","skill"]'）
 * - 更老数据：只有 target_module 单值列
 */
export function normalizeModules(raw: unknown, primary = ""): string[] {
  let value = raw
  if (typeof value === "string") {
    try { value = JSON.parse(value) } catch { value = value ? [value] : [] }
  }
  if (Array.isArray(value)) {
    const modules = value.map((m) => String(m)).filter((m) => (ALL_MODULES as readonly string[]).includes(m))
    if (modules.length > 0) return [...new Set(modules)]
  }
  return primary && (ALL_MODULES as readonly string[]).includes(primary) ? [primary] : []
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
}

/**
 * install_spec.skill 收口成 entries 形态（与后端 normalize_skill_install_spec 同口径，幂等）。
 * 旧单对象 {install_method, path, ref} → 一个 claude entry；已是 entries 形态 → 原样。
 */
export function normalizeSkillInstallSpec(spec: unknown): {
  install_method?: string
  ref?: string
  entries: SkillEntry[]
} {
  const source = (spec && typeof spec === "object" && !Array.isArray(spec)
    ? spec as Record<string, unknown>
    : {}) as Record<string, unknown>
  const skill = source.skill && typeof source.skill === "object" && !Array.isArray(source.skill)
    ? source.skill as Record<string, unknown>
    : undefined
  if (!skill) return { entries: [] }
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
