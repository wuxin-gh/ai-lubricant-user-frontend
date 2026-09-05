import { IconAlertTriangle, IconChevronDown, IconChevronUp, IconCircleCheck } from "@tabler/icons-react"
import { Spinner } from "@/components/ui/spinner"
import type { MessageType } from "./message"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useMemo, useState, type ReactNode } from "react"
import { ConstsCliName } from "@/api/Api"
import * as fallbackRender from "./toolcalls/fallback"
import * as opencodeSearchRender from "./toolcalls/opencode_search"
import * as opencodeReadRender from "./toolcalls/opencode_read"
import * as opencodeEditRender from "./toolcalls/opencode_edit"
import * as claudeEditRender from "./toolcalls/claude_edit"
import * as claudeReadRender from "./toolcalls/claude_read"
import * as claudeBashRender from "./toolcalls/claude_bash"
import * as claudeGrepRender from "./toolcalls/claude_grep"
import * as claudeGlobRender from "./toolcalls/claude_glob"
import * as claudeWriteRender from "./toolcalls/claude_write"
import * as opencodeFetchRender from "./toolcalls/opencode_fetch"
import * as opencodeLoadSkillRender from "./toolcalls/opencode_load_skill"
import * as applyPatchRender from "./toolcalls/apply_patch"
import * as internalReportUserAbuseRender from "./toolcalls/internal_report_user_abuse"
import * as internalWebsearchRender from "./toolcalls/internal_websearch"
import * as internalImgsearchRender from "./toolcalls/internal_imgsearch"
import * as internalImageAnalysisRender from "./toolcalls/internal_image_analysis"
import { taskDetailT } from "./task-i18n"
import { outputText } from "./item-to-message"

type ToolCallRenderer = {
  match: (message: MessageType, cli?: ConstsCliName) => boolean
  renderTitle: (message: MessageType) => ReactNode
  renderDetail: (message: MessageType) => ReactNode
  expandable?: boolean | ((message: MessageType) => boolean)
}

const imageAnalysisCreateTaskTitles = new Set([
  "monkeycode-ai_MonkeyCode__image_analysis_create_task",
])

const imageAnalysisGetResultTitles = new Set([
  "monkeycode-ai_MonkeyCode__image_analysis_get_result",
])

const getPatchUpdatedFileLabel = (message: MessageType) => {
  const files = message.data.rawOutput?.metadata?.files
  if (Array.isArray(files) && files.length > 0) {
    return files
      .map((file) => file?.relativePath || file?.filePath)
      .filter((filePath): filePath is string => typeof filePath === "string" && filePath.trim().length > 0)
      .join(", ")
  }

  const title = message.data.title ?? ""
  return title
    .split("\n")
    .slice(1)
    .map((line) => line.replace(/^[A-Z]+\s+/, "").trim())
    .filter(Boolean)
    .join(", ")
}

const getPatchUpdatedDiff = (message: MessageType) => {
  const diff = message.data.rawOutput?.metadata?.diff
  if (typeof diff === "string" && diff.trim().length > 0) {
    return diff
  }

  const files = message.data.rawOutput?.metadata?.files
  if (Array.isArray(files)) {
    const fileDiff = files
      .map((file) => file?.patch)
      .filter((patch): patch is string => typeof patch === "string" && patch.trim().length > 0)
      .join("\n")
    if (fileDiff.trim().length > 0) {
      return fileDiff
    }
  }

  return ""
}

const toolCallRenderers: ToolCallRenderer[] = [
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "monkeycode-ai_internal__report_user_abuse"
    ),
    renderTitle: internalReportUserAbuseRender.renderTitle,
    renderDetail: internalReportUserAbuseRender.renderDetail,
    expandable: false,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "mcaiBuiltin_request_preview"
    ),
    renderTitle: (message) => {
      const port = message.data.rawInput?.port
      const portLabel = port !== undefined && port !== null
        ? `${port} ${taskDetailT("toolcall.port")}`
        : taskDetailT("toolcall.port")
      return taskDetailT("toolcall.previewRequest", { portLabel })
    },
    renderDetail: fallbackRender.renderDetail,
    expandable: false,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "mcaiBuiltin_background_terminal_list"
    ),
    renderTitle: () => taskDetailT("toolcall.backgroundList"),
    renderDetail: fallbackRender.renderDetail,
    expandable: false,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "mcaiBuiltin_background_terminal_create"
    ),
    renderTitle: () => taskDetailT("toolcall.backgroundCreate"),
    renderDetail: fallbackRender.renderDetail,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "mcaiBuiltin_background_terminal_output_path"
    ),
    renderTitle: () => taskDetailT("toolcall.backgroundOutput"),
    renderDetail: fallbackRender.renderDetail,
    expandable: false,
  },
  {
    match: applyPatchRender.match,
    renderTitle: applyPatchRender.renderTitle,
    renderDetail: applyPatchRender.renderDetail,
    expandable: (message) => message.data.status !== "pending" && message.data.status !== "failed",
  },
  {
    match: (message) => (
      !!message.data.title?.startsWith("Success. Updated the following files:")
    ),
    renderTitle: (message) => {
      const fileLabel = getPatchUpdatedFileLabel(message)
      return taskDetailT("toolcall.editFileWithLabel", { fileLabel: fileLabel ? ` "${fileLabel}"` : "" })
    },
    renderDetail: (message) => {
      const diff = getPatchUpdatedDiff(message)
      const patchText = typeof message.data.rawInput?.patchText === "string" ? message.data.rawInput.patchText : ""
      if (diff || patchText) {
        return applyPatchRender.renderPatchContent(diff || patchText)
      }

      return (
        <pre className="whitespace-pre-wrap break-words p-3 text-xs">
          {message.data.rawInput?.patchText || taskDetailT("toolcall.patchEmpty")}
        </pre>
      )
    },
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "monkeycode-ai_MonkeyCode__websearch_aisearch"
    ),
    renderTitle: internalWebsearchRender.renderTitle,
    renderDetail: internalWebsearchRender.renderDetail,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "monkeycode-ai_MonkeyCode__websearch_search"
    ),
    renderTitle: internalWebsearchRender.renderTitle,
    renderDetail: internalWebsearchRender.renderDetail,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "monkeycode-ai_MonkeyCode__imgsearch_search"
    ),
    renderTitle: internalImgsearchRender.renderTitle,
    renderDetail: internalImgsearchRender.renderDetail,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "monkeycode-ai_MonkeyCode__image_generate_text_to_image"
    ),
    renderTitle: (message) => {
      const prompt = message.data.rawInput?.prompt ?? message.data.rawInput?.query ?? message.data.rawInput?.description
      return typeof prompt === "string" && prompt.trim().length > 0
        ? `${taskDetailT("toolcall.generateImage")} "${prompt.trim()}"`
        : taskDetailT("toolcall.generateImage")
    },
    renderDetail: fallbackRender.renderDetail,
    expandable: false,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "monkeycode-ai_MonkeyCode__image_generate_query_task"
    ),
    renderTitle: () => taskDetailT("toolcall.queryImageProgress"),
    renderDetail: fallbackRender.renderDetail,
    expandable: false,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && imageAnalysisCreateTaskTitles.has(message.data.title ?? "")
    ),
    renderTitle: internalImageAnalysisRender.renderTitle,
    renderDetail: internalImageAnalysisRender.renderDetail,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && imageAnalysisGetResultTitles.has(message.data.title ?? "")
    ),
    renderTitle: internalImageAnalysisRender.renderResultTitle,
    renderDetail: internalImageAnalysisRender.renderResultDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameOpencode && message.data.kind === "search",
    renderTitle: opencodeSearchRender.renderTitle,
    renderDetail: opencodeSearchRender.renderDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameOpencode && message.data.kind === "read",
    renderTitle: opencodeReadRender.renderTitle,
    renderDetail: opencodeReadRender.renderDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameOpencode && message.data.kind === "edit",
    renderTitle: opencodeEditRender.renderTitle,
    renderDetail: opencodeEditRender.renderDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameOpencode && message.data.kind === "fetch",
    renderTitle: opencodeFetchRender.renderTitle,
    renderDetail: opencodeFetchRender.renderDetail,
  },
  {
    match: (message, cli) => (
      cli === ConstsCliName.CliNameOpencode
      && message.data.kind === "other"
      && !!message.data.title?.startsWith("Loaded skill: ")
    ),
    renderTitle: opencodeLoadSkillRender.renderTitle,
    renderDetail: opencodeLoadSkillRender.renderDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameClaude && message.data.kind === "execute",
    renderTitle: claudeBashRender.renderTitle,
    renderDetail: claudeBashRender.renderDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameClaude && message.data.kind === "search",
    renderTitle: claudeGrepRender.renderTitle,
    renderDetail: claudeGrepRender.renderDetail,
  },
  {
    match: (message, cli) => (
      cli === ConstsCliName.CliNameClaude
      && message.data.kind === "edit"
      && message.data.title === "Glob"
    ),
    renderTitle: claudeGlobRender.renderTitle,
    renderDetail: claudeGlobRender.renderDetail,
  },
  {
    match: (message, cli) => (
      cli === ConstsCliName.CliNameClaude
      && message.data.kind === "edit"
      && message.data.title === "Write"
    ),
    renderTitle: claudeWriteRender.renderTitle,
    renderDetail: claudeWriteRender.renderDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameClaude && message.data.kind === "edit",
    renderTitle: claudeEditRender.renderTitle,
    renderDetail: claudeEditRender.renderDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameClaude && message.data.kind === "read",
    renderTitle: claudeReadRender.renderTitle,
    renderDetail: claudeReadRender.renderDetail,
  },
]

/** One-line preview shown under a collapsed tool call: the first useful line of
 * the result (or the key argument), so the user gets a hint without expanding. */
function previewText(message: MessageType): string {
  const output = outputText(message.data.rawOutput)
  if (output) {
    const firstLine = output.split(/\r?\n/).find((line) => line.trim()) ?? ""
    if (firstLine) return firstLine.length > 240 ? `${firstLine.slice(0, 240)}…` : firstLine
  }
  const input = message.data.rawInput
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>
    for (const key of ["command", "file_path", "pattern", "query", "path"]) {
      if (typeof record[key] === "string" && (record[key] as string).trim()) {
        return `${key}: ${record[key] as string}`
      }
    }
  }
  return "点击展开查看详情"
}

export const ToolCallMessageItem = ({ message, cli }: { message: MessageType, cli?: ConstsCliName }) => {
  const renderer = toolCallRenderers.find((item) => item.match(message, cli)) ?? {
    renderTitle: fallbackRender.renderTitle,
    renderDetail: fallbackRender.renderDetail,
    expandable: true,
  }
  
  const renderStatus = () => {
    switch (message.data.status) {
      case 'in_progress':
        return <Spinner className="size-4" />
      case 'pending':
        return <Spinner className="size-4" />
      case 'completed':
        return <IconCircleCheck className="size-4" />
      case 'failed':
        return <IconAlertTriangle className="size-4" />
    }
  }
  
  const title = useMemo(() => {
    return renderer.renderTitle(message)
  }, [message, renderer])

  const detail = useMemo(() => {
    return renderer.renderDetail(message)
  }, [message, renderer])

  const [open, setOpen] = useState(false)
  const rendererExpandable = typeof renderer.expandable === "function"
    ? renderer.expandable(message)
    : renderer.expandable
  const expandable = message.data.kind === "edit" && (message.data.status === "pending" || message.data.status === "failed")
    ? false
    : rendererExpandable

  if (expandable === false) {
    return (
      <div className="w-full max-w-[80%]">
        <div className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2">
          {renderStatus()}
          <span className="min-w-0 flex-1 whitespace-normal line-clamp-1 break-all text-xs leading-4">
            {title}
          </span>
        </div>
      </div>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full max-w-[80%]">
      <div className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 hover:bg-muted/30 transition-colors">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer outline-none"
          >
            {renderStatus()}
            <span className="min-w-0 flex-1 whitespace-normal line-clamp-1 break-all text-xs leading-4">
              {title}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {open ? (
                <IconChevronUp className="size-4" />
              ) : (
                <IconChevronDown className="size-4" />
              )}
            </span>
          </button>
        </CollapsibleTrigger>
      </div>
      {!open && (
        <div className="mt-0.5 max-h-16 overflow-hidden rounded-md border border-border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
          <div className="line-clamp-2 whitespace-pre-wrap break-all">
            {previewText(message)}
          </div>
        </div>
      )}
      <CollapsibleContent>
        <div className="mt-1 rounded-md border border-border bg-muted/30 text-xs max-h-[50vh] overflow-auto">
          {detail}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
