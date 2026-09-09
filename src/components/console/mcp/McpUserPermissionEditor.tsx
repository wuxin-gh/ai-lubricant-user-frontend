/**
 * 通用 MCP 用户授权编辑器（用户侧 / 管理端共用同一套交互）。
 *
 * 两段式授权（mcp_grants 表）：
 *  - 服务区：authorization/options 的 resources 里 resource_kind==='service' 项，多选；
 *    stdio 项（stdio=true）标灰 + tooltip「执行器未实装」禁用。选中写 grant_key='service'
 *    +service_id 行。
 *  - 实例区：按 param_kinds 目录（后端 mcp_builtin.catalog 派生，前端不再硬编码）
 *    动态渲染；每个 param_kind 从 resources 里 resource_kind==='builtin_resource' 且
 *    resource_type 匹配的实例里多选；空选=默认全量语义。选中写 grant_key=param_key
 *    +资源 id 行。
 *
 * 各入口（用户侧 principal、管理端 MCP 用户、Agent/Task 已绑定 principal）共用本组件，
 * 差异仅是 API 适配器（resources/param_kinds + grants 来源）与入口文本。token 全程隐藏。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState, type ForwardedRef } from "react"
import { toast } from "sonner"
import { Info } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

/** 可选资源（来自 authorization/options）：service 与 builtin_resource 实例 + 其下可绑子项。 */
export interface PermResource {
  // "service" | "builtin_resource"（旧来源可能给 "builtin_instance"）；放宽为 string。
  resource_kind: string
  resource_id: number
  resource_type: string
  name: string
  url?: string
  description?: string
  tool_count?: number
  transport?: string
  /** service 项执行器 kind；stdio=true 时标灰禁用。 */
  kind?: string
  stdio?: boolean
  required_param?: string
  children: Array<{ child_kind: string; child_id: number; name: string }>
}

/** principal 的一个授权行。grant_key 决定绑哪类资源，grant_value 是资源 id。 */
export interface PermGrant {
  grant_key: string
  grant_value: string
  created_at?: string | null
}

/** authorization/options 下发的 param 类型目录（替代前端硬编码 PARAM_KINDS）。 */
export interface PermParamKind {
  key: string
  label: string
  resource_type: string
}

/** loadResources 返回：资源候选 + param 类型目录。 */
export interface PermOptions {
  resources: PermResource[]
  param_kinds: PermParamKind[]
}

/** 各入口注入的 API 适配器：资源候选（含 param_kinds）+ grants 读写。 */
export interface PermissionEditorApi {
  loadResources: () => Promise<PermOptions>
  loadGrants: (principalId: number) => Promise<PermGrant[]>
  saveGrants: (principalId: number, grants: PermGrant[]) => Promise<PermGrant[]>
}

export interface PermissionEditorHandle {
  /** 保存当前 draft 授权；返回是否成功。供外层统一保存按钮调用。 */
  save: () => Promise<boolean>
}

interface PermissionEditorProps {
  principalId: number
  api: PermissionEditorApi
  title: string
  onClose?: () => void
  embedded?: boolean
}

/** 服务授权行 grant_key。与后端 mcp_plugin_store.GRANT_SERVICE_KEY 同值。 */
const SERVICE_GRANT_KEY = "service"

/**
 * 从全部资源里收集某 param_kind 的可选实例（去重）。
 *
 * 内置资源实例（cdp_client / mail_account / device）是一级资源：authorization/options
 * 把它们作为顶层 builtin_resource 返回（children 为空），资源本身就是候选。children
 * 兼容路径保留给仍按树返回的来源（如 mail_address 挂邮箱账户下）。
 */
function collectCandidates(resources: PermResource[], kind: PermParamKind) {
  const seen = new Set<number>()
  const out: { child_id: number; name: string; instance_name: string }[] = []
  for (const r of resources) {
    if (r.resource_type === kind.resource_type) {
      const id = Number(r.resource_id)
      if (Number.isFinite(id) && !seen.has(id)) {
        seen.add(id)
        out.push({ child_id: id, name: r.name, instance_name: "" })
      }
      continue
    }
    for (const child of r.children) {
      if (child.child_kind === kind.resource_type && !seen.has(child.child_id)) {
        seen.add(child.child_id)
        out.push({ child_id: child.child_id, name: child.name, instance_name: r.name })
      }
    }
  }
  return out
}

function McpUserPermissionEditorInner({
    principalId,
    api,
    title,
    onClose,
    embedded = false,
  }: PermissionEditorProps, ref: ForwardedRef<PermissionEditorHandle>) {
  const [resources, setResources] = useState<PermResource[]>([])
  const [paramKinds, setParamKinds] = useState<PermParamKind[]>([])
  const [draft, setDraft] = useState<PermGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [opts, grants] = await Promise.all([
        api.loadResources(),
        api.loadGrants(principalId),
      ])
      setResources(opts.resources || [])
      setParamKinds(opts.param_kinds || [])
      setDraft(grants || [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载授权失败")
    } finally {
      setLoading(false)
    }
  }, [api, principalId])

  useEffect(() => {
    void load()
  }, [load])

  /** 服务区候选：resource_kind==='service' 的项。 */
  const serviceCandidates = useMemo(
    () => resources.filter((r) => r.resource_kind === SERVICE_GRANT_KEY),
    [resources],
  )

  /** 实例区目录 + 各自候选（param_kinds 为空时实例区整体不渲染）。 */
  const instanceGroups = useMemo(
    () => paramKinds.map((kind) => ({ kind, items: collectCandidates(resources, kind) })),
    [paramKinds, resources],
  )

  const isServiceSelected = (svc: PermResource) =>
    draft.some((g) => g.grant_key === SERVICE_GRANT_KEY && g.grant_value === String(svc.resource_id))

  const toggleService = (svc: PermResource, on: boolean) => {
    setDraft((d) => {
      const id = String(svc.resource_id)
      const exists = d.some((g) => g.grant_key === SERVICE_GRANT_KEY && g.grant_value === id)
      if (on && !exists) return [...d, { grant_key: SERVICE_GRANT_KEY, grant_value: id }]
      if (!on && exists) return d.filter((g) => !(g.grant_key === SERVICE_GRANT_KEY && g.grant_value === id))
      return d
    })
  }

  const isInstanceSelected = (kindKey: string, childId: number) =>
    draft.some((g) => g.grant_key === kindKey && g.grant_value === String(childId))

  const toggleInstance = (kindKey: string, childId: number, on: boolean) => {
    setDraft((d) => {
      const id = String(childId)
      const exists = d.some((g) => g.grant_key === kindKey && g.grant_value === id)
      if (on && !exists) return [...d, { grant_key: kindKey, grant_value: id }]
      if (!on && exists) return d.filter((g) => !(g.grant_key === kindKey && g.grant_value === id))
      return d
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      const saved = await api.saveGrants(principalId, draft)
      setDraft(saved || [])
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存授权失败")
      return false
    } finally {
      setSaving(false)
    }
  }

  useImperativeHandle(ref, () => ({ save }), [save])

  const serviceSelectedCount = draft.filter((g) => g.grant_key === SERVICE_GRANT_KEY).length

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">服务 {serviceSelectedCount}</Badge>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3" /> 加载中...
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {/* 服务区 */}
          <section className="grid gap-1.5">
            <div className="text-xs font-medium">服务</div>
            {serviceCandidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无可授权服务。</p>
            ) : (
              <div className="grid content-start gap-1 sm:grid-cols-2">
                {serviceCandidates.map((svc) => {
                  const checked = isServiceSelected(svc)
                  const stdio = svc.stdio === true
                  const id = String(svc.resource_id)
                  const row = (
                    <label
                      key={`svc:${id}`}
                      className={`flex items-start gap-2 rounded-md border p-2 text-xs ${stdio ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-accent"}`}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={stdio}
                        onCheckedChange={(v) => toggleService(svc, Boolean(v))}
                        className="mt-0.5"
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{svc.name}</span>
                          {svc.kind && <Badge variant="outline" className="text-[10px]">{svc.kind}</Badge>}
                          {stdio && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <Info className="size-3" /> 未实装
                            </span>
                          )}
                        </div>
                        {svc.description && <span className="line-clamp-2 text-[11px] text-muted-foreground">{svc.description}</span>}
                      </div>
                    </label>
                  )
                  return stdio ? (
                    <TooltipProvider key={`svc:${id}`}>
                      <Tooltip>
                        <TooltipTrigger asChild>{row}</TooltipTrigger>
                        <TooltipContent>执行器未实装（stdio 部署形态暂不可授权）</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : row
                })}
              </div>
            )}
          </section>

          {/* 实例区 */}
          <section className="grid gap-2">
            <div className="flex items-center gap-2 text-xs font-medium">
              <span>实例</span>
              <span className="text-[10px] font-normal text-muted-foreground">不选即默认全量授权</span>
            </div>
            {instanceGroups.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无可配置实例类型（param_kinds 目录为空）。</p>
            ) : (
              <div className="grid gap-3">
                {instanceGroups.map(({ kind, items }) => {
                  const selected = draft.filter((g) => g.grant_key === kind.key)
                  return (
                    <div key={kind.key} className="grid gap-1.5 rounded-md border p-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium">{kind.label}</span>
                        {selected.length === 0
                          ? <Badge variant="secondary" className="text-[10px]">全部</Badge>
                          : <Badge variant="outline" className="text-[10px]">{selected.length}</Badge>}
                      </div>
                      {items.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">暂无可用实例。</p>
                      ) : (
                        <div className="grid content-start gap-1 sm:grid-cols-2">
                          {items.map((c) => {
                            const checked = isInstanceSelected(kind.key, c.child_id)
                            return (
                              <label
                                key={`inst:${kind.key}:${c.child_id}`}
                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(v) => toggleInstance(kind.key, c.child_id, Boolean(v))}
                                />
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate">{c.name}</span>
                                  {c.instance_name && <Badge variant="outline" className="text-[10px]">{c.instance_name}</Badge>}
                                </div>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {embedded && (
        <div className="flex justify-end gap-2">
          {onClose && <Button variant="outline" onClick={onClose}>取消</Button>}
          <Button disabled={saving || loading} onClick={() => void save()}>
            {saving ? "保存中…" : "保存授权"}
          </Button>
        </div>
      )}

      {saving && !embedded && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3" /> 保存中…
        </div>
      )}
    </div>
  )
}

export const McpUserPermissionEditor = forwardRef(McpUserPermissionEditorInner)
