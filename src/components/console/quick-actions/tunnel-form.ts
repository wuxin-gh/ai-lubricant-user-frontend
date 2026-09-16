/**
 * 内网穿透「方案」表单态与后端 config 的映射 —— 单一事实来源。
 *
 * 两个入口共用（改一处两处同时生效，避免表单口径漂移）：
 *   - TunnelSchemes.tsx 的方案新建/编辑弹框（管理页）
 *   - quick-actions/tunnel-scheme-create-dialog.tsx（首页快捷操作，仅新建）
 *
 * 后端契约见 user_platform/routes_tunnel.py + tunnel_service._validate_scheme_config。
 */
import type { TunnelScheme, TunnelKind, TunnelSchemeConfig } from "@/api/tunnelClient"

export interface SchemeFormValues {
  name: string
  kind: TunnelKind
  // frpc / npc
  server_addr: string
  server_port: string
  token: string
  port_range_lo: string
  port_range_hi: string
  /** frpc/npc:可选对外访问域名。cloudflared managed:必填根域名。 */
  domain: string
  /** frpc:可选客户端 user(frp [common].user);代理名会带 user. 前缀。 */
  user: string
  // cloudflared
  cf_mode: "quick" | "managed"
  cf_api_token: string
  cf_account_id: string
  cf_zone_id: string
  enabled: boolean
}

export const EMPTY_FORM: SchemeFormValues = {
  name: "",
  kind: "frpc",
  server_addr: "",
  server_port: "",
  token: "",
  port_range_lo: "",
  port_range_hi: "",
  domain: "",
  user: "",
  cf_mode: "quick",
  cf_api_token: "",
  cf_account_id: "",
  cf_zone_id: "",
  enabled: true,
}

export const CF_MODE_HELP: Record<"quick" | "managed", string> = {
  quick:
    "免登录。节点启动 cloudflared 后由 Cloudflare 随机分配一个 *.trycloudflare.com 域名,无需账号和域名,适合临时调试。地址每次重启都会变。",
  managed:
    "使用你自己的 Cloudflare 账号和域名。方案里存一次账号凭证 + 根域名,之后每条绑定只填子域名,平台自动创建 Tunnel、配置 ingress、建 DNS 记录,删除绑定时自动回收。",
}

/** 已存在的方案 → 表单初值（编辑态回填）。 */
export function formFromConfig(s: TunnelScheme): SchemeFormValues {
  const c = s.config || {}
  const rng = Array.isArray(c.port_range) ? (c.port_range as number[]) : []
  return {
    name: s.name,
    kind: s.kind,
    server_addr: String(c.server_addr || ""),
    server_port: String(c.server_port || ""),
    token: String(c.token || ""),
    port_range_lo: rng[0] != null ? String(rng[0]) : "",
    port_range_hi: rng[1] != null ? String(rng[1]) : "",
    domain: String(c.domain || ""),
    user: String(c.user || ""),
    cf_mode: (c.mode as "quick" | "managed") || "quick",
    cf_api_token: String(c.api_token || ""),
    cf_account_id: String(c.account_id || ""),
    cf_zone_id: String(c.zone_id || ""),
    enabled: s.enabled,
  }
}

/** 表单态 → 后端 config。 */
export function configFromForm(v: SchemeFormValues): TunnelSchemeConfig {
  if (v.kind === "frpc" || v.kind === "npc") {
    const cfg: TunnelSchemeConfig = {
      server_addr: v.server_addr.trim(),
      server_port: Number(v.server_port) || 0,
      token: v.token.trim(),
      domain: v.domain.trim(),
    }
    // 端口段选填:留空(或填了起点没填终点)则不写 port_range,该方案不做
    // 端口限制 —— 每条代理创建时必须手填远端端口。
    const lo = Number(v.port_range_lo)
    const hi = Number(v.port_range_hi)
    if (v.port_range_lo.trim() && v.port_range_hi.trim() && lo > 0 && hi >= lo) {
      cfg.port_range = [lo, hi]
    }
    // user 仅 frpc 写入 config(npc [common] 无 user);空串不发键。
    if (v.kind === "frpc" && v.user.trim()) {
      cfg.user = v.user.trim()
    }
    return cfg
  }
  // cloudflared
  if (v.cf_mode === "quick") {
    return { mode: "quick" }
  }
  return {
    mode: "managed",
    api_token: v.cf_api_token.trim(),
    account_id: v.cf_account_id.trim(),
    zone_id: v.cf_zone_id.trim(),
    domain: v.domain.trim(),
  }
}

/** 方案一行摘要（列表展示用）。 */
export function summarizeConfig(s: TunnelScheme): string {
  const c = s.config || {}
  const domain = String(c.domain || "")
  if (s.kind === "cloudflared") {
    if (c.mode === "managed") {
      return domain ? `managed · *.${domain}` : "managed · 未配根域名(需补)"
    }
    return "quick · trycloudflare(免登录随机域名)"
  }
  const rng = Array.isArray(c.port_range) ? (c.port_range as number[]) : []
  const host = domain || String(c.server_addr || "")
  const via = domain ? ` (连 ${c.server_addr || ""})` : ""
  const range = rng.length === 2 && rng[0]
    ? ` · 端口段 ${rng[0] ?? "?"}-${rng[1] ?? "?"}`
    : " · 端口不限(代理手填远端端口)"
  return `${host}:${c.server_port || ""}${via}${range}`
}
