import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import {
  clearNodeShellApproval,
  deleteNodeShellApproval,
  getNodeShellApprovalCatalog,
  listNodeShellApproval,
  putNodeShellApproval,
  type NodeShellApprovalPolicy,
  type ShellApprovalCatalogItem,
  type ShellFlavor,
} from "@/@admin-port/api/nodes"

const SHELLS: { value: ShellFlavor; label: string }[] = [
  { value: "posix", label: "POSIX" },
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "unknown", label: "未知" },
]

export function NodeShellApproval({ nodeId }: { nodeId: string }) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [shell, setShell] = useState<ShellFlavor>("unknown")
  const [actualShell, setActualShell] = useState<ShellFlavor>("unknown")
  const [catalog, setCatalog] = useState<Record<ShellFlavor, ShellApprovalCatalogItem[]>>({} as Record<ShellFlavor, ShellApprovalCatalogItem[]>)
  const [policies, setPolicies] = useState<NodeShellApprovalPolicy[]>([])
  const [customInput, setCustomInput] = useState("")

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [catalogResult, listResult] = await Promise.all([
        getNodeShellApprovalCatalog(nodeId),
        listNodeShellApproval(nodeId),
      ])
      setCatalog(catalogResult.catalog)
      setPolicies(listResult.policies ?? [])
      setActualShell(listResult.actual_shell_flavor)
      setShell(listResult.actual_shell_flavor)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载授权配置失败")
    } finally {
      setLoading(false)
    }
  }, [nodeId])

  useEffect(() => {
    void reload()
  }, [reload])

  const checkedKeys = useMemo(
    () => new Set(policies.filter((policy) => policy.shell_flavor === shell).map((policy) => policy.command_key)),
    [policies, shell],
  )
  const presetItems = catalog[shell] ?? []
  const customKeys = useMemo(() => {
    const presets = new Set(presetItems.map((item) => item.key))
    return policies.filter((policy) => policy.shell_flavor === shell && !presets.has(policy.command_key))
  }, [policies, presetItems, shell])

  async function toggle(key: string, enabled: boolean) {
    if (busy) return
    setBusy(true)
    try {
      if (enabled) {
        const saved = await putNodeShellApproval(nodeId, key, shell)
        setPolicies((current) => [...current.filter((item) => !(item.command_key === saved.command_key && item.shell_flavor === saved.shell_flavor)), saved])
      } else {
        await deleteNodeShellApproval(nodeId, key, shell)
        setPolicies((current) => current.filter((item) => !(item.command_key === key && item.shell_flavor === shell)))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新授权配置失败")
    } finally {
      setBusy(false)
    }
  }

  async function addCustom() {
    const value = customInput.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      const saved = await putNodeShellApproval(nodeId, value, shell)
      setPolicies((current) => [...current.filter((item) => !(item.command_key === saved.command_key && item.shell_flavor === saved.shell_flavor)), saved])
      setCustomInput("")
      toast.success(`已授权 ${saved.command_key}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "添加授权失败")
    } finally {
      setBusy(false)
    }
  }

  async function clearCurrentShell() {
    if (busy || !window.confirm(`确认清空该节点的 ${shell} 授权配置？`)) return
    setBusy(true)
    try {
      await clearNodeShellApproval(nodeId, shell)
      setPolicies((current) => current.filter((item) => item.shell_flavor !== shell))
      toast.success("已清空当前终端配置")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清空失败")
    } finally {
      setBusy(false)
    }
  }

  async function clearAll() {
    if (busy || !window.confirm("确认清空该节点全部终端类型的授权配置？此操作不会影响其他节点。")) return
    setBusy(true)
    try {
      await clearNodeShellApproval(nodeId)
      setPolicies([])
      toast.success("已清空该节点全部授权配置")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清空失败")
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">命令授权配置</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            该节点上的所有用户、Agent 和管理员代理调用共享此配置，仅对本节点生效。未授权的非只读命令仍会逐次确认；重定向、命令替换、脚本块等危险结构始终需要确认。
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void reload()} disabled={busy}>
          <RefreshCw className="size-4" />刷新
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">实际终端</span>
        <Badge variant={actualShell === "unknown" ? "destructive" : "secondary"}>{actualShell}</Badge>
        {actualShell === "unknown" ? <span className="flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="size-3.5" />节点尚未上报操作系统，配置只会匹配 unknown。</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {SHELLS.map((item) => (
          <Button key={item.value} size="sm" variant={shell === item.value ? "default" : "outline"} onClick={() => setShell(item.value)}>
            {item.label}
            {item.value !== actualShell ? <span className="ml-1 text-[10px] opacity-70">未生效</span> : null}
          </Button>
        ))}
      </div>

      <section className="space-y-2">
        <h4 className="text-sm font-medium">预置命令</h4>
        {presetItems.length ? (
          <div className="space-y-1.5">
            {presetItems.map((item) => (
              <div key={`${shell}:${item.key}`} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="text-sm font-medium">{item.label}</span><code className="text-xs text-muted-foreground">{item.key}</code></div>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <Switch checked={checkedKeys.has(item.key)} onCheckedChange={(checked) => void toggle(item.key, checked)} disabled={busy} />
              </div>
            ))}
          </div>
        ) : <p className="rounded-md border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">该终端类型暂无预置命令。</p>}
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-medium">自定义单命令</h4>
        <div className="flex gap-2">
          <Input value={customInput} onChange={(event) => setCustomInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addCustom() } }} placeholder="例如 rm 或 git reset" disabled={busy} />
          <Button size="sm" onClick={() => void addCustom()} disabled={busy || !customInput.trim()}>添加</Button>
        </div>
        {customKeys.map((policy) => (
          <div key={`${policy.shell_flavor}:${policy.command_key}`} className="flex items-center justify-between rounded-md border px-3 py-2">
            <div className="flex items-center gap-2"><Badge variant="secondary">自定义</Badge><code className="text-sm">{policy.command_key}</code></div>
            <Button size="icon" variant="ghost" className="size-7" onClick={() => void toggle(policy.command_key, false)} disabled={busy}><Trash2 className="size-3.5 text-destructive" /></Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">服务端会返回规范化 key（例如 git reset → git:reset）；复合命令和危险 shell 结构不能加入授权。</p>
      </section>

      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button size="sm" variant="outline" onClick={() => void clearCurrentShell()} disabled={busy || !policies.some((item) => item.shell_flavor === shell)}>清空当前终端配置</Button>
        <Button size="sm" variant="destructive" onClick={() => void clearAll()} disabled={busy || policies.length === 0}>清空该节点全部配置</Button>
      </div>
    </div>
  )
}
