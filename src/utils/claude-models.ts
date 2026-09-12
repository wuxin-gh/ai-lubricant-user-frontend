/**
 * Claude Code CLI 内置模型别名表（从 claude.exe 二进制 strings 提取）。
 *
 * 这些名字经过 Claude Code 时会被静默替换为对应的完整型号名（如 opus →
 * claude-opus-4-8），导致网关收到的 model 与用户选择的自定义模型组名不符，
 * 路由到错误渠道。provider=claude 的任务必须禁止选择这些名字，引导用户
 * 改组名或为模型组添加不冲突的别名（如 custom-opus）后选择别名。
 */

/** 精确匹配的裸别名（不区分大小写）。 */
const EXACT = new Set(["opus", "sonnet", "haiku", "fast", "cheap", "fable", "mythos"])

/** 版本变体：opus 4.8 / sonnet 4.6 / haiku 4.5 / fable 5.1 / mythos preview 等。 */
const VERSION_RE = /^(opus|sonnet|haiku|fable|mythos)\s+(\d+(\.\d+)?|preview)$/i

/**
 * 返回 true 当 name 撞了 Claude Code 内置别名。
 * 完整模型 ID（claude-opus-4-8、glm-5.2、custom-opus）不受影响。
 */
export function isClaudeReservedModelAlias(name: string): boolean {
  const n = (name || "").trim().toLowerCase()
  if (!n) return false
  if (EXACT.has(n)) return true
  return VERSION_RE.test(n)
}

/** 置灰提示文案（前端复用，与后端 _CLAUDE_RESERVED_MODEL_HINT 对齐）。 */
export const CLAUDE_RESERVED_MODEL_HINT =
  "Claude Code 内置别名，会被自动替换。请将该模型组改名为 custom-opus 等，或添加别名后选择别名。"
