/**
 * 命令执行的展开区：上方一行命令，下方终端配色的输出。
 *
 * 以前命令和输出都塞在同一个 <pre> 里、同一种灰色，长输出滚上去之后就再也看不到
 * 刚才执行的是什么。现在命令行固定在顶部（深色终端头，带 `$` 提示符和 cwd），输出
 * 单独一块可滚动区域；退出码非 0 时把它标出来 —— 失败的命令过去只能靠读输出猜。
 */
import { useMemo, useState } from "react"
import { IconChevronRight, IconCopy } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { copyToClipboard } from "@/utils/clipboard"
import { taskDetailT } from "../task-i18n"

/** 超过这个行数就默认折叠，只显示尾部 —— 命令输出动辄几百行。 */
const COLLAPSE_OVER_LINES = 18
const TAIL_LINES = 12

export function CommandBlock({
  command,
  output,
  cwd,
  exitCode,
}: {
  command: string
  output: string
  cwd?: string
  exitCode?: number | null
}) {
  const lines = useMemo(() => output.replace(/\s+$/, "").split(/\r?\n/), [output])
  const long = lines.length > COLLAPSE_OVER_LINES
  const [showAll, setShowAll] = useState(false)
  const [copied, setCopied] = useState(false)
  const visible = long && !showAll ? lines.slice(-TAIL_LINES) : lines
  const failed = typeof exitCode === "number" && exitCode !== 0

  const copy = async () => {
    const ok = await copyToClipboard(command)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }
    // 剪贴板不可用（非 https / 无权限）时静默：命令本身在页面上可以手动选中复制。
  }

  return (
    <div className="flex flex-col">
      {/* 命令行：深色终端头，和下方输出连成一体，滚动时也不会被输出顶掉。 */}
      <div className="flex items-start gap-2 bg-zinc-900 px-3 py-2 font-mono text-[11.5px] leading-5 dark:bg-zinc-950">
        <span className="shrink-0 select-none text-emerald-400">$</span>
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-zinc-100">
          {cwd ? <span className="mr-1 text-zinc-500">{cwd}</span> : null}
          {command}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="shrink-0 cursor-pointer text-zinc-500 transition-colors hover:text-zinc-200"
          title={taskDetailT("toolcall.copyCommand")}
          aria-label={taskDetailT("toolcall.copyCommand")}
        >
          <IconCopy className="size-3.5" />
        </button>
      </div>

      {copied ? (
        <div className="bg-zinc-900 px-3 pb-1.5 font-mono text-[10.5px] text-emerald-400 dark:bg-zinc-950">
          {taskDetailT("toolcall.copied")}
        </div>
      ) : null}

      {/* 输出：等宽 + 深底，和命令区同一套配色，读起来就是一个终端。 */}
      <div className="max-h-[42vh] overflow-auto bg-zinc-950/95 px-3 py-2">
        {long && !showAll ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mb-1.5 flex cursor-pointer items-center gap-1 font-mono text-[10.5px] text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <IconChevronRight className="size-3" />
            {taskDetailT("toolcall.showAllLines", { count: lines.length })}
          </button>
        ) : null}
        <pre className="whitespace-pre-wrap break-all font-mono text-[11.5px] leading-5 text-zinc-300">
          {visible.join("\n") || taskDetailT("toolcall.commandOutputEmpty")}
        </pre>
      </div>

      {failed ? (
        <div className={cn(
          "border-t border-red-500/25 bg-red-500/10 px-3 py-1.5 font-mono text-[10.5px]",
          "text-red-600 dark:text-red-400",
        )}>
          {taskDetailT("toolcall.exitCode", { code: exitCode })}
        </div>
      ) : null}
    </div>
  )
}

/** 从 rawOutput 里取退出码（不同 runner 用不同字段名）。 */
export function exitCodeOf(rawOutput: unknown): number | null {
  if (!rawOutput || typeof rawOutput !== "object") return null
  const record = rawOutput as Record<string, unknown>
  for (const key of ["exit_code", "exitCode", "returncode", "code", "status"]) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return null
}
