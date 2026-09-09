import { type DomainStackProfile, type DomainSubmoduleStack } from "@/api/Api"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * tag → 徽章配色（品牌近似色）。整串字面量让 tailwind 能扫描到。
 * 未列出的 tag（project_types / package_managers 等）走 FALLBACK_COLORS 按
 * 名字散列，同一 tag 颜色稳定。
 */
const TAG_COLORS: Record<string, string> = {
  // 语言
  python: "border-sky-600/30 bg-sky-600/10 text-sky-700 dark:text-sky-300",
  typescript: "border-blue-600/30 bg-blue-600/10 text-blue-700 dark:text-blue-300",
  javascript: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  go: "border-cyan-600/30 bg-cyan-600/10 text-cyan-700 dark:text-cyan-300",
  rust: "border-orange-700/30 bg-orange-700/10 text-orange-700 dark:text-orange-300",
  java: "border-red-700/30 bg-red-700/10 text-red-700 dark:text-red-300",
  kotlin: "border-purple-600/30 bg-purple-600/10 text-purple-700 dark:text-purple-300",
  swift: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  csharp: "border-violet-600/30 bg-violet-600/10 text-violet-700 dark:text-violet-300",
  cpp: "border-blue-800/30 bg-blue-800/10 text-blue-800 dark:text-blue-300",
  c: "border-slate-600/30 bg-slate-600/10 text-slate-700 dark:text-slate-300",
  ruby: "border-rose-600/30 bg-rose-600/10 text-rose-700 dark:text-rose-300",
  php: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  dart: "border-teal-600/30 bg-teal-600/10 text-teal-700 dark:text-teal-300",
  vue: "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300",
  svelte: "border-orange-600/30 bg-orange-600/10 text-orange-700 dark:text-orange-300",
  // 前端框架
  react: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  next: "border-slate-600/30 bg-slate-600/10 text-slate-700 dark:text-slate-300",
  nuxt: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  astro: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  // 后端框架
  express: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  nest: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  fastapi: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  django: "border-green-700/30 bg-green-700/10 text-green-700 dark:text-green-300",
  flask: "border-stone-600/30 bg-stone-600/10 text-stone-700 dark:text-stone-300",
  spring: "border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-300",
  gin: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  echo: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  fiber: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300",
  "actix-web": "border-orange-600/30 bg-orange-600/10 text-orange-700 dark:text-orange-300",
  rocket: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  rails: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  laravel: "border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-300",
  symfony: "border-slate-700/30 bg-slate-700/10 text-slate-700 dark:text-slate-300",
  // 桌面 / 移动
  electron: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  tauri: "border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-300",
  "react-native": "border-cyan-700/30 bg-cyan-700/10 text-cyan-700 dark:text-cyan-300",
  expo: "border-violet-600/30 bg-violet-600/10 text-violet-700 dark:text-violet-300",
  flutter: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  // 移动平台细分
  ios: "border-zinc-600/30 bg-zinc-600/10 text-zinc-700 dark:text-zinc-300",
  android: "border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-300",
  mobile_app: "border-lime-600/30 bg-lime-600/10 text-lime-700 dark:text-lime-300",
  // 容器
  docker: "border-blue-600/30 bg-blue-600/10 text-blue-700 dark:text-blue-300",
  "docker-compose": "border-teal-600/30 bg-teal-600/10 text-teal-700 dark:text-teal-300",
}

const FALLBACK_COLORS: string[] = [
  "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
]

function colorForTag(tag: string): string {
  const key = (tag || "").toLowerCase().trim()
  const preset = TAG_COLORS[key]
  if (preset) return preset
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length]
}

function TagBadge({ label, className }: { label: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("lowercase", colorForTag(label), className)}>
      {label}
    </Badge>
  )
}

interface StackBadgesProps {
  /** 技术栈 profile；null/未扫时渲染 null（调用方可另给占位文案）。 */
  stack?: DomainStackProfile | null
  /** 框架徽章上限，溢出折叠成 ``+N``；默认 3。 */
  max?: number
  /** 是否同时展示主语言徽章（默认 true）。列表行紧凑场景可关。 */
  showLanguage?: boolean
  /** 截断提示的 tooltip 文案（由调用方传入，避免本组件绑死 i18n 命名空间）。 */
  truncatedTitle?: string
  className?: string
}

/** profile → 完整标签集（语言 + 全部框架 + 形态 + 包管理器 + 容器，去重保序）。 */
function collectAllTags(stack: DomainStackProfile): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (v?: string) => {
    const key = (v || "").trim()
    if (key && !seen.has(key)) {
      seen.add(key)
      out.push(key)
    }
  }
  push(stack.primary_language)
  for (const fw of stack.frameworks ?? []) push(fw)
  for (const t of stack.project_types ?? []) push(t)
  for (const m of stack.package_managers ?? []) push(m)
  for (const c of stack.containers ?? []) push(c)
  return out
}

/**
 * 技术栈徽章组（console 项目页 + 市场候选池共用）。
 *
 * 展示：主语言 + ≤max 框架 + ``+N`` 溢出 + 可选截断提示标记，徽章按
 * 语言/框架配色。有被折叠的标签（或截断）时整组可悬停，tooltip 展开
 * 完整标签集（形态/包管理器/容器全量）。badge 文案是标识本身（小写）
 * 无需翻译；截断提示文案由调用方注入以解耦 i18n 命名空间。空 profile
 * 返回 ``null``，不占任何布局空间。
 */
const StackBadges = ({
  stack,
  max = 3,
  showLanguage = true,
  truncatedTitle,
  className,
}: StackBadgesProps) => {
  if (!stack) return null
  const lang = showLanguage ? (stack.primary_language || "").trim() : ""
  const frameworks = (stack.frameworks ?? []).filter(Boolean)
  if (!lang && frameworks.length === 0) return null

  const shown = frameworks.slice(0, max)
  const overflow = Math.max(0, frameworks.length - shown.length)

  const items: { key: string; label: string }[] = []
  if (lang) items.push({ key: `lang:${lang}`, label: lang })
  for (const fw of shown) items.push({ key: `fw:${fw}`, label: fw })
  const visibleLabels = new Set(items.map((i) => i.label))

  const row = (
    <div className={cn("flex flex-row flex-wrap items-center gap-1", className)}>
      {items.map(({ key, label }) => (
        <TagBadge key={key} label={label} />
      ))}
      {overflow > 0 && (
        <Badge variant="outline" className="text-muted-foreground">
          +{overflow}
        </Badge>
      )}
    </div>
  )

  // 没有隐藏内容就不包 tooltip，避免悬停弹一个与行内完全相同的列表。
  const all = collectAllTags(stack)
  const hasHidden = all.some((tag) => !visibleLabels.has(tag)) || !!stack.truncated
  if (!hasHidden) return row

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      {/* 换成浅色卡片底以保住彩色徽章的可读性（默认深底会吃掉暗色系徽章），
          隐藏箭头避免与卡片底色不匹配。 */}
      <TooltipContent className="flex max-w-sm flex-wrap gap-1 bg-popover text-popover-foreground shadow-md [&>svg]:hidden">
        {all.map((tag) => (
          <TagBadge key={`all:${tag}`} label={tag} />
        ))}
        {stack.truncated && truncatedTitle && (
          <span className="w-full text-xs text-muted-foreground">{truncatedTitle}</span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export { StackBadges }

interface ProjectStackBadgesProps {
  /** 项目根 profile（含 submodules）；null/未扫渲染 null。 */
  stack?: DomainStackProfile | null
  /** 根来源显示名（项目名）；缺省回退「主项目」。 */
  rootName?: string
  /** 行内标签上限，溢出折叠成 ``+N``；默认 8。 */
  max?: number
}

/** 把根 + 各子模块的标签聚合成 tag → 来源项目名列表（Map 保插入序）。 */
function collectTagsWithSources(
  stack: DomainStackProfile,
  rootName: string,
): Map<string, string[]> {
  const sources = new Map<string, string[]>()
  const addFrom = (
    profile: DomainStackProfile | DomainSubmoduleStack,
    src: string,
  ) => {
    if (!src) return
    const add = (raw?: string) => {
      const tag = (raw ?? "").trim()
      if (!tag) return
      const list = sources.get(tag)
      if (list) {
        if (!list.includes(src)) list.push(src)
      } else {
        sources.set(tag, [src])
      }
    }
    add(profile.primary_language)
    profile.frameworks?.forEach(add)
    profile.project_types?.forEach(add)
    profile.package_managers?.forEach(add)
    profile.containers?.forEach(add)
  }
  addFrom(stack, rootName)
  for (const sub of stack.submodules ?? []) {
    if (!sub || sub.error) continue
    const src = (sub.name || sub.path || "").trim()
    if (!src) continue
    addFrom(sub, src)
  }
  return sources
}

/**
 * 项目技术栈聚合徽章（console 项目详情页项目名后用）。
 *
 * 把根仓库 + 各子模块的标签聚合成一组彩色徽章，**只显示标签本身**——
 * 不再展示子模块名标签。悬停某个标签时 tooltip 显示该标签来自哪些项目
 *（根项目名 + 命中该标签的子模块名，多个用「、」分隔）；溢出 ``+N`` 悬停
 * 展开剩余标签与其来源。badge 文案是标识本身（小写）无需翻译。
 *
 * 返回 **fragment 无包装 div**：让各徽章成为父 flex 容器（ItemTitle）的
 * 直接 flex item，紧随项目名横向排列、按需逐个换行，避免整块徽章下坠到
 * 项目名下方。父容器需自带 ``flex flex-wrap items-center gap-*``。
 */
const ProjectStackBadges = ({
  stack,
  rootName,
  max = 8,
}: ProjectStackBadgesProps) => {
  if (!stack) return null
  const root = (rootName ?? "").trim() || "主项目"
  const sources = collectTagsWithSources(stack, root)
  const tags = [...sources.keys()]
  if (tags.length === 0) return null

  const shown = tags.slice(0, max)
  const rest = tags.slice(max).map((tag) => [tag, sources.get(tag) ?? []] as const)

  return (
    <>
      {shown.map((tag, i) => (
        <Tooltip key={tag} delayDuration={150}>
          <TooltipTrigger asChild>
            <TagBadge label={tag} className={i === 0 ? "ml-2" : undefined} />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs break-all">
            {(sources.get(tag) ?? []).join("、")}
          </TooltipContent>
        </Tooltip>
      ))}
      {rest.length > 0 && (
        <Tooltip key="__overflow" delayDuration={150}>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-muted-foreground">
              +{rest.length}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm bg-popover text-popover-foreground shadow-md [&>svg]:hidden">
            <div className="flex flex-col gap-1.5">
              {rest.map(([tag, srcs]) => (
                <div key={tag} className="flex flex-row flex-wrap items-center gap-1.5">
                  <TagBadge label={tag} />
                  <span className="text-xs text-muted-foreground">{srcs.join("、")}</span>
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  )
}

export { ProjectStackBadges }
