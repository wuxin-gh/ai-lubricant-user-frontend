import { useState } from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface ComboOption {
  value: string
  label: string
}

function optionMatches(option: ComboOption, keyword: string): boolean {
  const k = keyword.trim().toLowerCase()
  if (!k) return true
  return option.value.toLowerCase().includes(k) || option.label.toLowerCase().includes(k)
}

/**
 * 组合下拉：Popover + Command（cmdk）实现，带搜索框。替代原生 <select>：
 * 原生 select 在自定义弹层里样式不可控、无法搜索，multiple 形态要按住 Ctrl 才能多选。
 *
 * 多选：点项切换勾选，已选项在触发器里以 chip 展示，chip 上的 × 可单独删除。
 * 单选：点项选中后收起，触发器右侧 × 可清除。
 *
 * 面板通过 Portal 渲染到 body，在自实现 Modal（position:fixed + z-index:1000）里使用时，
 * 需通过 contentZIndex 传高于该 Modal 的值（如 1101），否则面板会被遮罩盖住看不见。
 */
export function ComboSearchSelect({
  value,
  onChange,
  options,
  placeholder = "请选择",
  contentZIndex,
  disabled,
  listClassName,
  listHeight,
  contentWidth,
  className,
}: {
  value: string | undefined
  onChange: (value: string | undefined) => void
  options: ComboOption[]
  placeholder?: string
  contentZIndex?: number
  disabled?: boolean
  /** 触发器额外 className，用于和原生输入框统一高度。 */
  className?: string
  /** 透传给 CommandList 的额外 className。 */
  listClassName?: string
  /** 下拉菜单最大高度（CSS 值，如 "320px"）。不传则用默认 max-h-72。 */
  listHeight?: string
  /** 下拉菜单宽度（CSS 值，如 "360px"）。不传则与触发器同宽。
   *  触发器被塞进窄列（如表格列）时用这个让菜单比触发器更宽，避免长选项被截断。 */
  contentWidth?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const selectedLabel = value ? options.find((o) => o.value === value)?.label ?? value : ""
  const filtered = options.filter((o) => optionMatches(o, search))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-9 w-full justify-between font-normal", className)}
        >
          <span className={cn("flex-1 truncate text-left", value ? "" : "text-muted-foreground")}>
            {value ? selectedLabel : placeholder}
          </span>
          <span className="flex items-center gap-1">
            {value ? (
              <span
                role="button"
                tabIndex={-1}
                className="opacity-60 hover:opacity-100"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(undefined)
                }}
              >
                <X className="size-4" />
              </span>
            ) : null}
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        style={{
          ...(contentWidth ? { width: contentWidth } : {}),
          ...(contentZIndex ? { zIndex: contentZIndex } : {}),
        }}
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索..." value={search} onValueChange={setSearch} />
          <CommandList
            className={cn(listHeight && "max-h-none", listClassName)}
            style={listHeight ? { maxHeight: listHeight } : undefined}
          >
            <CommandEmpty>无匹配项</CommandEmpty>
            {filtered.map((opt) => (
              <CommandItem
                key={opt.value}
                value={opt.value}
                onSelect={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
              >
                <span className="flex-1">{opt.label}</span>
                {value === opt.value ? <Check className="size-4" /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function ComboMultiSelect({
  value,
  onChange,
  options,
  placeholder = "请选择",
  contentZIndex,
  disabled,
  className,
}: {
  value: string[]
  onChange: (value: string[]) => void
  options: ComboOption[]
  placeholder?: string
  contentZIndex?: number
  disabled?: boolean
  /** 触发器额外 className，用于和原生输入框统一高度。 */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const selectedSet = new Set(value)
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v
  const toggle = (v: string) => {
    if (selectedSet.has(v)) onChange(value.filter((item) => item !== v))
    else onChange([...value, v])
  }
  const filtered = options.filter((o) => optionMatches(o, search))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-auto min-h-9 w-full justify-between", className)}
        >
          <span className="flex flex-1 flex-wrap items-center gap-1 py-0.5 text-left">
            {value.length ? (
              value.map((v) => (
                <Badge key={v} variant="secondary" className="gap-1">
                  {labelOf(v)}
                  <span
                    role="button"
                    tabIndex={-1}
                    className="opacity-60 hover:opacity-100"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(v)
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-1 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        style={contentZIndex ? { zIndex: contentZIndex } : undefined}
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索..." value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>无匹配项</CommandEmpty>
            {filtered.map((opt) => (
              <CommandItem key={opt.value} value={opt.value} onSelect={() => toggle(opt.value)}>
                <span className="flex-1">{opt.label}</span>
                {selectedSet.has(opt.value) ? <Check className="size-4" /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

