import { useMemo, useState } from "react"
import { IconCheck, IconSearch, IconSelector, IconX } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * 下拉多选。原生 `<select multiple>` 在弹框里既显示不全也不好用（要按住 Ctrl
 * 才能多选），这里换成 Popover + 勾选列表：触发器显示已选项 chip，面板里点一下
 * 切换单项，重复点取消。
 */
export default function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "请选择",
  emptyHint = "暂无可选项",
  className,
  disabledValues,
  disabledHint,
}: {
  options: Array<{ value: string; label?: string; hint?: string }>
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  emptyHint?: string
  className?: string
  /** 禁用的 value 集合：渲染但不可勾选，附 disabledHint 提示。 */
  disabledValues?: string[]
  disabledHint?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const selectedSet = useMemo(() => new Set(value), [value])
  const disabledSet = useMemo(() => new Set(disabledValues || []), [disabledValues])
  const labelOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const option of options) map.set(option.value, option.label || option.value)
    return map
  }, [options])
  const filteredOptions = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()
    if (!keyword) return options
    return options.filter((option) =>
      [option.value, option.label, option.hint]
        .filter(Boolean)
        .some((text) => String(text).toLocaleLowerCase().includes(keyword))
    )
  }, [options, search])

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) setSearch("")
  }

  function toggle(optionValue: string) {
    onChange(selectedSet.has(optionValue) ? value.filter((item) => item !== optionValue) : [...value, optionValue])
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("h-auto min-h-9 w-full justify-between gap-2 px-3 py-1.5 font-normal", className)}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {value.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              value.map((item) => (
                <Badge key={item} variant="secondary" className="gap-1 text-[11px]">
                  <span className="truncate">{labelOf.get(item) || item}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`删除 ${labelOf.get(item) || item}`}
                    className="shrink-0 rounded-sm opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onChange(value.filter((selected) => selected !== item))
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return
                      event.preventDefault()
                      event.stopPropagation()
                      onChange(value.filter((selected) => selected !== item))
                    }}
                  >
                    <IconX className="size-3" />
                  </span>
                </Badge>
              ))
            )}
          </span>
          <IconSelector className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-1">
        {options.length > 0 && (
          <div className="relative mb-1">
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="搜索模型…"
              className="h-8 pl-8"
            />
          </div>
        )}
        <div
          className="max-h-64 overflow-auto overscroll-contain"
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          {options.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">{emptyHint}</div>
          ) : filteredOptions.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">无匹配模型</div>
          ) : (
            filteredOptions.map((option) => {
              const checked = selectedSet.has(option.value)
              const isDisabled = disabledSet.has(option.value)
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => !isDisabled && toggle(option.value)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                    isDisabled ? "cursor-not-allowed opacity-40" : "hover:bg-muted",
                    checked && "font-medium"
                  )}
                  title={isDisabled ? (disabledHint || "") : undefined}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {checked && <IconCheck className="size-3.5 text-primary" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.label || option.value}</span>
                  {isDisabled && disabledHint ? (
                    <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">{disabledHint}</span>
                  ) : (
                    option.hint && <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
