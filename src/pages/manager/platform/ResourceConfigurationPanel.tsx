import { useCallback, useEffect, useState, type ReactNode } from "react"
import { History, RefreshCw, Save } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { fetchMarketIndex, fetchMarketManifest } from "@/api/marketplaceRaw"
import { VersionHistoryDialog } from "./VersionHistoryDialog"
import {
  getMarketplaceSourceConfig,
  getProxyPoolTabConfig,
  updateMarketplaceSourceConfig,
} from "@/@admin-port/api/globalConfig"
import type { ProxyEntry } from "@/@admin-port/api/proxyPool"
import { toast } from "sonner"

/**
 * 资源中心「配置」Tab：市场仓库源配置 + 节点程序版本信息。
 *
 * 市场仓库、节点程序版本、渠道目录同步共用同一个 GitHub 市场仓库。仓库地址与写入
 * Token 只在服务端 .env 配置（MARKETPLACE_REPO_URL / MARKETPLACE_GITHUB_TOKEN），
 * 不在此处展示或编辑；可编辑的仅市场拉取代理（存 DB 主配置，改完热更新）。
 * 版本/版本说明来自市场 raw（GitHub 下载），不是本地库；点「重新读取」只刷新
 * 这份版本信息，不修改仓库内容。渠道模板目录由后端每小时自动同步，不在配置内展示。
 */

type ReleaseModule = "node-versions" | "mobile-versions" | "device-control-versions"
type ReleaseInfo = { version: string; notes: string }

const RELEASE_MODULES: { module: ReleaseModule; label: string }[] = [
  { module: "node-versions", label: "节点程序" },
  { module: "mobile-versions", label: "App 程序" },
  { module: "device-control-versions", label: "App 控制程序" },
]
const EMPTY_RELEASES: Record<ReleaseModule, ReleaseInfo | null> = {
  "node-versions": null,
  "mobile-versions": null,
  "device-control-versions": null,
}

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
  const [proxies, setProxies] = useState<ProxyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [proxyId, setProxyId] = useState("")

  // 只读版本信息（市场 raw，三个发行模块并行拉取）。渠道模板信息不在配置内展示，
  // 由后端每小时自动同步。
  const [releases, setReleases] = useState<Record<ReleaseModule, ReleaseInfo | null>>(EMPTY_RELEASES)
  const [versionRefreshing, setVersionRefreshing] = useState(false)
  const [historyModule, setHistoryModule] = useState<ReleaseModule | null>(null)

  const refreshVersion = useCallback(async () => {
    setVersionRefreshing(true)
    try {
      const next: Record<ReleaseModule, ReleaseInfo | null> = { ...EMPTY_RELEASES }
      await Promise.all(RELEASE_MODULES.map(async ({ module }) => {
        const idx = await fetchMarketIndex(module, true).catch(() => [])
        // index 不保证按版本号排序：按 latest_version 取最大，而不是直接取第一条。
        // 版本号形如 20260816-0846（YYYYMMDD-HHMM），字符串序即时间序，够用。
        const latest = [...idx]
          .filter((it) => it.latest_version)
          .sort((a, b) => String(b.latest_version).localeCompare(String(a.latest_version)))[0]
        if (!latest?.id) return
        const manifest = await fetchMarketManifest(module, latest.id, true).catch(() => null)
        const extra = (manifest || {}) as Record<string, unknown>
        next[module] = {
          version: String(manifest?.version || latest.latest_version || ""),
          // manifest 拉取失败时回落 index summary（服务端写入时取 version_notes 首行）。
          notes: String(extra.version_notes || extra.release_notes || latest.summary || ""),
        }
      }))
      setReleases(next)
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
      setProxies(proxyResp.proxies || [])
      setProxyId(source.proxy_id)
      // 版本信息单独刷新，便于「重新读取」按钮复用同一段逻辑。
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
      await updateMarketplaceSourceConfig({ proxy_id: proxyId })
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

  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription>
          市场仓库、节点程序版本、渠道目录同步共用同一个 GitHub 市场仓库；仓库地址与写入 Token
          由服务端 .env（MARKETPLACE_REPO_URL / MARKETPLACE_GITHUB_TOKEN）统一配置，此处不再展示。
          可编辑的仅市场拉取代理，保存后立即生效，无需重启。
        </AlertDescription>
      </Alert>

      <Card className="shadow-none">
        <CardHeader className="pb-3"><CardTitle className="text-base">仓库源</CardTitle></CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-medium">版本与更新</h3>
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
        {RELEASE_MODULES.map(({ module, label }) => {
          const info = releases[module]
          return (
            <Card key={module} className="shadow-none">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">{label}</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => setHistoryModule(module)}>
                    <History className="mr-1 size-4" />查看历史
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <div className="text-xs text-muted-foreground">{label}版本</div>
                  <div className="mt-1 truncate font-medium">{info?.version ? `v${info.version}` : "市场尚未发布"}</div>
                </div>
                {info?.notes ? (
                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium text-muted-foreground">版本说明</div>
                    <Textarea readOnly value={info.notes} className="mt-2 resize-y font-mono text-xs" rows={4} />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <VersionHistoryDialog
        module={historyModule ?? "node-versions"}
        title={`${RELEASE_MODULES.find((m) => m.module === historyModule)?.label ?? ""}版本历史`}
        open={historyModule !== null}
        onOpenChange={(o) => { if (!o) setHistoryModule(null) }}
      />

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
