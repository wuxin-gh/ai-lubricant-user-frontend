import type { DomainModel } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  getBrandFromModel,
  getModelDisplayName,
} from "@/utils/common"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { IconChevronDown, IconSearch } from "@tabler/icons-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

interface ModelMultiSelectProps {
  models: DomainModel[]
  selectedModelIds: string[]
  setSelectedModelIds: (ids: string[]) => void
  className?: string
}

/**
 * 大模型多选：一个 session 携带一组模型，运行时在其中切换。用勾选而非单选，
 * 复用 ModelSelect 的品牌图标与展示名，但摊平成一个可勾选列表。
 */
export default function ModelMultiSelect({
  models,
  selectedModelIds,
  setSelectedModelIds,
  className,
}: ModelMultiSelectProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const supportedModels = useMemo(
    () => models.filter((model) => model.id),
    [models],
  )
  const selectedModels = useMemo(
    () => supportedModels.filter((model) => selectedModelIds.includes(model.id || "")),
    [supportedModels, selectedModelIds],
  )

  const filteredModels = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()
    if (!keyword) return supportedModels
    return supportedModels.filter((model) =>
      [model.model, model.remark, model.id]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(keyword))
    )
  }, [search, supportedModels])

  const toggle = (modelId: string, checked: boolean) => {
    if (checked) {
      setSelectedModelIds(selectedModelIds.includes(modelId) ? selectedModelIds : [...selectedModelIds, modelId])
    } else {
      setSelectedModelIds(selectedModelIds.filter((id) => id !== modelId))
    }
  }

  const label = selectedModels.length === 0
    ? t("taskWorkflow.model.select")
    : selectedModels.length === 1
      ? getModelDisplayName(selectedModels[0].model)
      : `已选 ${selectedModels.length} 个模型`

  return (
    <div className={cn("w-full", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-9 w-full justify-between rounded-md px-2 text-sm"
            disabled={supportedModels.length === 0}
          >
            <span className={cn("truncate", selectedModels.length === 0 && "text-muted-foreground")}>{label}</span>
            <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-[320px] p-1"
          onCloseAutoFocus={() => setSearch("")}
        >
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
          <div className="max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto">
          {filteredModels.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">无匹配模型</div>
          ) : filteredModels.map((model) => {
            const modelId = model.id || ""
            return (
              <DropdownMenuCheckboxItem
                key={modelId}
                checked={selectedModelIds.includes(modelId)}
                onCheckedChange={(checked) => toggle(modelId, Boolean(checked))}
                onSelect={(event) => event.preventDefault()}
                className="gap-2"
              >
                <Icon name={getBrandFromModel(model)} className="size-4 shrink-0" />
                <span className="truncate">{getModelDisplayName(model.model)}</span>
                {model.remark ? <Badge variant="outline" className="ml-auto shrink-0">{model.remark}</Badge> : null}
              </DropdownMenuCheckboxItem>
            )
          })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {selectedModels.length > 1 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {selectedModels.map((model) => (
            <Badge key={model.id} variant="secondary" className="gap-1">
              {getModelDisplayName(model.model)}
              <button type="button" className="ml-0.5 text-muted-foreground hover:text-foreground" onClick={() => toggle(model.id || "", false)}>×</button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
