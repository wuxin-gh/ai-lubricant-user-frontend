/**
 * 「外网访问」引导 —— 把本机/节点上的某个服务开放到公网。
 *
 * 按需求分两步引导，用户不需要懂内部对象：
 *   ① 代理方案：已经建过就让他**选**一个；没有就**引导他建**一个（默认 cloudflared
 *      quick，免登录、零配置，小白只需要起个名字）。方案 = 公网通道的接入方式。
 *   ② 开放哪个服务：填端口（+可选名字/运行位置），平台自动开入口并生成公网地址。
 *
 * 内部概念（scheme / binding）只在「代理方案」这一层出现——用户要能复用与选择，
 * 这一步必须可见；到绑定层则完全自动化。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Copy, Globe, Loader2, Plus, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

import { createTunnel, createTunnelScheme, listAllTunnels, listTunnelSchemes } from "@/api/tunnelClient"
import type { TunnelBinding, TunnelScheme } from "@/api/tunnelClient"
import { isNodeUsable } from "@/api/nodes"
import { useCommonData } from "@/components/console/data-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { EMPTY_FORM, configFromForm, type SchemeFormValues } from "./tunnel-form"
import { copyText } from "./copy-text"

/**
 * 服务类型 → 默认端口。
 *   网关服务 = 主服务（数据服务）监听端口，后端 SERVER_PORT 默认 8001。
 *   节点服务 = node_server 控制面，NODE_CONTROL_PORT 默认 8003（外网连接节点要用）。
 * 两者都是"平台自己的服务"，用户不需要也不应该自己查端口，故选中即带出、只读。
 */
const GATEWAY_PORT = "8001"
const NODE_SERVER_PORT = "8003"

type ServiceKind = "gateway" | "node_server" | "custom"

type Phase = "scheme" | "form" | "working" | "done"

/** 进度条目：done=已完成打勾；active=进行中转圈；pending=未开始灰点。 */
function ProgressRow({
  state,
  children,
}: {
  state: "done" | "active" | "pending"
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5 py-1 text-sm">
      {state === "done" ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" />
        </span>
      ) : state === "active" ? (
        <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
      ) : (
        <span className="size-5 shrink-0 rounded-full border-2 border-muted-foreground/30" />
      )}
      <span className={cn(state === "pending" ? "text-muted-foreground" : "")}>{children}</span>
    </div>
  )
}

/** 方案的展示名：kind + 地址摘要，让用户能分辨该选哪个。 */
function schemeLabel(s: TunnelScheme): string {
  const kind = s.kind === "cloudflared"
    ? (s.config?.mode === "managed" ? "Cloudflare(自有域名)" : "Cloudflare(免登录)")
    : s.kind === "frpc" ? "frp" : "npc"
  const addr = String(s.config?.server_addr || s.config?.domain || "").trim()
  return addr ? `${s.name} · ${kind} · ${addr}` : `${s.name} · ${kind}`
}

export function ExternalAccessWizard({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { nodes } = useCommonData()

  // ── ① 代理方案 ─────────────────────────────────────────────────
  const [schemes, setSchemes] = useState<TunnelScheme[]>([])
  const [schemesLoading, setSchemesLoading] = useState(false)
  const [schemeId, setSchemeId] = useState("")
  // 新建方案（免登录 Cloudflare）只需要一个名字——小白零配置。
  const [newSchemeName, setNewSchemeName] = useState("")
  // 新建方案的表单：与穿透页同一套映射（tunnel-form.ts），含服务器地址/端口/token 等。
  // 默认 cloudflared：免登录、零配置，大多数用户不需要自有服务器。
  const [schemeForm, setSchemeForm] = useState<SchemeFormValues>({ ...EMPTY_FORM, kind: "cloudflared" })
  // 是否处于「新建方案」表单：无可用方案时自动进入；有方案时由「添加方案」按钮进入。
  const [creatingScheme, setCreatingScheme] = useState(false)
  // 建服务器进行中（按钮转圈）。
  const [creating, setCreating] = useState(false)

  // ── ② 开放哪个服务 ─────────────────────────────────────────────
  // 服务类型：网关服务 = 主服务（数据服务，SERVER_PORT）；节点服务 = node_server
  // 控制面（NODE_CONTROL_PORT）；自定义 = 用户自己指定端口（甚至内网 IP）。
  // 选前两者时端口自动带出、只读；选自定义才放开输入。
  const [serviceKind, setServiceKind] = useState<ServiceKind>("gateway")
  const [port, setPort] = useState(GATEWAY_PORT)
  const [localHost, setLocalHost] = useState("127.0.0.1")
  const [label, setLabel] = useState("")
  const [target, setTarget] = useState("__main__")

  // ── 流程状态 ───────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("scheme")
  const [stepState, setStepState] = useState<{ entry: "done" | "active" | "pending"; addr: "done" | "active" | "pending" }>({
    entry: "pending", addr: "pending",
  })
  const [workingError, setWorkingError] = useState<string | null>(null)
  const [binding, setBinding] = useState<TunnelBinding | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const usableNodes = nodes.filter((node) => isNodeUsable(node))
  const enabledSchemes = schemes.filter((s) => s.enabled)
  const selectedScheme = enabledSchemes.find((s) => s.id === schemeId)

  const clearTimers = useCallback(() => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null }
    if (timeoutTimer.current) { clearTimeout(timeoutTimer.current); timeoutTimer.current = null }
  }, [])

  const reset = useCallback(() => {
    setPhase("scheme")
    setSchemeId("")
    setNewSchemeName("")
    setSchemeForm({ ...EMPTY_FORM, kind: "cloudflared" })
    setCreatingScheme(false)
    setServiceKind("gateway")
    setPort(GATEWAY_PORT)
    setLocalHost("127.0.0.1")
    setLabel("")
    setTarget("__main__")
    setStepState({ entry: "pending", addr: "pending" })
    setWorkingError(null)
    setBinding(null)
    clearTimers()
  }, [clearTimers])

  const close = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  // 打开时拉已有方案：有则停在「选择」态并预选第一个；没有则自动进入「新建」态
  // （用户不需要先看一个空列表再自己点"新建"）。
  useEffect(() => {
    if (!open) return
    setSchemesLoading(true)
    void listTunnelSchemes()
      .then((rows) => {
        setSchemes(rows)
        const firstEnabled = rows.find((s) => s.enabled)
        setSchemeId(firstEnabled?.id || "")
        if (!firstEnabled) setCreatingScheme(true)
      })
      .catch(() => {
        setSchemes([])
        setCreatingScheme(true)
      })
      .finally(() => setSchemesLoading(false))
  }, [open])

  useEffect(() => () => clearTimers(), [clearTimers])

  /** 轮询绑定状态直到拿到公网地址，或超时给友好提示。 */
  const pollBinding = useCallback((bindingId: string) => {
    clearTimers()
    pollTimer.current = setInterval(async () => {
      try {
        const rows = await listAllTunnels()
        const fresh = rows.find((r) => r.id === bindingId)
        if (!fresh) return
        setBinding(fresh)
        if (fresh.client_status === "running" || fresh.public_addr) {
          clearTimers()
          setStepState((s) => ({ ...s, addr: "done" }))
          setPhase("done")
        } else if (fresh.client_status === "failed") {
          clearTimers()
          setWorkingError(fresh.error || t("quickActions.external.failedHint", "通道启动失败，请稍后在 运维 → 内网穿透 里重试。"))
        }
      } catch {
        // 轮询失败不打扰，下一轮再试。
      }
    }, 2500)
    // 90s 还没通也收场：地址可能晚点到，引导去穿透页看。
    timeoutTimer.current = setTimeout(() => {
      clearTimers()
      setPhase("done")
    }, 90_000)
  }, [clearTimers, t])

  /** 添加穿透服务器 = 提交用户填的服务器配置。
   *  方案就是服务器配置本身，不能替用户凭空造（那样代理也没有可挂的服务器）。 */
  const createScheme = async () => {
    const name = newSchemeName.trim()
    if (!name) {
      setWorkingError(t("quickActions.external.schemeNameRequired", "请填写名称"))
      return
    }
    if (schemeForm.kind !== "cloudflared" && !schemeForm.server_addr.trim()) {
      setWorkingError(t("quickActions.external.serverAddrRequired", "请填写服务器地址"))
      return
    }
    setWorkingError(null)
    setCreating(true)
    try {
      const created = await createTunnelScheme({
        name,
        kind: schemeForm.kind,
        config: configFromForm(schemeForm),
        enabled: true,
      })
      setSchemes((rows) => [created, ...rows])
      setSchemeId(created.id)
      setNewSchemeName("")
      setSchemeForm({ ...EMPTY_FORM, kind: "cloudflared" })
      setCreatingScheme(false)
      toast.success(t("quickActions.external.schemeCreated", "穿透服务器已添加"))
      setPhase("form")
    } catch (err) {
      setWorkingError(err instanceof Error ? err.message : t("quickActions.external.schemeCreateFailed", "添加穿透服务器失败"))
    } finally {
      setCreating(false)
    }
  }

  /** 切换服务类型：前两种自动带出端口，自定义保留用户已填的值。 */
  const pickServiceKind = (kind: ServiceKind) => {
    setServiceKind(kind)
    if (kind === "gateway") {
      setPort(GATEWAY_PORT)
      // 网关服务就跑在主服务上，运行位置固定本机——避免用户先选了节点再切回来
      // 时残留旧节点（那时选择器已隐藏，用户看不到也没法改）。
      setTarget("__main__")
    } else if (kind === "node_server") {
      setPort(NODE_SERVER_PORT)
    }
  }

  /** 用选中的方案，为端口开一个入口。 */
  const start = async () => {
    const portNum = Number(port)
    if (!portNum || portNum < 1 || portNum > 65535) {
      // 网关/节点服务的端口是平台常量，走到这里只可能是自定义填错。
      toast.error(t("quickActions.external.portInvalid", "请填写端口（1-65535），例如 8000"))
      return
    }
    if (!selectedScheme) {
      toast.error(t("quickActions.external.needScheme", "请先选择一个代理方案"))
      return
    }
    setPhase("working")
    setWorkingError(null)
    setStepState({ entry: "active", addr: "pending" })
    try {
      const created = await createTunnel({
        scheme_id: selectedScheme.id,
        node_id: target,
        // 自定义类型才用用户填的内网 IP；平台自身服务固定回环。
        local_host: serviceKind === "custom" ? (localHost.trim() || "127.0.0.1") : "127.0.0.1",
        local_port: portNum,
        description: label.trim() || undefined,
      })
      setBinding(created)
      setStepState((s) => ({ ...s, entry: "done", addr: "active" }))
      pollBinding(created.id)
    } catch (err) {
      setWorkingError(err instanceof Error ? err.message : t("quickActions.external.failedHint", "通道启动失败，请稍后在 运维 → 内网穿透 里重试。"))
    }
  }

  const publicAddr = binding?.public_addr || ""

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="size-5 text-primary" />
            {t("quickActions.external.title", "把服务开放到公网")}
          </DialogTitle>
          <DialogDescription>
            {phase === "scheme"
              ? t(
                  "quickActions.external.schemeDesc",
                  "先准备一个穿透服务器（对外通道）。已经建过就直接选一个，没有就点一下添加——免登录 Cloudflare，平台自动配好。",
                )
              : t(
                  "quickActions.external.desc",
                  "回答一个问题就行：你想让外部访问哪个服务？平台会自动准备公网地址，不需要你配置任何服务器。",
                )}
          </DialogDescription>
        </DialogHeader>

        {phase === "scheme" ? (
          <div className="flex flex-col gap-4">
            {schemesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner className="size-5" />
              </div>
            ) : creatingScheme || enabledSchemes.length === 0 ? (
              /* 添加穿透服务器 = 填一台穿透服务器的连接信息。
                 方案就是「服务器配置」，代理（端口暴露）挂在它下面；没有服务器地址
                 就无从配置，所以这里必须让用户填，不能替他凭空造一个。 */
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ea-scheme-name">
                    {t("quickActions.external.schemeNameLabel", "名称")}
                  </Label>
                  <Input
                    id="ea-scheme-name"
                    autoFocus
                    placeholder={t("quickActions.external.schemeNamePlaceholder", "例如：公司内网 frps")}
                    value={newSchemeName}
                    onChange={(e) => setNewSchemeName(e.target.value)}
                  />
                </div>

                {schemeForm.kind !== "cloudflared" ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ea-server-addr">
                      {t("quickActions.external.serverAddr", "服务器地址")}
                      <span className="ml-0.5 text-destructive">*</span>
                    </Label>
                    <Input
                      id="ea-server-addr"
                      placeholder={t("quickActions.external.serverAddrPlaceholder", "frps.example.com 或服务器 IP")}
                      value={schemeForm.server_addr}
                      onChange={(e) => setSchemeForm((f) => ({ ...f, server_addr: e.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "quickActions.external.serverAddrHint",
                        "你的 frps / nps 服务器地址。代理会通过它把内网端口暴露到公网。",
                      )}
                    </p>
                  </div>
                ) : null}

                {schemeForm.kind !== "cloudflared" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="ea-server-port">
                        {t("quickActions.external.serverPort", "服务器端口")}
                      </Label>
                      <Input
                        id="ea-server-port"
                        inputMode="numeric"
                        placeholder="7000"
                        value={schemeForm.server_port}
                        onChange={(e) => setSchemeForm((f) => ({ ...f, server_port: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="ea-token">{t("quickActions.external.token", "Token（可空）")}</Label>
                      <Input
                        id="ea-token"
                        placeholder={t("quickActions.external.tokenPlaceholder", "鉴权 token")}
                        value={schemeForm.token}
                        onChange={(e) => setSchemeForm((f) => ({ ...f, token: e.target.value }))}
                      />
                    </div>
                  </div>
                ) : null}

                {schemeForm.kind !== "cloudflared" ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ea-domain">{t("quickActions.external.domain", "对外域名（可选）")}</Label>
                    <Input
                      id="ea-domain"
                      placeholder="tunnel.example.com"
                      value={schemeForm.domain}
                      onChange={(e) => setSchemeForm((f) => ({ ...f, domain: e.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "quickActions.external.domainHint",
                        "留空则用「服务器地址:端口」访问；填写后需自行把域名解析到这台服务器。",
                      )}
                    </p>
                  </div>
                ) : null}

                {/* 类型常驻显示（不折叠）：它决定下面要填什么，藏起来用户没法填。
                    默认 cloudflared——免登录、零配置，对大多数用户是最省事的。 */}
                <div className="flex flex-col gap-1.5">
                  <Label>{t("quickActions.external.kind", "类型")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: "cloudflared" as const, label: t("quickActions.external.kindCloudflared", "Cloudflare（免登录）") },
                      { value: "frpc" as const, label: t("quickActions.external.kindFrpc", "frp（自有服务器）") },
                      { value: "npc" as const, label: t("quickActions.external.kindNpc", "npc（自有服务器）") },
                    ]).map((item) => (
                      <Button
                        key={item.value}
                        type="button"
                        size="sm"
                        variant={schemeForm.kind === item.value ? "default" : "outline"}
                        onClick={() => setSchemeForm((f) => ({ ...f, kind: item.value }))}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {schemeForm.kind === "cloudflared"
                      ? t(
                          "quickActions.external.cloudflaredHint",
                          "不用服务器地址、不用账号，平台自动分配一个临时公网地址。",
                        )
                      : t(
                          "quickActions.external.selfHostedHint",
                          "用你自己的 frps / nps 服务器，需要填地址与端口。",
                        )}
                  </p>
                </div>

                {schemeForm.kind !== "cloudflared" ? (
                  <details className="rounded-md border px-3 py-2">
                    <summary className="cursor-pointer text-sm text-muted-foreground select-none">
                      {t("quickActions.external.moreOptions", "更多选项")}
                    </summary>
                    <div className="mt-2 flex flex-col gap-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                          <Label>{t("quickActions.external.portRangeLo", "端口段起（可选）")}</Label>
                          <Input
                            inputMode="numeric"
                            placeholder="30000"
                            value={schemeForm.port_range_lo}
                            onChange={(e) => setSchemeForm((f) => ({ ...f, port_range_lo: e.target.value }))}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>{t("quickActions.external.portRangeHi", "端口段止（可选）")}</Label>
                          <Input
                            inputMode="numeric"
                            placeholder="30100"
                            value={schemeForm.port_range_hi}
                            onChange={(e) => setSchemeForm((f) => ({ ...f, port_range_hi: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                  </details>
                ) : null}
              </div>
            ) : (
              /* 已有方案：选一个继续；同时保留「添加方案」入口，不逼用户只能用旧的。 */
              <div className="flex flex-col gap-1.5">
                <Label>{t("quickActions.external.pickScheme", "选择代理方案")}</Label>
                <div className="flex gap-2">
                  <Select value={schemeId} onValueChange={setSchemeId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={t("quickActions.external.pickSchemePlaceholder", "选一个")} />
                    </SelectTrigger>
                    <SelectContent>
                      {enabledSchemes.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{schemeLabel(s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={() => setCreatingScheme(true)}>
                    <Plus className="size-4" />
                    {t("quickActions.external.addScheme", "添加方案")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("quickActions.external.schemeHint", "这些是你已经建好的通道。选一个继续即可。")}
                </p>
              </div>
            )}
            {workingError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {workingError}
              </div>
            ) : null}
          </div>
        ) : phase === "form" ? (
          <div className="flex flex-col gap-4">
            {selectedScheme ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <Globe className="size-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{schemeLabel(selectedScheme)}</span>
                <button
                  type="button"
                  className="shrink-0 text-primary hover:underline"
                  onClick={() => setPhase("scheme")}
                >
                  {t("quickActions.external.changeScheme", "换一个")}
                </button>
              </div>
            ) : null}

            {/* 要开放哪个服务：网关服务 / 节点服务 是平台自身的服务，选中即带出端口
                （用户不必也不该自己查）；自定义才放开端口与内网 IP。 */}
            <div className="flex flex-col gap-1.5">
              <Label>{t("quickActions.external.serviceLabel", "要开放的服务")}</Label>
              <div className="flex flex-wrap gap-2">
                {([
                  { value: "gateway" as const, label: t("quickActions.external.svcGateway", "网关服务") },
                  { value: "node_server" as const, label: t("quickActions.external.svcNode", "节点服务") },
                  { value: "custom" as const, label: t("quickActions.external.svcCustom", "自定义") },
                ]).map((item) => (
                  <Button
                    key={item.value}
                    type="button"
                    size="sm"
                    variant={serviceKind === item.value ? "default" : "outline"}
                    onClick={() => pickServiceKind(item.value)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {serviceKind === "gateway"
                  ? t("quickActions.external.svcGatewayHint", "平台的数据服务（网关），端口已自动填好。")
                  : serviceKind === "node_server"
                    ? t("quickActions.external.svcNodeHint", "节点控制服务（node_server），外网连接节点时需要，端口已自动填好。")
                    : t("quickActions.external.svcCustomHint", "自己指定端口，服务不在本机时还可以填内网 IP。")}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {serviceKind === "custom" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ea-host">{t("quickActions.external.hostLabel", "内网 IP")}</Label>
                  <Input
                    id="ea-host"
                    placeholder="127.0.0.1"
                    value={localHost}
                    onChange={(e) => setLocalHost(e.target.value)}
                  />
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ea-port">{t("quickActions.external.portLabel", "端口")}</Label>
                <Input
                  id="ea-port"
                  inputMode="numeric"
                  readOnly={serviceKind !== "custom"}
                  disabled={serviceKind !== "custom"}
                  placeholder={t("quickActions.external.portPlaceholder", "例如 8000、3000、7860")}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void start() }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ea-label">{t("quickActions.external.labelLabel", "这个名字（可选）")}</Label>
              <Input
                id="ea-label"
                placeholder={t("quickActions.external.labelPlaceholder", "例如：我的应用预览")}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            {/* 服务跑在哪：网关服务固定主服务所在机器（数据服务就在那儿）；其余可挑节点。 */}
            {serviceKind !== "gateway" ? (
              <div className="flex flex-col gap-1.5">
                <Label>{t("quickActions.external.targetLabel", "服务跑在哪")}</Label>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__main__">{t("quickActions.external.thisMachine", "本机（主服务所在机器）")}</SelectItem>
                    {usableNodes.map((n) => (
                      <SelectItem key={n.node_id} value={n.node_id}>
                        {n.node_name || n.node_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("quickActions.external.targetHint", "不确定就选本机。选错也不要紧，删掉重开一次就行。")}
                </p>
              </div>
            ) : null}
          </div>
        ) : phase === "working" ? (
          <div className="flex flex-col gap-4 py-2">
            {workingError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {workingError}
              </div>
            ) : (
              <>
                <ProgressRow state={stepState.entry}>
                  {t("quickActions.external.stepEntry", "为端口 {port} 创建访问入口", { port: port || "…" })}
                </ProgressRow>
                <ProgressRow state={stepState.addr}>
                  {t("quickActions.external.stepAddr", "生成公网地址（通常几秒到一分钟）")}
                </ProgressRow>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {publicAddr ? (
              <>
                <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
                  <div className="text-xs text-muted-foreground">
                    {t("quickActions.external.doneLabel", "你的公网地址")}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-sm font-medium">{publicAddr}</code>
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => void copyText(publicAddr)}>
                      <Copy className="size-4" />
                      {t("quickActions.external.copy", "复制")}
                    </Button>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {label.trim()
                      ? t("quickActions.external.doneNamed", "「{name}」现在外网能访问了。", { name: label.trim() })
                      : t("quickActions.external.donePlain", "现在外网能访问了。把它发给需要的人即可。")}
                  </p>
                </div>
                <div className="flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {t(
                      "quickActions.external.securityNote",
                      "这个地址谁拿到都能访问，等同于把服务直接开放到公网。只开放测试/预览类服务，别暴露数据库、SSH 等敏感端口；不用了记得在 运维 → 内网穿透 关掉。",
                    )}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  {t(
                    "quickActions.external.slowHint",
                    "入口已创建，公网地址还在分配中（偶尔要等一会儿）。可以先关掉这个窗口，稍后在 运维 → 内网穿透 里查看。",
                  )}
                </p>
                {binding?.client_status === "failed" ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                    {binding.error || t("quickActions.external.failedHint", "通道启动失败，请稍后在 运维 → 内网穿透 里重试。")}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {phase === "scheme" ? (
            <>
              {creatingScheme || enabledSchemes.length === 0 ? (
                /* 新建态：上一步（有已有方案时）/ 取消 + 创建。 */
                <>
                  {enabledSchemes.length > 0 ? (
                    <Button variant="ghost" onClick={() => setCreatingScheme(false)} disabled={creating}>
                      {t("quickActions.back", "上一步")}
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => close(false)} disabled={creating}>
                      {t("quickActions.cancel", "取消")}
                    </Button>
                  )}
                  <Button onClick={() => void createScheme()} disabled={creating || schemesLoading}>
                    {creating ? <Spinner className="size-4" /> : <Plus className="size-4" />}
                    {t("quickActions.external.createScheme", "创建并继续")}
                  </Button>
                </>
              ) : (
                /* 选择态：选一个已有方案继续，或点「添加方案」新建。 */
                <>
                  <Button variant="outline" onClick={() => close(false)}>
                    {t("quickActions.cancel", "取消")}
                  </Button>
                  <Button onClick={() => setPhase("form")} disabled={!schemeId}>
                    {t("quickActions.next", "下一步")}
                  </Button>
                </>
              )}
            </>
          ) : phase === "form" ? (
            <>
              <Button variant="outline" onClick={() => setPhase("scheme")}>
                {t("quickActions.back", "上一步")}
              </Button>
              <Button onClick={() => void start()} disabled={!port.trim()}>
                {t("quickActions.external.go", "开放到公网")}
              </Button>
            </>
          ) : phase === "working" ? (
            <Button variant="outline" onClick={() => close(false)}>
              {t("quickActions.external.backgroundHint", "后台继续，我先关掉")}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={reset}>
                {t("quickActions.external.openAnother", "再开放一个")}
              </Button>
              <Button onClick={() => close(false)}>
                {t("quickActions.done", "完成")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
