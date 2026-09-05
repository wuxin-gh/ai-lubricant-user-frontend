/**
 * 工具调用卡片的视觉归类：图标 + 配色 + 展开区风格。
 *
 * 以前所有工具调用长得一模一样（一个灰边框 + 一行文字），十几条堆在一起时读者要
 * 逐条读文字才知道刚才发生了什么。这里按「工具做的是哪一类事」给出可一眼区分的
 * 图标与色块，命令执行额外标记为终端风格（展开后用深色终端配色渲染输出）。
 */
import {
  IconBrain,
  IconFileDiff,
  IconFilePlus,
  IconFileText,
  IconPencil,
  IconPhoto,
  IconSearch,
  IconTerminal2,
  IconTool,
  IconTrash,
  IconWorld,
} from "@tabler/icons-react"
import type { MessageType } from "./message"

export interface ToolVisual {
  Icon: typeof IconTool
  /** 图标底色 + 前景色，工具类别的主要区分手段。 */
  chip: string
  /** 展开区用终端配色（深底等宽），只有命令执行走这一路。 */
  terminal?: boolean
}

const VISUALS = {
  execute: { Icon: IconTerminal2, chip: "bg-sky-500/12 text-sky-600 dark:text-sky-400", terminal: true },
  read: { Icon: IconFileText, chip: "bg-slate-500/12 text-slate-600 dark:text-slate-300" },
  edit: { Icon: IconPencil, chip: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  write: { Icon: IconFilePlus, chip: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  patch: { Icon: IconFileDiff, chip: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  search: { Icon: IconSearch, chip: "bg-violet-500/12 text-violet-600 dark:text-violet-400" },
  web: { Icon: IconWorld, chip: "bg-cyan-500/12 text-cyan-600 dark:text-cyan-400" },
  image: { Icon: IconPhoto, chip: "bg-pink-500/12 text-pink-600 dark:text-pink-400" },
  think: { Icon: IconBrain, chip: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400" },
  delete: { Icon: IconTrash, chip: "bg-red-500/12 text-red-600 dark:text-red-400" },
  other: { Icon: IconTool, chip: "bg-muted text-muted-foreground" },
} satisfies Record<string, ToolVisual>

/** 少数工具靠 kind 分不出来（都是 other），只能认名字。 */
function visualByTitle(title: string): ToolVisual | null {
  if (!title) return null
  if (title === "apply_patch" || title.startsWith("Success. Updated the following files:")) return VISUALS.patch
  if (title === "Write") return VISUALS.write
  if (/websearch|web_search|webfetch|fetch/i.test(title)) return VISUALS.web
  if (/imgsearch|image_analysis|image_generate/i.test(title)) return VISUALS.image
  if (/^mcaiBuiltin_background_terminal/.test(title) || /bash|shell|terminal|exec/i.test(title)) return VISUALS.execute
  if (/^Task$/.test(title) || /subagent|think/i.test(title)) return VISUALS.think
  if (/glob|grep|search/i.test(title)) return VISUALS.search
  if (/^Read$/.test(title) || /read/i.test(title)) return VISUALS.read
  return null
}

export function toolVisual(message: MessageType): ToolVisual {
  const title = typeof message.data.title === "string" ? message.data.title : ""
  const byTitle = visualByTitle(title)
  if (byTitle) return byTitle
  switch (message.data.kind) {
    case "execute":
      return VISUALS.execute
    case "read":
      return VISUALS.read
    case "edit":
      return title === "Write" ? VISUALS.write : VISUALS.edit
    case "search":
      return VISUALS.search
    case "fetch":
      return VISUALS.web
    case "delete":
    case "move":
      return VISUALS.delete
    case "think":
      return VISUALS.think
    default:
      return VISUALS.other
  }
}

/**
 * 把 `执行命令 "npm run build"` 拆成动作 + 目标两段。
 *
 * 所有 renderTitle 都按 `动作 "目标"` 拼字符串，然后卡片把整句塞进一行 line-clamp-1
 * ——命令稍长就只剩下 `执行命令 "cd /very/long/pa…`，真正要看的命令被截在省略号里。
 * 拆开后动作留在标题行，目标单独一行等宽显示，可占两行。引号之后的补充（grep 的
 * ` in <path>`）属于目标，一并归到第二行。
 */
export function splitToolTitle(title: string): { action: string; target: string } {
  const first = title.indexOf('"')
  const last = title.lastIndexOf('"')
  if (first === -1 || last <= first) return { action: title.trim(), target: "" }
  const action = title.slice(0, first).trim()
  if (!action) return { action: title.trim(), target: "" }
  const target = `${title.slice(first + 1, last)}${title.slice(last + 1)}`.trim()
  return { action, target: target || "" }
}

/** 命令执行的原始命令：字符串 / 数组（取最后一段）/ ACP 的 parsed_cmd。 */
export function commandOf(message: MessageType): string {
  const input = message.data.rawInput
  if (!input || typeof input !== "object") return ""
  const record = input as Record<string, unknown>
  if (typeof record.command === "string") return record.command
  if (Array.isArray(record.command) && record.command.length > 0) {
    const last = record.command[record.command.length - 1]
    if (typeof last === "string") return last
  }
  const parsed = record.parsed_cmd
  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && typeof parsed[0] === "object") {
    const cmd = (parsed[0] as Record<string, unknown>).cmd
    if (typeof cmd === "string") return cmd
  }
  return ""
}
