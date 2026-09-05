/** GitHub 市场项到编辑器 SkillSpec / NodePluginSpec 的安全映射。 */
import { useCallback, useEffect, useMemo, useState } from "react"

import {
  fetchMarketManifest,
  manifestToPluginSpec,
  manifestToSkillSpec,
  MARKET_SOURCE,
  type MarketManifest,
  type MarketModule,
} from "@/api/marketplaceRaw"

type MarketAware = { id?: string | number; name?: string; market_id?: string; __source?: string }
type ConfigEntry = Record<string, unknown>
type LoadState = { manifests: Record<string, MarketManifest>; pending: Set<string>; failed: Set<string> }

function useManifests(items: MarketAware[], module: MarketModule): LoadState {
  const [state, setState] = useState<LoadState>({ manifests: {}, pending: new Set(), failed: new Set() })
  const marketIds = useMemo(() => items.filter((item) => item.__source === MARKET_SOURCE && item.market_id).map((item) => item.market_id!), [items])
  const key = marketIds.join(",")

  useEffect(() => {
    if (!marketIds.length) { setState({ manifests: {}, pending: new Set(), failed: new Set() }); return }
    let cancelled = false
    setState({ manifests: {}, pending: new Set(marketIds), failed: new Set() })
    void Promise.all(marketIds.map(async (id) => {
      try { return [id, await fetchMarketManifest(module, id)] as const }
      catch { return [id, null] as const }
    })).then((rows) => {
      if (cancelled) return
      const manifests: Record<string, MarketManifest> = {}
      const failed = new Set<string>()
      rows.forEach(([id, manifest]) => { if (manifest) manifests[id] = manifest; else failed.add(id) })
      setState({ manifests, pending: new Set(), failed })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, module])
  return state
}

export function useMarketSpecMappers(skills: MarketAware[], plugins: MarketAware[]) {
  const skillState = useManifests(skills, "skills")
  const pluginState = useManifests(plugins, "plugins")

  const mapSkillItem = useCallback((item: MarketAware): ConfigEntry => {
    if (item.__source === MARKET_SOURCE) {
      const manifest = item.market_id ? skillState.manifests[item.market_id] : undefined
      if (!manifest) throw new Error("Skill 市场 manifest 尚未加载完成")
      return { ...manifestToSkillSpec(manifest), id: item.id }
    }
    return { ...item, id: item.id }
  }, [skillState.manifests])

  const mapPluginItem = useCallback((item: MarketAware): ConfigEntry => {
    if (item.__source === MARKET_SOURCE) {
      const manifest = item.market_id ? pluginState.manifests[item.market_id] : undefined
      if (!manifest) throw new Error("插件市场 manifest 尚未加载完成")
      return { ...manifestToPluginSpec(manifest), id: item.id }
    }
    return { ...item, id: item.id }
  }, [pluginState.manifests])

  const itemState = useCallback((item: MarketAware, state: LoadState) => {
    if (item.__source !== MARKET_SOURCE || !item.market_id) return "ready" as const
    if (state.failed.has(item.market_id)) return "failed" as const
    if (state.pending.has(item.market_id) || !state.manifests[item.market_id]) return "loading" as const
    return "ready" as const
  }, [])

  return {
    mapSkillItem,
    mapPluginItem,
    skillItemState: (item: MarketAware) => itemState(item, skillState),
    pluginItemState: (item: MarketAware) => itemState(item, pluginState),
  }
}
