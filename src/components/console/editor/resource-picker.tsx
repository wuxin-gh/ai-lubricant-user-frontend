import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

export type ConfigEntry = Record<string, unknown>
export type ResourceItem = {
  id?: string | number
  name?: string
  display_name?: string
  description?: string
  entry?: string
  url?: string
  __source?: string
  /** 来源徽标文案（团队 / 内置 / 平台 / 个人…）；不填则不显示徽标。 */
  __badge?: string
  /** 勾选了会无效的条目（如未启用的服务）灰显且不可选。 */
  disabled?: boolean
}
export type ItemState = "ready" | "loading" | "failed"

function entryId(item: { id?: string | number; name?: string; url?: string; entry?: string }): string {
  return String(item.id || item.name || item.url || item.entry)
}

export function EditorResourcePicker({ label, items, selected, onChange, mapItem, itemState, groups }: {
  label: string
  items: ResourceItem[]
  selected: ConfigEntry[]
  onChange: (next: ConfigEntry[]) => void
  mapItem?: (item: ResourceItem) => ConfigEntry
  /** 市场 manifest 未加载完成/失败时阻止勾选，避免把索引摘要写进 editor config。 */
  itemState?: (item: ResourceItem) => ItemState
  /**
   * 显式分组渲染。给定时按顺序渲染每个分组（空分组跳过），忽略默认的
   * 本地/市场二分——创建任务的 MCP 页签要同时列团队引用、内置、平台、个人
   * 四个来源，二分法容不下。
   */
  groups?: Array<{ title: string; items: ResourceItem[] }>
}) {
  const selectedIds = new Set(selected.map((entry) => entryId(entry)))
  const local = items.filter((item) => item.__source !== "marketplace")
  const market = items.filter((item) => item.__source === "marketplace")

  const renderItems = (group: ResourceItem[]) => group.map((item) => {
    const id = entryId(item)
    const checked = selectedIds.has(id)
    const state = itemState?.(item) || "ready"
    const disabled = (state !== "ready" || item.disabled === true) && !checked
    return (
      <label key={id} className={`flex items-start gap-2 rounded px-2 py-1.5 text-sm ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted"}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => {
          if (event.target.checked) {
            try { onChange([...selected, mapItem ? mapItem(item) : { ...item, id }]) }
            catch { return }
          } else onChange(selected.filter((entry) => entryId(entry) !== id))
        }} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="block truncate">{item.display_name || item.name || item.entry || id}</span>
            {item.__source === "marketplace" && <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px]">市场</Badge>}
            {item.__badge && <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px]">{item.__badge}</Badge>}
            {item.disabled === true && <span className="text-[10px] text-muted-foreground">未启用</span>}
            {state === "loading" && <span className="text-[10px] text-muted-foreground">加载 manifest...</span>}
            {state === "failed" && <span className="text-[10px] text-destructive">manifest 加载失败</span>}
          </span>
          {item.description && <span className="block truncate text-xs text-muted-foreground">{item.description}</span>}
        </span>
      </label>
    )
  })

  const rendered = groups
    ? groups.filter((group) => group.items.length > 0)
    : [
        ...(local.length ? [{ title: "本地可用", items: local }] : []),
        ...(market.length ? [{ title: "GitHub 市场", items: market }] : []),
      ]

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="max-h-48 overflow-auto rounded-md border p-1">
        {rendered.length === 0 ? <div className="p-2 text-xs text-muted-foreground">暂无可用项</div> : (
          rendered.map((group, index) => (
            <div key={group.title}>
              <div className={`px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground${index > 0 ? " mt-1 border-t" : ""}`}>
                {group.title}
              </div>
              {renderItems(group.items)}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
