/**
 * 「分配给分组」弹窗 + 分组多选。
 *
 * 把节点授予所选分组的每个成员：管理节点=可经它启停执行节点，执行节点=可派发任务。
 */
import { useEffect, useState } from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import type { NodeInfo, TeamGroupLite } from "@/@admin-port/api/nodes"

/** 分组多选（id/name 对）。 */
function GroupMultiSelect({
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  value: string[]
  options: { value: string; label: string }[]
  placeholder: string
  disabled?: boolean
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="h-auto min-h-9 w-full justify-between px-2.5 py-1.5 font-normal"
        >
          <span className="flex flex-1 flex-wrap gap-1">
            {value.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              value.map((v) => (
                <Badge key={v} variant="secondary" className="gap-1">
                  {labelFor(v)}
                  <span
                    role="button"
                    tabIndex={-1}
                    className="hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(v)
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </Badge>
              ))
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="搜索分组..." />
          <CommandList>
            <CommandEmpty>无匹配分组</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const checked = value.includes(opt.value)
                return (
                  <CommandItem key={opt.value} value={opt.label} onSelect={() => toggle(opt.value)}>
                    <Check className={cn("size-4", checked ? "opacity-100" : "opacity-0")} />
                    {opt.label}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function AssignModal({
  open,
  node,
  groups,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean
  node: NodeInfo | null
  groups: TeamGroupLite[]
  onClose: () => void
  onSubmit: (groupIds: string[]) => void
  submitting: boolean
}) {
  const [selected, setSelected] = useState<string[]>([])

  useEffect(() => {
    if (open) setSelected([])
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>分配节点给分组：{node?.node_name || node?.node_id || ""}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            绑定后，所选分组内的每个用户都获得对该节点的权限：管理节点=可经它启停执行节点，执行节点=可派发任务。
          </p>
          <GroupMultiSelect
            value={selected}
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
            placeholder="选择一个或多个分组"
            disabled={submitting}
            onChange={setSelected}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button onClick={() => onSubmit(selected)} disabled={submitting || selected.length === 0}>
              {submitting ? <Spinner /> : null}
              绑定
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
