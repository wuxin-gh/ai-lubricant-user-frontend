import { useMemo, useState } from "react"
import { Check, ChevronDown, ChevronRight, ChevronsUpDown, KeyRound, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * API Key 树形下拉：父 Key 可展开看子 Key（二级折叠），选中项回传 Key 的整数 id。
 *
 * 与请求日志页的 ApiKeyTreeSelect 同款交互与视觉（搜索、父子折叠、脱敏展示），
 * 差别只在取值口径：日志页按 api_key_name 精确过滤，故回传 name；本组件面向
 * 「用哪个 Key 发请求」的场景，回传 id。
 *
 * 数据由调用方决定（普通用户=自有+分组系统 Key，超级管理员=全平台 Key），
 * 组件只负责渲染：有 parent_id 的归到父组，孤儿子 Key（父已删）与无子父 Key
 * 走扁平项。
 */
export interface ApiKeyTreeItem {
  id: number
  name: string
  /** 脱敏 Key，作副标题展示；无则不显示。 */
  key_masked?: string
  disabled?: boolean
  parent_id?: number | null
}

export function ApiKeyTreeSelect({
  value,
  onChange,
  keys,
  placeholder = "选择 API Key",
  emptyText = "无匹配的 Key",
  disabled = false,
  className,
  contentZIndex,
}: {
  /** 当前选中的 Key id；空表示未选。 */
  value: number | null
  onChange: (id: number | null) => void
  keys: ApiKeyTreeItem[]
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
  contentZIndex?: number
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())

  // 父子分组：有子 Key 的父 → 折叠组；无子 Key 的父 + 父已删除的孤儿子 Key → 扁平项。
  const { groups, flatKeys } = useMemo(() => {
    const byId = new Map(keys.map((k) => [k.id, k]))
    const childrenOf = new Map<number, ApiKeyTreeItem[]>()
    const parents: ApiKeyTreeItem[] = []
    const orphans: ApiKeyTreeItem[] = []
    for (const k of keys) {
      if (k.parent_id && byId.has(k.parent_id)) {
        const arr = childrenOf.get(k.parent_id) ?? []
        arr.push(k)
        childrenOf.set(k.parent_id, arr)
      } else if (k.parent_id) {
        orphans.push(k)
      } else {
        parents.push(k)
      }
    }
    const byName = (a: ApiKeyTreeItem, b: ApiKeyTreeItem) => a.name.localeCompare(b.name, "zh-Hans-CN")
    parents.sort(byName)
    orphans.sort(byName)
    for (const arr of childrenOf.values()) arr.sort(byName)
    const groups = parents
      .filter((p) => (childrenOf.get(p.id)?.length ?? 0) > 0)
      .map((p) => ({ parent: p, children: childrenOf.get(p.id) ?? [] }))
    const flatKeys = [...parents.filter((p) => !childrenOf.has(p.id)), ...orphans]
    return { groups, flatKeys }
  }, [keys])

  const q = search.trim().toLowerCase()
  const nameMatch = (name: string) => !q || name.toLowerCase().includes(q)
  const groupsVisible = groups.filter(
    (g) => nameMatch(g.parent.name) || g.children.some((c) => nameMatch(c.name)),
  )
  const flatVisible = flatKeys.filter((k) => nameMatch(k.name))

  // 当前选中项若是子 Key，其父组始终展开，保证选中项可见。
  const selectedParentId = keys.find((k) => k.id === value && k.parent_id)?.parent_id ?? null
  const isGroupExpanded = (g: { parent: ApiKeyTreeItem; children: ApiKeyTreeItem[] }) => {
    if (q) return g.children.some((c) => nameMatch(c.name))
    return expanded.has(g.parent.id) || g.parent.id === selectedParentId
  }
  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectedKey = keys.find((k) => k.id === value) ?? null
  const triggerLabel = selectedKey?.name ?? ""

  const commit = (id: number) => {
    onChange(id)
    setOpen(false)
    setSearch("")
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (disabled) return
        setOpen(o)
        if (!o) setSearch("")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn("h-9 w-full justify-between font-normal", className)}
        >
          <span className={cn("flex min-w-0 items-center gap-1.5 truncate", !triggerLabel && "text-muted-foreground")}>
            {value ? <KeyRound className="size-3.5 shrink-0 opacity-60" /> : null}
            <span className="truncate">{triggerLabel || placeholder}</span>
          </span>
          <span className="ml-1 flex items-center gap-1">
            {value ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="清除"
                className="opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(null)
                }}
              >
                <X className="size-3.5" />
              </span>
            ) : null}
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        align="start"
        style={{ width: "var(--radix-popover-trigger-width)", minWidth: 260, zIndex: contentZIndex }}
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索 Key 名称" value={search} onValueChange={setSearch} />
          <CommandList className="max-h-80">
            {groupsVisible.length === 0 && flatVisible.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {keys.length === 0 ? emptyText : "无匹配"}
              </div>
            ) : null}

            {groupsVisible.map((g) => {
              const expandedNow = isGroupExpanded(g)
              const parentActive = value === g.parent.id
              return (
                <CommandGroup key={g.parent.id}>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={expandedNow ? "收起子 Key" : "展开子 Key"}
                      className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent"
                      onClick={() => toggleExpand(g.parent.id)}
                    >
                      {expandedNow ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                    <CommandItem
                      value={`p-${g.parent.id}`}
                      disabled={g.parent.disabled}
                      onSelect={() => commit(g.parent.id)}
                      className="flex-1"
                    >
                      <KeyRound className="size-3.5 shrink-0 opacity-60" />
                      <span className="flex-1 truncate">{g.parent.name}</span>
                      <span className="text-xs text-muted-foreground">{g.children.length}</span>
                      <Check
                        className={cn("ml-1 size-4 shrink-0", parentActive ? "opacity-100" : "opacity-0")}
                      />
                    </CommandItem>
                  </div>
                  {expandedNow
                    ? g.children
                        .filter((c) => nameMatch(c.name))
                        .map((c) => (
                          <CommandItem
                            key={c.id}
                            value={`c-${c.id}`}
                            disabled={c.disabled}
                            onSelect={() => commit(c.id)}
                            className="pl-9"
                          >
                            <span className="flex-1 truncate">{c.name}</span>
                            {c.key_masked ? (
                              <span className="truncate font-mono text-[10px] text-muted-foreground">{c.key_masked}</span>
                            ) : null}
                            <Check
                              className={cn(
                                "ml-1 size-4 shrink-0",
                                value === c.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                          </CommandItem>
                        ))
                    : null}
                </CommandGroup>
              )
            })}

            {flatVisible.length > 0 ? (
              <CommandGroup heading={groupsVisible.length > 0 ? "其他 Key" : "API Key"}>
                {flatVisible.map((k) => (
                  <CommandItem
                    key={k.id}
                    value={`f-${k.id}`}
                    disabled={k.disabled}
                    onSelect={() => commit(k.id)}
                  >
                    <KeyRound className="size-3.5 shrink-0 opacity-60" />
                    <span className="flex-1 truncate">{k.name}</span>
                    {k.key_masked ? (
                      <span className="truncate font-mono text-[10px] text-muted-foreground">{k.key_masked}</span>
                    ) : null}
                    <Check
                      className={cn("ml-1 size-4 shrink-0", value === k.id ? "opacity-100" : "opacity-0")}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
