import { type DomainStackProfile, type DomainSubmoduleStack } from "@/api/Api"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

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

/**
 * 技术栈徽章组（console 项目页 + 市场候选池共用）。
 *
 * 纯展示：主语言 + ≤max 框架 + ``+N`` 溢出 + 可选截断提示标记。badge 文案是
 * 语言/框架标识本身（小写），无需翻译；截断提示的文案由调用方注入以解耦
 * i18n 命名空间。空 profile 返回 ``null``，不占任何布局空间。
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

  return (
    <div className={cn("flex flex-row flex-wrap items-center gap-1", className)}>
      {items.map(({ key, label }) => (
        <Badge key={key} variant="secondary" className="lowercase">
          {label}
        </Badge>
      ))}
      {overflow > 0 && (
        <Badge variant="outline" className="text-muted-foreground">
          +{overflow}
        </Badge>
      )}
      {stack.truncated && (
        <span
          className="text-xs text-muted-foreground"
          title={truncatedTitle}
          aria-hidden={truncatedTitle ? undefined : true}
        >
          ⚠
        </span>
      )}
    </div>
  )
}

export { StackBadges }

interface SubmoduleStackListProps {
  /** ``.gitmodules`` 声明的子模块识别结果；空/null 渲染 null。 */
  submodules?: DomainSubmoduleStack[] | null
  /** 每行框架徽章上限，溢出折叠成 ``+N``；默认 2（子项目行更紧凑）。 */
  max?: number
  /** 截断提示 tooltip 文案（透传给每行的 StackBadges）。 */
  truncatedTitle?: string
  className?: string
}

/**
 * 子项目技术栈紧凑列表（console 项目页用）。
 *
 * 每行「子模块名: 主语言 · ≤max 框架」。识别失败的子模块只显 ``⚠`` 并以
 * 原因作 tooltip。badge 文案是标识本身无需翻译；纯展示，与 StackBadges 共用
 * i18n 解耦策略（文案由调用方注入）。
 */
const SubmoduleStackList = ({
  submodules,
  max = 2,
  truncatedTitle,
  className,
}: SubmoduleStackListProps) => {
  const subs = (submodules ?? []).filter(Boolean)
  if (subs.length === 0) return null
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {subs.map((sub) => {
        const name = (sub.name || sub.path || "").trim()
        const key = sub.path || sub.name || sub.url || name
        if (sub.error) {
          return (
            <div key={key} className="flex flex-row items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground shrink-0">{name}</span>
              <span className="text-xs text-warning" title={sub.error} aria-hidden={sub.error ? undefined : true}>
                ⚠
              </span>
            </div>
          )
        }
        return (
          <div key={key} className="flex flex-row flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground shrink-0">{name}</span>
            <StackBadges
              stack={sub}
              max={max}
              truncatedTitle={truncatedTitle}
              className="gap-1"
            />
          </div>
        )
      })}
    </div>
  )
}

export { SubmoduleStackList }
