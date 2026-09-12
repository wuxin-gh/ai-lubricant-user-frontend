import request from "./client";

// ==================== 节点类型 ====================

/**
 * agent-compose 节点角色（列表投影后的顶层角色）。
 *
 * 后端把 passive_management 和 management 都投影成 "management"，两类管理节点
 * 靠 {@link NodeInfo.is_passive} 区分，所以列表里只会出现 execution / management /
 * ios_host。ios_host 是 iOS 设备主机：拨号上报身份/心跳/版本/自升级，手机指令走
 * 独立的 device-control WebSocket，不跑会话、不派发。
 */
export type NodeRole = "execution" | "management" | "ios_host" | "";

/**
 * onboard 时发给后端的角色线值。比 {@link NodeRole} 多一个 passive_management：
 * 「新建分组容器」发 passive_management、「新建管理节点」发 management、
 * 「添加执行节点」发 execution。「添加 iOS 设备主机」发 ios_host。
 */
export type OnboardRole = "execution" | "management" | "passive_management" | "ios_host";
/** agent-compose 节点状态 */
export type NodeStatus = "pending" | "approved" | "revoked" | "unknown" | "";
/** 节点安装方式 */
export type NodeStartupMethod =
  | "standalone"
  | "systemd"
  | "docker"
  | "docker-compose";

/** daemon 已知的一个节点（ListNodes 归一后的形状） */
export interface NodeInfo {
  node_id: string;
  node_name: string;
  status: NodeStatus;
  role: NodeRole;
  /**
   * 管理节点是否为「纯分组容器」（passive_management）：只归拢执行节点、方便按
   * 分组授权，本身不是客户端、无凭证、不拨号。带客户端的管理节点为 false。
   * 执行节点恒为 false。role 已把两类管理节点都投影成 "management"，本字段是
   * 前端区分两者的唯一依据。
   */
  is_passive?: boolean;
  startup_method: NodeStartupMethod | "";
  manager_node_id: string;
  connected: boolean;
  /** Heartbeat freshness from NodeInfo.online; may be absent on old servers. */
  online?: boolean;
  last_heartbeat_at: string;
  active_session_ids: string[];
  capabilities: Record<string, string>;
  /** 该节点绑定的出口代理池条目 id（空=直连）。节点详情「环境」tab 预选。 */
  proxy_config_id?: string;
  /** 上次成功升级用的代理 id（空=直连），升级弹窗预选用。 */
  last_proxy_config_id?: string;
}

/** OnboardNode 返回：节点 TOTP secret + 安装命令（secret 仅此一次可见） */
export interface OnboardResult {
  node_id: string;
  /** 节点专属 TOTP 凭证（base32），仅入驻时返回一次。 */
  secret: string;
  /** 标准 otpauth:// URI，可扫入验证器（可选）。 */
  otpauth_uri: string;
  install_command: string;
  script_url: string;
  launched: boolean;
  node: NodeInfo;
}

/** 管理端托管的节点运行程序（agent-compose-agent 跨平台构建） */
export interface NodeBinary {
  name: string;
  size: number;
  os: string;
  arch: string;
  url: string;
}

/** 分组绑定的节点（本地 GroupNode + daemon 实时状态） */
export interface GroupNodeBinding {
  group_id: string;
  node_id: string;
  node_name: string;
  node_role: NodeRole;
  status: NodeStatus;
  connected: boolean;
  manager_node_id: string;
  last_heartbeat_at: string;
  bound_at: number;
}

export interface OnboardNodePayload {
  role?: OnboardRole;
  startup_method?: NodeStartupMethod;
  node_name?: string;
  manager_node_id?: string;
  labels?: Record<string, string>;
  /** 该节点绑定的出口代理池条目 id；空=直连。onboard 时选。 */
  proxy_config_id?: string;
}

/** 团队分组精简信息（用于「分配给分组」下拉） */
export interface TeamGroupLite {
  id: string;
  name: string;
}

// ==================== 节点控制面（管理后台，代理 daemon）====================

/** GET /api/v1/admin/nodes?status= */
export async function listNodes(status?: NodeStatus): Promise<NodeInfo[]> {
  const response = await request.get<{ nodes: NodeInfo[] }>(
    "/api/v1/admin/nodes",
    { params: status ? { status } : undefined },
  );
  return response.data.nodes ?? [];
}

/** 节点程序 / runtime 任一条线的当前版本、最新版本与升级判定。后端已去 v 前缀并
 *  分线比较，前端直接消费，不再自己用全局 version.json 比较。 */
export interface NodeVersionLine {
  current: string
  latest: string
  installed: boolean
  needs_upgrade: boolean
}

/** 单节点详情接口返回的版本判定块。runtime 与节点程序是两条独立版本线。 */
export interface NodeUpgradeStatus {
  stale: boolean
  node_program: NodeVersionLine
  runtime: NodeVersionLine
  can_upgrade: boolean
}

/** GET /api/v1/admin/nodes/{nodeId} —— 单节点详情 + 版本判定。 */
export interface NodeDetailResponse {
  node: NodeInfo
  upgrade: NodeUpgradeStatus
}

/** GET /api/v1/admin/nodes/{nodeId} */
export async function getNode(nodeId: string): Promise<NodeDetailResponse> {
  const response = await request.get<NodeDetailResponse>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}`,
  )
  return response.data
}

export interface PublicIPLookupConfig {
  revision: string | number
  ipv4Urls: string[]
  ipv6Urls: string[]
}

/** GET /api/v1/admin/nodes/public-ip-lookup-config */
export async function getPublicIPLookupConfig(): Promise<PublicIPLookupConfig> {
  const response = await request.get<PublicIPLookupConfig>(
    "/api/v1/admin/nodes/public-ip-lookup-config",
  )
  return response.data
}

/** PUT /api/v1/admin/nodes/public-ip-lookup-config */
export async function updatePublicIPLookupConfig(
  ipv4Urls: string[],
  ipv6Urls: string[],
): Promise<PublicIPLookupConfig> {
  const response = await request.put<PublicIPLookupConfig>(
    "/api/v1/admin/nodes/public-ip-lookup-config",
    { ipv4_urls: ipv4Urls, ipv6_urls: ipv6Urls },
  )
  return response.data
}

/** 节点出口代理（按节点绑定）：节点用它从 GitHub 下载 self-upgrade/runtime/install 二进制。
 *  proxy_mode 空 = 直连；network = HTTP/HTTPS/SOCKS5 代理；url_prefix = 反代前缀。
 *  proxy_config_id 是该节点绑定的代理池条目 id，前端仅用于回显/预选。 */
export interface NodeProxyConfig {
  revision: string | number
  proxy_mode: string
  proxy_url: string
  proxy_url_prefix: string
  proxy_config_id: string
}

/** GET /api/v1/admin/nodes/{nodeId}/proxy-config —— 读取节点绑定的出口代理。
 *  node_server 的 Connect RPC 响应按 connect-go 口径序列化为 camelCase
 *  （proxyConfigId/proxyMode/proxyUrl/proxyUrlPrefix），这里归一成接口声明的
 *  snake_case，否则节点详情弹框读 cfg.proxy_config_id 永远 undefined → 永远显示「直连」。 */
export async function getNodeProxyConfig(nodeId: string): Promise<NodeProxyConfig> {
  const response = await request.get<Record<string, unknown>>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/proxy-config`,
  )
  const raw = (response.data || {}) as Record<string, unknown>
  return {
    revision: (raw.revision ?? raw.proxyRevision ?? 0) as string | number,
    proxy_mode: String(raw.proxyMode ?? raw.proxy_mode ?? ""),
    proxy_url: String(raw.proxyUrl ?? raw.proxy_url ?? ""),
    proxy_url_prefix: String(raw.proxyUrlPrefix ?? raw.proxy_url_prefix ?? ""),
    proxy_config_id: String(raw.proxyConfigId ?? raw.proxy_config_id ?? ""),
  }
}

/** PUT /api/v1/admin/nodes/{nodeId}/proxy-config —— 设置节点绑定的出口代理并推送给该在线节点；空 id = 直连。 */
export async function updateNodeProxyConfig(
  nodeId: string,
  proxyConfigId: string,
): Promise<NodeProxyConfig> {
  const response = await request.put<Record<string, unknown>>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/proxy-config`,
    { proxy_config_id: proxyConfigId || "" },
  )
  // 与 GET 同源（Connect RPC camelCase），归一后回传。
  const raw = (response.data || {}) as Record<string, unknown>
  return {
    revision: (raw.revision ?? raw.proxyRevision ?? 0) as string | number,
    proxy_mode: String(raw.proxyMode ?? raw.proxy_mode ?? ""),
    proxy_url: String(raw.proxyUrl ?? raw.proxy_url ?? ""),
    proxy_url_prefix: String(raw.proxyUrlPrefix ?? raw.proxy_url_prefix ?? ""),
    proxy_config_id: String(raw.proxyConfigId ?? raw.proxy_config_id ?? ""),
  }
}


/** POST /api/v1/admin/nodes/onboard */
export async function onboardNode(
  payload: OnboardNodePayload,
): Promise<OnboardResult> {
  const response = await request.post<OnboardResult>(
    "/api/v1/admin/nodes/onboard",
    payload,
  );
  return response.data;
}

/** POST /api/v1/admin/nodes/{nodeId}/approve */
export async function approveNode(nodeId: string): Promise<NodeInfo> {
  const response = await request.post<NodeInfo>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/approve`,
  );
  return response.data;
}

/** POST /api/v1/admin/nodes/{nodeId}/revoke */
export async function revokeNode(nodeId: string): Promise<NodeInfo> {
  const response = await request.post<NodeInfo>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/revoke`,
  );
  return response.data;
}

/** DELETE /api/v1/admin/nodes/{nodeId} —— 硬删除（从列表消失，不可恢复） */
export async function deleteNode(nodeId: string): Promise<{ deleted: boolean }> {
  const response = await request.delete<{ deleted: boolean }>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}`,
  );
  return response.data;
}

/** DELETE /api/v1/admin/nodes/{nodeId}/onboard —— 撤销入驻（未注册删记录/已注册吊销） */
export async function revokeOnboardNode(
  nodeId: string,
): Promise<{ deleted: boolean; revoked: boolean; node: NodeInfo }> {
  const response = await request.delete<{
    deleted: boolean;
    revoked: boolean;
    node: NodeInfo;
  }>(`/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/onboard`);
  return response.data;
}

/** POST /api/v1/admin/nodes/{nodeId}/move —— 把执行节点挪到另一管理节点下 */
export async function moveNode(
  nodeId: string,
  managerNodeId: string,
): Promise<NodeInfo> {
  const response = await request.post<NodeInfo>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/move`,
    { manager_node_id: managerNodeId },
  )
  return response.data
}

/** ManageEditor 返回：节点执行安装/升级后回报的编辑器版本。 */
export interface ManageEditorResult {
  node_id: string
  editor: string
  action: "install" | "upgrade"
  version: string
}

/** POST /api/v1/admin/nodes/{nodeId}/editors/{editor}/install —— 在线安装编辑器 CLI */
export async function installNodeEditor(
  nodeId: string,
  editor: string,
): Promise<ManageEditorResult> {
  const response = await request.post<ManageEditorResult>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/editors/${encodeURIComponent(editor)}/install`,
    undefined,
    { timeout: 620000 },
  )
  return response.data
}

/** InstallHostTool 返回：节点装完 Node.js 后回报的 node/npm 版本；xcode 检测则回报
 *  探测到的 xcodebuild 版本（服务端已折进 capabilities，无需重启节点即刷新标签）。 */
export interface InstallHostToolResult {
  node_id: string
  tool: string
  target_version: string
  node_version: string
  npm_version: string
  /** xcode 检测成功时节点探测到的 xcodebuild 版本；nodejs / 旧版节点为空。 */
  xcodebuild_version: string
}

/**
 * POST /api/v1/admin/nodes/{nodeId}/host-tools/{tool}/install —— 在线安装宿主工具。
 *
 * nodejs：节点下载官方归档解压到自管目录（无需 root）并回报探测版本；服务端把
 * node_version/npm_version 折进 capabilities，前端轮询 listNodes 即可见。
 * 下载+解压可能数分钟，超时给足。
 * xcode：检测型——节点只探测 xcodebuild（App Store 专供无法自动安装），未装时
 * ack 错误原样携带「为什么不能自动装 + 手动步骤」，前端 toast 展示。
 */
export async function installNodeHostTool(
  nodeId: string,
  tool: "nodejs" | "xcode" = "nodejs",
): Promise<InstallHostToolResult> {
  const response = await request.post<InstallHostToolResult>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/host-tools/${encodeURIComponent(tool)}/install`,
    undefined,
    { timeout: 620000 },
  )
  return response.data
}

/** RefreshNodeLabels 返回：合并后的全部能力标签（节点重新探测 + 服务端簿记）。 */
export interface RefreshNodeLabelsResult {
  node_id: string
  labels: Record<string, string>
}

/**
 * POST /api/v1/admin/nodes/{nodeId}/refresh-labels —— 让在线节点重新探测全部
 * 能力标签（编辑器/host tool 版本、机器信息、--labels），无需重启节点进程。
 *
 * 节点回传与注册时同构的能力快照，服务端折进 capabilities；调用方刷新
 * listNodes 即可见。节点离线报错、旧版节点（不认识该帧）会超时——错误
 * 信息会提示升级节点。探测预算 30s + 往返，超时给足。
 */
export async function refreshNodeLabels(nodeId: string): Promise<RefreshNodeLabelsResult> {
  const response = await request.post<RefreshNodeLabelsResult>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/refresh-labels`,
    undefined,
    { timeout: 60000 },
  )
  return response.data
}

// ── 异步 Xcode 安装任务（.xip 下载/解压动辄数十分钟到数小时，同步 ack 装不下，
//    走 HostToolJob 帧：start 短受理 → 事件帧进度 → 恰好一个 result，轮询快照） ──

/** POST .../host-tools/xcode/jobs 的受理返回：job_id 已铸造，安装后台进行。 */
export interface XcodeInstallJobStart {
  node_id: string
  job_id: string
  status: string
  target_version: string
  download_url: string
  download_size_bytes: number
  requires_macos: string
  beta: boolean
  /** 目录来自上次成功快照（远端拉取失败）时为 true。 */
  stale: boolean
}

/** GET .../host-tools/xcode/jobs/{jobId} 的进度快照（控制面内存态）。 */
export interface XcodeInstallJobSnapshot {
  job_id: string
  tool: string
  node_id: string
  target_version: string
  status: "running" | "completed" | "failed" | string
  stage: string
  percent: number
  message: string
  log_tail: string
  current_bytes: number
  total_bytes: number
  retryable: boolean
  error_code: string
  xcodebuild_version: string
  app_path: string
  created_at: string
  updated_at: string
  completed_at: string
  events: Array<{ seq: number; stage: string; message: string; timestamp: string }>
}

/**
 * POST /api/v1/admin/nodes/{nodeId}/host-tools/xcode/jobs —— 启动 Xcode 自动安装。
 *
 * 服务端解析 xcodereleases 目录（targetVersion 缺省取配置默认，"latest" = 最新
 * 非 beta 且兼容节点 macOS），节点受理后立即返回 job_id；进度轮询
 * getNodeXcodeInstallJob，取消 cancelNodeXcodeInstallJob。
 */
export async function startNodeXcodeInstall(
  nodeId: string,
  targetVersion?: string,
): Promise<XcodeInstallJobStart> {
  const response = await request.post<XcodeInstallJobStart>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/host-tools/xcode/jobs`,
    targetVersion ? { target_version: targetVersion } : {},
    { timeout: 60000 },
  )
  return response.data
}

/** GET /api/v1/admin/nodes/{nodeId}/host-tools/xcode/jobs/{jobId} —— 轮询进度快照。 */
export async function getNodeXcodeInstallJob(
  nodeId: string,
  jobId: string,
): Promise<XcodeInstallJobSnapshot> {
  const response = await request.get<XcodeInstallJobSnapshot>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/host-tools/xcode/jobs/${encodeURIComponent(jobId)}`,
  )
  return response.data
}

/** POST /api/v1/admin/nodes/{nodeId}/host-tools/xcode/jobs/{jobId}/cancel —— 协作取消。 */
export async function cancelNodeXcodeInstallJob(
  nodeId: string,
  jobId: string,
): Promise<{ cancelled: boolean }> {
  const response = await request.post<{ cancelled: boolean }>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/host-tools/xcode/jobs/${encodeURIComponent(jobId)}/cancel`,
  )
  return response.data
}

/** POST /api/v1/admin/nodes/{nodeId}/editors/{editor}/upgrade —— 在线升级编辑器 CLI */
export async function upgradeNodeEditor(
  nodeId: string,
  editor: string,
): Promise<ManageEditorResult> {
  const response = await request.post<ManageEditorResult>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/editors/${encodeURIComponent(editor)}/upgrade`,
    undefined,
    { timeout: 620000 },
  )
  return response.data
}



/** 节点自升级结果：服务端下发升级命令后节点回报「已接受」。 */
export interface SelfUpgradeResult {
  node_id: string
  target_version: string
  download_url: string
  accepted: boolean
}

/** version.json 里的一条发行资产（runtime 或节点程序），已由服务端过滤敏感字段。
 *
 *  version.json 按 (role,platform,arch) 各自取最新合并，因此每条 asset 带它来源
 *  版本号；旧快照没有 per-asset version 时回退到顶层 version。 */
export interface NodeReleaseAsset {
  role: string
  platform: string
  arch: string
  filename: string
  version?: string
  download_url: string
  digest: string
  size_bytes: number
}

/** coverage 矩阵的一行：某 (role,platform,arch) 各自的最新版本。 */
export interface NodeReleaseCoverage {
  role: string
  platform: string
  arch: string
  version: string
  download_url: string
  digest: string
  size_bytes: number
}

/**
 * 服务端缓存的 ``node-releases/version.json`` 摘要（升级的唯一真相源）。
 * ``stale`` 表示最近一次远端拉取失败、返回的是上次成功快照。
 * ``coverage`` 按 (role,platform,arch) 给出每个平台各自的最新版本——不同平台
 * 可能对应不同版本号，按本节点 os/arch/role 取对应行判断能否升级/部署。
 */
export interface NodeLatestRelease {
  version: string
  version_notes: string
  release_tag: string
  updated_at: string
  stale: boolean
  assets: NodeReleaseAsset[]
  coverage: NodeReleaseCoverage[]
}

/** GET /api/v1/admin/nodes/latest-release —— 服务端缓存的最新节点发行版本。 */
export async function getLatestNodeRelease(): Promise<NodeLatestRelease> {
  const response = await request.get<NodeLatestRelease>("/api/v1/admin/nodes/latest-release")
  const data = response.data || ({} as NodeLatestRelease)
  const assets = Array.isArray(data.assets) ? data.assets : []
  // coverage 与 assets 同源（后端 coverage 即 assets 投影）；旧后端没返回 coverage
  // 时现场用 assets 投影，保证前端判定不丢。
  const coverage = Array.isArray(data.coverage) && data.coverage.length > 0
    ? data.coverage
    : assets.map((a) => ({
        role: a.role,
        platform: a.platform,
        arch: a.arch,
        version: a.version || data.version || "",
        download_url: a.download_url,
        digest: a.digest,
        size_bytes: a.size_bytes,
      }))
  return {
    version: data.version || "",
    version_notes: data.version_notes || "",
    release_tag: data.release_tag || "",
    updated_at: data.updated_at || "",
    stale: Boolean(data.stale),
    assets,
    coverage,
  }
}

/** 从 coverage 里取本节点 (role,os,arch) 对应的最新版本号；无对应资产则空串。 */
export function nodeCoverageVersion(
  release: NodeLatestRelease | null,
  node: { role?: string; capabilities?: Record<string, string> } | null,
): string {
  if (!release || !node) return ""
  const os = node.capabilities?.os
  const arch = node.capabilities?.arch
  // 与服务端 node_release_catalog.select_upgrade_assets 同口径：ios_host 认
  // node-ios 资产（role=ios_host），而不是把它当成 execution 去找 node-execution。
  // 此前 ios_host 恒落到 else → execution 分支，Mac 节点升级判定永远拿不到
  // 自己的最新版本号，前端误报「尚未同步到任何节点发行版本」。
  const role = (node.role || "").trim()
  const wanted = role === "ios_host" ? "ios_host" : role === "management" ? "management" : "execution"
  const row = release.coverage.find(
    (c) => c.role === wanted && c.platform === os && c.arch === arch,
  )
  return row?.version || ""
}


/** 统一升级下发结果：runtime 与节点程序两步各自回报（缺资产则为 null）。 */
export interface UpgradeNodeResult {
  node_id: string
  runtime: RuntimeUpgradeResult | null
  node: SelfUpgradeResult | null
  accepted: boolean
}

/** GET /api/v1/admin/nodes/{nodeId}/upgrade-defaults —— 该节点上次成功升级用的代理预选。 */
export async function getNodeUpgradeDefaults(nodeId: string): Promise<{ last_proxy_id: string }> {
  const response = await request.get<{ last_proxy_id: string }>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/upgrade-defaults`,
  )
  return response.data
}

/** Runtime 升级结果：服务端缓存 Release 资产并下发给节点激活。 */
export interface RuntimeUpgradeResult {
  node_id: string
  target_version: string
  download_url: string
  sha256: string
}

/**
 * POST /api/v1/admin/nodes/{nodeId}/upgrade —— 统一升级节点。
 *
 * 只提交 ``proxy_config_id``：下载地址与校验和一律由服务端从 version.json 解析，
 * 先探测可达再下发。服务端顺序下发 RuntimeUpgrade（热切换）与 SelfUpgrade（重启）帧。
 */
export async function upgradeNode(
  nodeId: string,
  options: { proxyConfigId?: string } = {},
): Promise<UpgradeNodeResult> {
  const response = await request.post<UpgradeNodeResult>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/upgrade`,
    { proxy_config_id: options.proxyConfigId || "" },
    { timeout: 620000 },
  )
  return response.data
}

// ==================== 节点终端（宿主机 shell，仅管理员）====================

/**
 * 节点终端 WebSocket 路径 —— 管理端控制页连它开宿主机 shell。
 *
 * 返回相对路径，交给通用 `Terminal` 组件自行拼 ws/wss（它按当前页协议决定）。
 * 鉴权走 C 端 session cookie（WebSocket 握手会自动带上），所以 URL 里不放任何
 * 令牌——终端等价于宿主机 shell 权限，不该把凭据暴露在地址栏/日志里。
 */
export function nodeTerminalWsPath(nodeId: string): string {
  return `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/terminal`;
}

// ==================== 节点终端管理（查看 / 终止命令 / 关闭）====================

/** 终端用途：agent 命令注入，还是操作者手敲。由服务端覆盖节点回报得出。 */
export type NodeTerminalSource = "agent" | "personal" | "";

/** 节点上一个宿主机终端的运行态（节点详情「终端」Tab 用）。 */
export interface NodeTerminalStatus {
  id: string;
  node_id: string;
  /** 终端用途：agent 注入 / 操作者手敲。服务端用 ActiveTerminalRegistry 覆盖。 */
  source: NodeTerminalSource;
  /** 谁开的这个终端（admin:{id} / user:{id}），无桥时为空。仅审计展示用。 */
  owner: string;
  /** 最近一次提交的命令行（空表示还没跑过命令）。 */
  current_command: string;
  /** 那条命令是否还在跑（没回到提示符）。 */
  running: boolean;
  /** 命令提交时间（epoch 秒），空表示没跑过。 */
  started_at: number | string | null;
  /** PTY 打开时间（RFC3339 / epoch 秒），用于排序与展示运行时长。 */
  created_at: number | string | null;
  /** 节点是否正在向服务端转发该终端输出。 */
  node_attached: boolean;
  /** 是否有浏览器当前在观看该终端。 */
  browser_attached: boolean;
  /** 服务端是否有该终端的控制面桥（熬过重启的 PTY 为 false）。 */
  managed: boolean;
}

/** GET /api/v1/admin/nodes/{nodeId}/terminals —— 节点上所有活着的宿主机终端。 */
export async function listNodeTerminals(nodeId: string): Promise<NodeTerminalStatus[]> {
  const response = await request.get<{ terminals: NodeTerminalStatus[] }>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/terminals`,
  )
  return response.data.terminals ?? []
}

/** POST /api/v1/admin/nodes/{nodeId}/terminals/{terminalId}/interrupt —— 停掉当前命令，保留终端。 */
export async function interruptNodeTerminal(
  nodeId: string,
  terminalId: string,
): Promise<{ interrupted: boolean; agent_command_interrupted: boolean }> {
  const response = await request.post<{ interrupted: boolean; agent_command_interrupted: boolean }>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/terminals/${encodeURIComponent(terminalId)}/interrupt`,
  )
  return response.data
}

/** DELETE /api/v1/admin/nodes/{nodeId}/terminals/{terminalId} —— 杀掉 PTY、关闭终端。 */
export async function closeNodeTerminal(
  nodeId: string,
  terminalId: string,
): Promise<{ closed: boolean }> {
  const response = await request.delete<{ closed: boolean }>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/terminals/${encodeURIComponent(terminalId)}`,
  )
  return response.data
}

export interface NodeHostFileEntry {
  name: string
  path: string
  is_dir: boolean
  size: number
}

export async function nodeHostFile(
  nodeId: string,
  payload: { path: string; operation: string; content?: string; destination?: string },
): Promise<{ path: string; entries?: NodeHostFileEntry[]; content?: string; truncated?: boolean; ok?: boolean }> {
  const response = await request.post(`/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/files`, payload)
  return response.data
}

/** 节点宿主机上传单文件的大小上限（与后端 / 节点两侧常量一致）。 */
export const NODE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024

/**
 * POST /api/v1/admin/nodes/{nodeId}/files/upload —— 往节点宿主机目录上传二进制文件。
 *
 * 走 multipart/form-data：文件原样带上，服务端按 ≤1 MiB 分块经节点协议下发，
 * 节点写临时文件、校验 sha256 后原子改名。这里必须显式把 Content-Type 置为
 * undefined —— axios 实例默认 application/json，而 axios 1.x 在 JSON
 * Content-Type 下会把 FormData 转成 JSON，文件内容会被静默丢弃。
 */
export async function nodeHostFileUpload(
  nodeId: string,
  params: { path: string; file: File; overwrite?: boolean; onProgress?: (percent: number) => void },
): Promise<{ ok: boolean; path: string; bytes_written: number }> {
  const form = new FormData()
  form.append("path", params.path)
  form.append("overwrite", params.overwrite ? "true" : "false")
  form.append("file", params.file, params.file.name)
  const response = await request.post(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/files/upload`,
    form,
    {
      headers: { "Content-Type": undefined },
      // 大文件分块下发到节点比普通管理请求慢，默认 15s 不够。
      timeout: 120000,
      onUploadProgress: (event) => {
        if (!params.onProgress || !event.total) return
        params.onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
      },
    },
  )
  return response.data
}


/** GET /api/v1/admin/nodes/binaries —— 列出可下载的 agent-compose-agent 构建 */
export async function listNodeBinaries(): Promise<NodeBinary[]> {
  const response = await request.get<{ binaries: NodeBinary[] }>(
    "/api/v1/admin/nodes/binaries",
  );
  return response.data.binaries ?? [];
}

/**
 * 下载一个节点运行程序（或 checksums 文件）。
 *
 * 走 axios 以带上 session cookie / Bearer；拿到 blob 后触发浏览器另存为。
 * 直接 ``<a href>`` 会丢鉴权头导致 401。
 */
export async function downloadNodeBinary(name: string): Promise<void> {
  const response = await request.get<Blob>(
    `/api/v1/admin/nodes/binaries/${encodeURIComponent(name)}`,
    { responseType: "blob", timeout: 120000 },
  );
  const blob = response.data;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ==================== 节点 ↔ 分组绑定（管理后台）====================

/** GET /api/v1/admin/groups/{groupId}/nodes */
export async function listGroupNodes(
  groupId: string,
): Promise<GroupNodeBinding[]> {
  const response = await request.get<{ nodes: GroupNodeBinding[] }>(
    `/api/v1/admin/groups/${encodeURIComponent(groupId)}/nodes`,
  );
  return response.data.nodes ?? [];
}

/** POST /api/v1/admin/groups/{groupId}/nodes —— 分配节点给分组 */
export async function bindGroupNode(
  groupId: string,
  nodeId: string,
): Promise<GroupNodeBinding> {
  const response = await request.post<GroupNodeBinding>(
    `/api/v1/admin/groups/${encodeURIComponent(groupId)}/nodes`,
    { node_id: nodeId },
  );
  return response.data;
}

/** DELETE /api/v1/admin/groups/{groupId}/nodes/{nodeId} */
export async function unbindGroupNode(
  groupId: string,
  nodeId: string,
): Promise<void> {
  await request.delete(
    `/api/v1/admin/groups/${encodeURIComponent(groupId)}/nodes/${encodeURIComponent(nodeId)}`,
  );
}

/** GET /api/v1/teams/groups —— 团队分组列表（用于分配下拉） */
export async function listGroups(): Promise<TeamGroupLite[]> {
  const response = await request.get<{ groups: Array<{ id: string; name: string }> }>(
    "/api/v1/teams/groups",
  );
  return (response.data.groups ?? []).map((g) => ({ id: g.id, name: g.name }));
}

export type ShellFlavor = "posix" | "powershell" | "cmd" | "unknown";

export interface ShellApprovalCatalogItem {
  shell: ShellFlavor;
  key: string;
  label: string;
  description: string;
  default: boolean;
}

export interface NodeShellApprovalPolicy {
  node_id: string;
  command_key: string;
  shell_flavor: ShellFlavor;
  note?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface NodeShellApprovalCatalogResponse {
  node_id: string;
  actual_shell_flavor: ShellFlavor;
  catalog: Record<ShellFlavor, ShellApprovalCatalogItem[]>;
}

export interface NodeShellApprovalListResponse {
  node_id: string;
  actual_shell_flavor: ShellFlavor;
  policies: NodeShellApprovalPolicy[];
}

export async function getNodeShellApprovalCatalog(nodeId: string): Promise<NodeShellApprovalCatalogResponse> {
  const response = await request.get<NodeShellApprovalCatalogResponse>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/shell-approval/catalog`,
  );
  return response.data;
}

export async function listNodeShellApproval(nodeId: string): Promise<NodeShellApprovalListResponse> {
  const response = await request.get<NodeShellApprovalListResponse>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/shell-approval`,
  );
  return response.data;
}

export async function putNodeShellApproval(
  nodeId: string,
  commandKey: string,
  shellFlavor: ShellFlavor,
  note?: string,
): Promise<NodeShellApprovalPolicy> {
  const response = await request.put<NodeShellApprovalPolicy>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/shell-approval/${encodeURIComponent(commandKey)}`,
    { shell_flavor: shellFlavor, note: note ?? null },
  );
  return response.data;
}

export async function deleteNodeShellApproval(
  nodeId: string,
  commandKey: string,
  shellFlavor: ShellFlavor,
): Promise<{ deleted: boolean }> {
  const response = await request.delete<{ deleted: boolean }>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/shell-approval/${encodeURIComponent(commandKey)}`,
    { params: { shell_flavor: shellFlavor } },
  );
  return response.data;
}

export async function clearNodeShellApproval(
  nodeId: string,
  shellFlavor?: ShellFlavor,
): Promise<{ deleted: number }> {
  const response = await request.delete<{ deleted: number }>(
    `/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/shell-approval`,
    { params: shellFlavor ? { shell_flavor: shellFlavor } : undefined },
  );
  return response.data;
}
