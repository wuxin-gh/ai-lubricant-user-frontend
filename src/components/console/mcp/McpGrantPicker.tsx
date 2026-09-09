/**
 * MCP 授权添加式选择器（mcp_grants 两段式交互的「添加按钮」形态）。
 *
 * 交互模型：一个「添加」按钮 → 弹出 picker 选 MCP 服务或工具 → 选了工具类
 * （required_param 非空，如 cdp-bridge/mail/device-control）接着勾选它支持的
 * 实例（浏览器/邮箱/设备，不勾=默认全量）→ 确认加入已选列表。已选项以**卡片
 * 网格**展示（服务名/来源/描述 + 绑定实例的徽章），工具类可重开实例勾选调整、
 * 可整条移除。
 *
 * 受控组件：grants 草稿由父层持有（create-task 弹框是本地草稿随表单提交；
 * agent 配置包一层 load/save 走 principal grants API）。资源候选与 param 类型
 * 目录由父层注入（authorization/options），组件不做网络请求。
 */
import { useMemo, useState } from "react"
import { Plus, Pencil, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

/** 服务授权行 grant_key。与后端 mcp_plugin_store.GRANT_SERVICE_KEY 同值。 */
const SERVICE_GRANT_KEY = "service"

export interface PickerResource {
  resource_kind: string
  resource_id: number
  resource_type: string
  name: string
  description?: string
  tool_count?: number
  /** service 项：执行器 kind；stdio=true 标灰禁用（执行器未实装）。 */
  kind?: string
  stdio?: boolean
  required_param?: string
  /** service 项来源标签（内置/平台/个人），由调用方按 listAvailableMcp 对齐注入。 */
  source?: string
  children?: Array<{ child_kind: string; child_id: number; name: string }>
}

export interface PickerParamKind {
  key: string
  label: string
  resource_type: string
}

export interface PickerGrant {
  grant_key: string
  grant_value: string
}

interface McpGrantPickerProps {
  /** 授权草稿（service 行 + param 行），父层持有。 */
  grants: PickerGrant[]
  onChange: (grants: PickerGrant[]) => void
  /** 资源候选（services + builtin 实例）与 param 类型目录。 */
  resources: PickerResource[]
  paramKinds: PickerParamKind[]
  /** 无候选时的占位文案。 */
  emptyHint?: string
  /** 顶部说明文字（可选）。 */
  title?: string
}

/** 某服务是否工具类（需要实例收窄）。 */
function requiredParamOf(svc: PickerResource): string {
  return (svc.required_param || "").trim()
}

/** service 行的展示名（resource_id → resources 里的服务名）。 */
function serviceNameOf(resources: PickerResource[], serviceId: string): string {
  const svc = resources.find(
    (r) => r.resource_kind === SERVICE_GRANT_KEY && String(r.resource_id) === serviceId,
  )
  return svc?.name || `服务 #${serviceId}`
}

/** 某实例 id 的展示名。 */
function instanceNameOf(resources: PickerResource[], kind: PickerParamKind | undefined, id: string): string {
  if (!kind) return id
  const inst = resources.find(
    (r) => r.resource_kind === "builtin_resource" && r.resource_type === kind.resource_type && String(r.resource_id) === id,
  )
  return inst?.name || `#${id}`
}

/** 来源徽章文案。 */
const SOURCE_LABEL: Record<string, string> = {
  builtin: "内置",
  admin: "平台",
  upstream: "个人",
}

export function McpGrantPicker({ grants, onChange, resources, paramKinds, emptyHint, title }: McpGrantPickerProps) {
  // picker 状态：pickerOpen=弹框；pickingService=服务选择步；instanceTarget=实例勾选步的目标服务。
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickingService, setPickingService] = useState(false)
  const [instanceTarget, setInstanceTarget] = useState<PickerResource | null>(null)
  const [instanceDraft, setInstanceDraft] = useState<string[]>([])

  const serviceCandidates = useMemo(
    () => resources.filter((r) => r.resource_kind === SERVICE_GRANT_KEY),
    [resources],
  )

  /** 服务行的 grant_value → 已选服务资源对象。 */
  const selectedServices = useMemo(
    () =>
      grants
        .filter((g) => g.grant_key === SERVICE_GRANT_KEY)
        .map((g) => ({
          grant: g,
          svc: resources.find(
            (r) => r.resource_kind === SERVICE_GRANT_KEY && String(r.resource_id) === g.grant_value,
          ),
        })),
    [grants, resources],
  )

  /** 某 param_key 的目录（不存在 = 未知 key，实例区不渲染）。 */
  const paramKindOf = (key: string) => paramKinds.find((k) => k.key === key)

  /** 某服务已绑的实例 id 集（param 行，grant_key=required_param）。 */
  const boundInstancesOf = (svc: PickerResource): string[] => {
    const key = requiredParamOf(svc)
    if (!key) return []
    return grants.filter((g) => g.grant_key === key).map((g) => g.grant_value)
  }

  const openPicker = () => {
    setPickingService(true)
    setInstanceTarget(null)
    setPickerOpen(true)
  }

  /** picker 里点选一个服务：工具类 → 进入实例勾选步；sse 类 → 直接加入。 */
  const pickService = (svc: PickerResource) => {
    if (svc.stdio) return
    const key = requiredParamOf(svc)
    if (key) {
      // 工具类：预填已有绑定（重开编辑实例的场景）。
      setInstanceTarget(svc)
      setInstanceDraft(boundInstancesOf(svc))
      setPickingService(false)
      return
    }
    // sse/普通服务：直接加 service 行（幂等）。
    const id = String(svc.resource_id)
    if (!grants.some((g) => g.grant_key === SERVICE_GRANT_KEY && g.grant_value === id)) {
      onChange([...grants, { grant_key: SERVICE_GRANT_KEY, grant_value: id }])
    }
    setPickerOpen(false)
  }

  /** 实例勾选确认：写 service 行（幂等）+ 替换该 param_key 的全部 param 行。 */
  const confirmInstances = () => {
    const svc = instanceTarget
    if (!svc) return
    const key = requiredParamOf(svc)
    const id = String(svc.resource_id)
    const next: PickerGrant[] = grants.filter((g) => g.grant_key !== key)
    if (!grants.some((g) => g.grant_key === SERVICE_GRANT_KEY && g.grant_value === id)) {
      next.push({ grant_key: SERVICE_GRANT_KEY, grant_value: id })
    }
    for (const value of instanceDraft) {
      next.push({ grant_key: key, grant_value: value })
    }
    onChange(next)
    setPickerOpen(false)
    setInstanceTarget(null)
    setInstanceDraft([])
  }

  /** 移除一条已选服务：连它的 param 行（若有对应 required_param）一起删。 */
  const removeService = (serviceId: string) => {
    const svc = resources.find(
      (r) => r.resource_kind === SERVICE_GRANT_KEY && String(r.resource_id) === serviceId,
    )
    const key = svc ? requiredParamOf(svc) : ""
    onChange(
      grants.filter(
        (g) =>
          !(g.grant_key === SERVICE_GRANT_KEY && g.grant_value === serviceId) &&
          !(key && g.grant_key === key),
      ),
    )
  }

  /** 某 param_key 的可选实例（从 builtin_resource 资源收集，去重）。 */
  const instanceCandidates = (kind: PickerParamKind | undefined) => {
    if (!kind) return []
    const seen = new Set<number>()
    const out: Array<{ id: string; name: string }> = []
    for (const r of resources) {
      if (r.resource_kind === "builtin_resource" && r.resource_type === kind.resource_type) {
        const id = Number(r.resource_id)
        if (Number.isFinite(id) && !seen.has(id)) {
          seen.add(id)
          out.push({ id: String(r.resource_id), name: r.name })
        }
        continue
      }
      for (const child of r.children || []) {
        if (child.child_kind === kind.resource_type && !seen.has(child.child_id)) {
          seen.add(child.child_id)
          out.push({ id: String(child.child_id), name: child.name })
        }
      }
    }
    return out
  }

  const pickingKind = instanceTarget ? paramKindOf(requiredParamOf(instanceTarget)) : undefined
  const pickingCandidates = instanceCandidates(pickingKind)

  return (
    <div className="flex flex-col gap-2">
      {title && <div className="text-xs text-muted-foreground">{title}</div>}
      <Button type="button" size="sm" variant="outline" className="h-7 w-fit text-xs" onClick={openPicker}>
        <Plus className="size-3.5" /> 添加 MCP
      </Button>

      {/* 已选区域：卡片网格。每张卡片：服务名 + 来源徽章 + 描述/工具数 +
          绑定实例徽章（具体客户端名）；右上角编辑/移除。 */}
      {selectedServices.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          {emptyHint || "尚未添加 MCP。点击「添加 MCP」选择服务或工具；工具类可勾选它能操作的实例（不勾 = 全部）。"}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {selectedServices.map(({ grant, svc }) => {
            const key = svc ? requiredParamOf(svc) : ""
            const kind = key ? paramKindOf(key) : undefined
            const bound = key ? grants.filter((g) => g.grant_key === key).map((g) => g.grant_value) : []
            const svcName = svc?.name || serviceNameOf(resources, grant.grant_value)
            const sourceLabel = SOURCE_LABEL[svc?.source || ""] || (svc?.kind ? svc.kind : "服务")
            const meta = [
              svc?.description,
              svc?.tool_count ? `${svc.tool_count} 个工具` : "",
            ].filter(Boolean).join(" · ")
            return (
              <div key={grant.grant_value} className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{svcName}</span>
                      <Badge variant="outline" className="shrink-0 text-[10px]">{sourceLabel}</Badge>
                    </div>
                    {meta && <div className="truncate text-[11px] text-muted-foreground">{meta}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {key && kind && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-xs text-muted-foreground"
                        onClick={() => {
                          setInstanceTarget(svc!)
                          setInstanceDraft(boundInstancesOf(svc!))
                          setPickingService(false)
                          setPickerOpen(true)
                        }}
                        title="编辑可操作的实例"
                      >
                        <Pencil className="size-3" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-xs text-destructive"
                      onClick={() => removeService(grant.grant_value)}
                      title="移除"
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                </div>
                {/* 绑定实例区：工具类卡片显示具体客户端（徽章），不勾 = 全部。 */}
                {key && kind && (
                  <div className="flex min-w-0 flex-col gap-1 rounded-md bg-muted/40 p-2">
                    <div className="text-[11px] text-muted-foreground">
                      {kind.label}：
                      {bound.length === 0
                        ? <span>全部可用（未收窄）</span>
                        : <span>{bound.length} 个</span>}
                    </div>
                    {bound.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {bound.map((id) => (
                          <Badge key={id} variant="secondary" className="max-w-full text-[10px]">
                            <span className="truncate">{instanceNameOf(resources, kind, id)}</span>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 添加 picker：服务卡片网格（宽弹框，两列），工具类进入实例勾选步。 */}
      <Dialog open={pickerOpen} onOpenChange={(open) => { if (!open) { setPickerOpen(false); setInstanceTarget(null) } }}>
        <DialogContent className="z-[80] flex max-h-[75vh] flex-col overflow-hidden sm:max-w-2xl" overlayClassName="z-[80]">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {instanceTarget ? `配置「${instanceTarget.name}」可操作的实例` : "添加 MCP"}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {pickingService ? (
              serviceCandidates.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">暂无可添加的服务。</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {serviceCandidates.map((svc) => {
                    const key = requiredParamOf(svc)
                    const boundCount = key ? boundInstancesOf(svc).length : 0
                    const meta = [
                      svc.description,
                      svc.tool_count ? `${svc.tool_count} 个工具` : "",
                      key ? "需绑定实例" : "",
                    ].filter(Boolean).join(" · ")
                    const card = (
                      <button
                        key={svc.resource_id}
                        type="button"
                        disabled={svc.stdio}
                        className={`flex min-w-0 flex-col gap-1 rounded-lg border p-3 text-left text-sm transition-colors ${
                          svc.stdio ? "cursor-not-allowed opacity-50" : "hover:border-primary/40 hover:bg-accent/40"
                        }`}
                        onClick={() => pickService(svc)}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="truncate font-medium">{svc.name}</span>
                          {boundCount > 0 && (
                            <Badge variant="secondary" className="shrink-0 text-[10px]">已添加</Badge>
                          )}
                        </div>
                        {meta && <span className="line-clamp-2 text-[11px] text-muted-foreground">{meta}</span>}
                      </button>
                    )
                    return svc.stdio ? (
                      <TooltipProvider key={svc.resource_id}>
                        <Tooltip>
                          <TooltipTrigger asChild>{card}</TooltipTrigger>
                          <TooltipContent>stdio 执行器未实装，暂不可添加</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      card
                    )
                  })}
                </div>
              )
            ) : (
              instanceTarget && (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-muted-foreground">
                    勾选「{instanceTarget.name}」可操作的{pickingKind?.label || "实例"}；不勾 = 默认全部可用。
                  </p>
                  {pickingCandidates.length === 0 ? (
                    <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                      当前没有可绑定的{pickingKind?.label || "实例"}；不勾选即默认全量。
                    </p>
                  ) : (
                    <div className="grid max-h-[45vh] gap-1.5 overflow-y-auto pr-1">
                      {pickingCandidates.map((cand) => {
                        const checked = instanceDraft.includes(cand.id)
                        return (
                          <label
                            key={cand.id}
                            className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                              checked ? "border-primary/40 bg-accent/40" : "hover:bg-accent/40"
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(on) =>
                                setInstanceDraft((d) =>
                                  on ? [...d, cand.id] : d.filter((v) => v !== cand.id),
                                )
                              }
                            />
                            <span className="truncate">{cand.name}</span>
                            {checked && (
                              <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">已选</Badge>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
          {!pickingService && instanceTarget && (
            <div className="flex shrink-0 justify-end gap-2 border-t pt-3">
              <Button variant="outline" size="sm" onClick={() => { setPickerOpen(false); setInstanceTarget(null) }}>
                取消
              </Button>
              <Button size="sm" onClick={confirmInstances}>确认</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}