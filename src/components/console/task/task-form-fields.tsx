/**
 * 任务 / Review 弹框共享的表单字段组件。
 *
 * 从 auto-review-dialog.tsx 提取，避免在多个弹框里复制粘贴 Popover+Command 搜索下拉、
 * Hint tooltip、限额数字输入这三套样板。
 */
import { IconChevronDown, IconHelpCircle } from "@tabler/icons-react"

import { ConstsGitPlatform, type DomainBranch } from "@/api/Api"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { apiRequest } from "@/utils/requestUtils"
import { useEffect, useRef, useState } from "react"

/** "?" tooltip — 把行内提示文字换成按需展开的问号。
 *
 * 触发器用 <span role="button"> 而非 <button>：Hint 常被放进另一个作为 <button>
 * 渲染的触发器里（如 CollapsibleTrigger asChild > Button），嵌套 <button> 会触发
 * React "cannot be a descendant of" 的水合报错。span 承担同样的可点击/可聚焦语义。 */
export function Hint({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          className="inline-flex text-muted-foreground hover:text-foreground focus:outline-none"
        >
          <IconHelpCircle className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{label}</TooltipContent>
    </Tooltip>
  )
}

/** 单个限额数字输入；留空 = 不限制。 */
export function NumberField({ label, value, onChange, hint, placeholder }: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  placeholder?: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} value={value} placeholder={placeholder}
        className="h-11" onChange={(event) => onChange(event.target.value)} />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export interface SearchSelectOption {
  value: string
  label: string
  /** 可选项副说明（如 masked key / model id），渲染在主标签下方。 */
  hint?: string
  disabled?: boolean
}

/**
 * 可搜索的单选下拉。用 Popover + Command 实现：内置按 label/hint 过滤，
 * 触发器宽满父容器。用于候选可能很多的字段（父 API Key、模型等）。
 *
 * 值为 ``__inherit__`` 时展示 ``inheritLabel`` 条目（如"继承父级"）；不传则不显示。
 */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
  emptyHint,
  inheritLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: SearchSelectOption[]
  placeholder: string
  emptyHint: string
  /** 值为 "__inherit__" 时展示的"继承"条目文案；为空串时不显示该条目。 */
  inheritLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((item) => item.value === value && !item.disabled)
  const triggerLabel = value === "__inherit__" && inheritLabel
    ? inheritLabel
    : (selected ? selected.label : "")
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex h-11 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted/40"
        >
          <span className="min-w-0 flex-1 truncate">
            {triggerLabel || <span className="text-muted-foreground">{placeholder}</span>}
          </span>
          <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} className="h-9" />
          <CommandList className="max-h-64">
            <CommandEmpty>{emptyHint}</CommandEmpty>
            {inheritLabel && (
              <CommandGroup>
                <CommandItem
                  value={`__inherit__ ${inheritLabel}`}
                  onSelect={() => { onChange("__inherit__"); setOpen(false) }}
                >
                  <span className="text-muted-foreground">{inheritLabel}</span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.hint || ""} ${option.value}`}
                  disabled={option.disabled}
                  onSelect={() => { if (!option.disabled) { onChange(option.value); setOpen(false) } }}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint && <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>}
                  {value === option.value && <span className="shrink-0 text-xs text-primary">✓</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export type TaskBranchMode = "auto" | "default" | "existing"

/**
 * 任务分支选择器。策略下拉顺序：自动创建 / 主分支（默认）/ 已有分支；
 * 选「已有分支」时按项目 Git 身份拉真实分支列表（v1UsersGitIdentitiesBranchesDetail），
 * 拉取中/失败/内部仓库时退化为自由输入。无 Git 身份或内部仓库整体隐藏（返回 null）。
 *
 * 与 create-editor / editor-tab 的分支交互一致，是任务创建弹框与首页项目模式共用件。
 */
export function TaskBranchPicker({
  mode,
  onModeChange,
  branch,
  onBranchChange,
  gitIdentityId,
  repoFullName,
  platform,
  disabled,
}: {
  mode: TaskBranchMode
  onModeChange: (mode: TaskBranchMode) => void
  branch: string
  onBranchChange: (branch: string) => void
  gitIdentityId?: string | null
  repoFullName?: string | null
  platform?: string | null
  disabled?: boolean
}) {
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const requestIdRef = useRef(0)

  const isInternal = platform === ConstsGitPlatform.GitPlatformInternal
  const hasGit = Boolean(gitIdentityId && repoFullName) && !isInternal

  useEffect(() => {
    if (mode !== "existing" || !hasGit) {
      requestIdRef.current += 1
      return
    }
    const requestId = ++requestIdRef.current
    setLoading(true)
    setFailed(false)
    setBranches([])
    void apiRequest(
      "v1UsersGitIdentitiesBranchesDetail",
      {},
      [gitIdentityId as string, encodeURIComponent(repoFullName as string)],
      (resp) => {
        if (requestId !== requestIdRef.current) return
        if (resp.code === 0 && Array.isArray(resp.data)) {
          const list = (resp.data as DomainBranch[]).map((item) => item.name || "").filter(Boolean)
          setBranches(list)
          setFailed(list.length === 0)
          if (!list.includes(branch)) {
            onBranchChange(list.includes("main") ? "main" : list.includes("master") ? "master" : list[0] || "")
          }
        } else {
          setFailed(true)
        }
        setLoading(false)
      },
      () => {
        if (requestId !== requestIdRef.current) return
        setFailed(true)
        setLoading(false)
      },
    )
    // branch/onBranchChange 故意不入依赖：只在打开「已有分支」或项目仓库变化时重拉。
  }, [mode, hasGit, gitIdentityId, repoFullName])

  // 项目未绑定 Git 身份（或内部仓库）时无从选分支，整块隐藏。
  if (!hasGit) return null

  return (
    <div className="grid gap-2">
      <Label>分支</Label>
      <div className="flex gap-2">
        <Select value={mode} onValueChange={(value) => onModeChange(value as TaskBranchMode)} disabled={disabled}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">自动创建</SelectItem>
            <SelectItem value="default">主分支</SelectItem>
            <SelectItem value="existing">已有分支</SelectItem>
          </SelectContent>
        </Select>
        {mode === "existing" && (
          loading ? (
            <div className="flex h-9 flex-1 items-center rounded-md border px-3 text-sm text-muted-foreground">加载分支中…</div>
          ) : branches.length > 0 ? (
            <Select value={branch} onValueChange={onBranchChange} disabled={disabled}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="选择分支" /></SelectTrigger>
              <SelectContent>
                {branches.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="flex-1"
              value={branch}
              onChange={(event) => onBranchChange(event.target.value)}
              placeholder={failed ? "拉取分支失败，手动输入分支名" : "输入已有分支名"}
              disabled={disabled}
            />
          )
        )}
      </div>
      {mode === "auto" && <p className="text-[11px] text-muted-foreground">从默认分支创建 task/&lt;任务 id&gt; 新分支。</p>}
    </div>
  )
}
