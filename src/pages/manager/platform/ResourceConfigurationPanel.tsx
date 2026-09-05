import { useCallback, useEffect, useState, type ReactNode } from "react"
import { RefreshCw, Save } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { fetchMarketIndex, fetchMarketManifest } from "@/api/marketplaceRaw"
import {
  getMarketplaceSourceConfig,
  getProxyPoolTabConfig,
  updateMarketplaceSourceConfig,
  type MarketplaceSourceConfig,
} from "@/@admin-port/api/globalConfig"
import type { ProxyEntry } from "@/@admin-port/api/proxyPool"
import { toast } from "sonner"

/**
 * 资源中心「配置」Tab：市场仓库源配置 + 节点程序版本信息。
 *
 * 市场仓库、节点程序版本、渠道目录同步共用同一个 GitHub 市场仓库，所以只有这一份
 * 源配置（存 DB 主配置，改完热更新）。token 只显示「是否已配」，不回显明文。
 * 版本/更新日期/版本说明来自市场 raw（GitHub 下载），不是本地库；点「立即更新」只刷新
 * 这份版本信息，不修改仓库内容。渠道模板目录由后端每小时自动同步，不在配置内展示。
 */

function FormField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {hint ? <p className="text-xs leading-4 text-muted-foreground">{hint}</p> : null}
      {children}
    </div>
  )
}

export function ResourceConfigurationPanel() {
  const [config, setConfig] = useState<MarketplaceSourceConfig | null>(null)
  const [proxies, setProxies] = useState<ProxyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [repoUrl, setRepoUrl] = useState("")
  const [proxyId, setProxyId] = useState("")
  const [tokenInput, setTokenInput] = useState("")

  // 只读版本信息（市场 raw）。渠道模板信息不在配置内展示，由后端每小时自动同步。
  const [nodeVersion, setNodeVersion] = useState<{ version?: string; updated_at?: string; notes?: string } | null>(null)
  const [versionRefreshing, setVersionRefreshing] = useState(false)

  const refreshVersion = useCallback(async () => {
    setVersionRefreshing(true)
    try {
      const nodeIdx = await fetchMarketIndex("node-versions", true).catch(() => [])
      // index 不保证按版本号排序：按 latest_version 取最大，而不是直接取第一条。
      // 版本号形如 20260816-0846（YYYYMMDD-HHMM），字符串序即时间序，够用。
      const latest = [...nodeIdx]
        .filter((it) => it.latest_version)
        .sort((a, b) => String(b.latest_version).localeCompare(String(a.latest_version)))[0]
      if (latest?.id) {
        const manifest = await fetchMarketManifest("node-versions", latest.id, true).catch(() => null)
        const extra = (manifest || {}) as Record<string, unknown>
        setNodeVersion({
          version: String(manifest?.version || latest.latest_version || ""),
          updated_at: String(extra.updated_at || ""),
          notes: String(extra.version_notes || extra.release_notes || ""),
        })
      } else {
        setNodeVersion(null)
      }
    } finally {
      setVersionRefreshing(false)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [source, proxyResp] = await Promise.all([
        getMarketplaceSourceConfig(),
        getProxyPoolTabConfig().catch(() => ({ proxies: [] as ProxyEntry[] })),
      ])
      setConfig(source)
      setProxies(proxyResp.proxies || [])
      setRepoUrl(source.repo_url)
      setProxyId(source.proxy_id)
      setTokenInput("")
      // 版本信息单独刷新，便于「立即更新」按钮复用同一段逻辑。
      await refreshVersion()
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载市场源配置失败")
    } finally {
      setLoading(false)
    }
  }, [refreshVersion])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateMarketplaceSourceConfig({
        repo_url: repoUrl.trim(),
        proxy_id: proxyId,
        // 留空=不改原 token；填了才下发。
        ...(tokenInput.trim() ? { github_token: tokenInput.trim() } : {}),
      })
      toast.success("市场源配置已保存并即时生效")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-12"><Spinner className="size-6" /></div>
  }

  const effective = config?.effective
  void effective // 预留：源配置生效态当前不在卡片展示，保留字段以备后续只读回显

  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription>
          市场仓库、节点程序版本、渠道目录同步共用同一个 GitHub 市场仓库。这份配置同时决定：市场展示读哪个仓库、
          渠道目录从哪个仓库同步、节点程序从哪个仓库下载。保存后立即生效，无需重启。
        </AlertDescription>
      </Alert>

      <Card className="shadow-none">
        <CardHeader className="pb-3"><CardTitle className="text-base">仓库源</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <FormField label="仓库地址" hint={`留空则使用内置默认：${config?.default_repo_url || ""}`}>
            <Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder={config?.default_repo_url} />
          </FormField>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="市场拉取代理" hint="raw / release 下载走这个代理；留空直连 GitHub。">
              <NativeSelect value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
                <NativeSelectOption value="">不使用代理，直接连接 GitHub</NativeSelectOption>
                {proxies.map((proxy) => (
                  <NativeSelectOption key={proxy.id} value={proxy.id}>
                    {proxy.name}（{proxy.mode === "direct" ? "直连" : proxy.url || proxy.mode}）
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              label="写入 Token"
              hint={config?.github_token_set
                ? "已配置（留空保存则保持不变）；需要更换时粘贴新 token。"
                : "未配置：市场可看但不可管理（新建/发布/删除需要 token）。"}
            >
              <Input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder={config?.github_token_set ? "••••••（留空不改）" : "粘贴具备 Contents 读写权限的 GitHub token"}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader className="pb-3"><CardTitle className="text-base">版本与更新</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 p-3 text-sm">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">节点程序版本</div>
              <div className="mt-1 truncate font-medium">{nodeVersion?.version ? `v${nodeVersion.version}` : "市场尚未发布"}</div>
              <div className="text-xs text-muted-foreground">更新日期：{nodeVersion?.updated_at || "-"}</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={versionRefreshing}
              onClick={() => void refreshVersion()}
            >
              {versionRefreshing ? <Spinner className="mr-1 size-4" /> : <RefreshCw className="mr-1 size-4" />}
              重新读取
            </Button>
          </div>
          {nodeVersion?.notes ? (
            <div className="rounded-md border p-3">
              <div className="text-xs font-medium text-muted-foreground">版本说明</div>
              <Textarea readOnly value={nodeVersion.notes} className="mt-2 resize-y font-mono text-xs" rows={4} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => void load()} disabled={saving}>
          <RefreshCw className="mr-1 h-4 w-4" />重新加载
        </Button>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Spinner className="mr-2 size-4" /> : <Save className="mr-2 size-4" />}保存配置
        </Button>
      </div>
    </div>
  )
}
