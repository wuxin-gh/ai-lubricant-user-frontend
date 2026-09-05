/**
 * 通用 MCP 用户参数编辑器（用户侧 / 管理端共用同一套交互）。
 *
 * principal 自带操作参数：CDP 客户端（param_key=cdp_client_id）、邮箱账户
 * （param_key=mail_account_id）等。每个 param_key 一个值（UNIQUE），driver 鉴权时
 * 直接读 param 定位资源，不再有 grant 子权限树。
 *
 * 各入口（用户侧 principal、管理端 MCP 用户、Agent 已绑定 principal）共用本组件，
 * 差异仅是 API 适配器（resources/params 来源）与入口文本。token 在此入口全程隐藏。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState, type ForwardedRef } from "react"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

/** 可选资源（来自 authorization/options）：CDP/Mail 实例 + 其下可绑的子项。 */
export interface PermResource {
  resource_kind: "service" | "builtin_instance"
  resource_id: number
  resource_type: string
  name: string
  url?: string
  description?: string
  tool_count?: number
  transport?: string
  children: Array<{ child_kind: string; child_id: number; name: string }>
}

/** principal 的一个操作参数。param_key 决定绑哪类资源，param_value 是资源 id。 */
export interface PermParam {
  param_key: string
  param_value: string
}

/** 可绑的 param_key → 显示信息 + 从资源子项里取候选 value。 */
interface ParamKind {
  key: string
  label: string
  child_kind: string
}

const PARAM_KINDS: ParamKind[] = [
  { key: "cdp_client_id", label: "CDP 浏览器客户端", child_kind: "cdp_client" },
  { key: "mail_account_id", label: "邮箱账户", child_kind: "mail_account" },
]

/** 各入口注入的 API 适配器：资源候选、params 读写。 */
export interface PermissionEditorApi {
  loadResources: () => Promise<PermResource[]>
  loadParams: (principalId: number) => Promise<PermParam[]>
  saveParams: (principalId: number, params: PermParam[]) => Promise<PermParam[]>
}

export interface PermissionEditorHandle {
  /** 保存当前 draft 参数；返回是否成功。供外层统一保存按钮调用。 */
  save: () => Promise<boolean>
}

interface PermissionEditorProps {
  principalId: number
  api: PermissionEditorApi
  title: string
  onClose?: () => void
  embedded?: boolean
}

/** 从全部资源里收集某 param_key 的可选子项（去重）。 */
function collectCandidates(resources: PermResource[], kind: ParamKind) {
  const seen = new Set<number>()
  const out: { child_id: number; name: string; instance_name: string }[] = []
  for (const r of resources) {
    for (const child of r.children) {
      if (child.child_kind === kind.child_kind && !seen.has(child.child_id)) {
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
  const [draft, setDraft] = useState<PermParam[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addQuery, setAddQuery] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, params] = await Promise.all([
        api.loadResources(),
        api.loadParams(principalId),
      ])
      setResources(res)
      setDraft(params)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载参数失败")
    } finally {
      setLoading(false)
    }
  }, [api, principalId])

  useEffect(() => {
    void load()
  }, [load])

  /** 某 param_key 是否已绑。 */
  const paramOf = (key: string) => draft.find((p) => p.param_key === key)

  const addParam = (key: string, value: string) => {
    setDraft((d) => {
      const exists = d.some((p) => p.param_key === key)
      return exists ? d.map((p) => (p.param_key === key ? { ...p, param_value: value } : p)) : [...d, { param_key: key, param_value: value }]
    })
    setAdding(false)
  }

  const removeParam = (key: string) => {
    setDraft((d) => d.filter((p) => p.param_key !== key))
  }

  const save = async () => {
    setSaving(true)
    try {
      const saved = await api.saveParams(principalId, draft)
      setDraft(saved)
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存参数失败")
      return false
    } finally {
      setSaving(false)
    }
  }

  useImperativeHandle(ref, () => ({ save }), [save])

  const openAddPicker = () => { setAdding(true); setAddQuery("") }
  const closeAddPicker = () => setAdding(false)

  /** 添加面板：列出所有可绑 param_kind + 该 kind 下的候选子项。已绑的 kind 标灰。 */
  const candidatesByKind = useMemo(() => {
    const q = addQuery.trim().toLowerCase()
    return PARAM_KINDS.map((kind) => {
      const items = collectCandidates(resources, kind).filter((c) =>
        !q || c.name.toLowerCase().includes(q) || c.instance_name.toLowerCase().includes(q),
      )
      return { kind, items }
    }).filter((g) => g.items.length > 0)
  }, [resources, addQuery])

  /** 某 param_value（child_id 字符串）的显示名。 */
  const labelForValue = (key: string, value: string) => {
    const kind = PARAM_KINDS.find((k) => k.key === key)
    if (!kind) return value
    const cands = collectCandidates(resources, kind)
    return cands.find((c) => String(c.child_id) === value)?.name || value
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{title}</div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openAddPicker}>
          <Plus className="size-3.5" /> 添加参数
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3" /> 加载中...
        </div>
      ) : draft.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-dashed p-5 text-center text-xs text-muted-foreground">
          当前未配置操作参数。点击右上角「添加参数」绑定 CDP 客户端 / 邮箱账户。
        </div>
      ) : (
        <div className="grid content-start gap-2 sm:grid-cols-2">
          {draft.map((p) => {
            const kind = PARAM_KINDS.find((k) => k.key === p.param_key)
            return (
              <div key={p.param_key} className="flex flex-col rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{kind?.label || p.param_key}</Badge>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => removeParam(p.param_key)}>
                    <Trash2 className="size-3" /> 移除
                  </Button>
                </div>
                <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                  <span className="shrink-0">绑定资源</span>
                  <code className="break-all font-mono">{labelForValue(p.param_key, p.param_value)}</code>
                  <span className="shrink-0 mt-1">参数</span>
                  <code className="break-all font-mono text-[10px]">{p.param_key} = {p.param_value}</code>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={adding} onOpenChange={(open) => { if (!open) closeAddPicker() }}>
        <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加参数</DialogTitle>
          </DialogHeader>
          <Input value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder="搜索资源..." className="h-8 text-xs" />
          {candidatesByKind.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">暂无可添加项。</p>
          ) : (
            <div className="grid gap-3">
              {candidatesByKind.map(({ kind, items }) => {
                const bound = paramOf(kind.key)
                return (
                  <div key={kind.key} className="grid gap-1">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <span>{kind.label}</span>
                      {bound && <Badge variant="secondary" className="text-[10px]">已绑</Badge>}
                    </div>
                    {items.map((c) => (
                      <button
                        key={`${kind.key}:${c.child_id}`}
                        type="button"
                        className="flex items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => addParam(kind.key, String(c.child_id))}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{c.name}</span>
                          <Badge variant="outline" className="text-[10px]">{c.instance_name}</Badge>
                        </div>
                        <Plus className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {embedded && (
        <div className="flex justify-end gap-2">
          {onClose && <Button variant="outline" onClick={onClose}>取消</Button>}
          <Button disabled={saving || loading} onClick={() => void save()}>
            {saving ? "保存中…" : "保存参数"}
          </Button>
        </div>
      )}

      {saving && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3" /> 保存中…
        </div>
      )}
    </div>
  )
}

export const McpUserPermissionEditor = forwardRef(McpUserPermissionEditorInner)
