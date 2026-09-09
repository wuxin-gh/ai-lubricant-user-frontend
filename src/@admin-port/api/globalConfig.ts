import request from "./client";
import type {
  ProxyEntry,
  ProxyInput,
} from "./proxyPool";
import type { ProviderLimitFreezeRule, TestTypeDef, ModelRuleTemplate } from "../types/admin";
import type {
  TokenizerRule,
  ModelMetadataEntry,
} from "./modelMetadata";

// ==================== 全局配置聚合接口 ====================
//
// 各一级 Tab 各自一对 GET/PUT，保存只提交本 Tab 的 payload，互不覆盖。
// 后端复用既有校验/持久化/热更新/日志 helper，仅在外层聚合。

// ---------- 市场源配置（同步策略 / 代理） ----------
//
// 资源中心「配置」Tab 与这里共用同一份配置：市场展示、渠道目录同步、节点程序版本
// 都指向同一个 GitHub 市场仓库，所以只有一份源配置。仓库地址与 GitHub token 只在
// 服务端 .env 配置（MARKETPLACE_REPO_URL / MARKETPLACE_GITHUB_TOKEN），不进这份接口。

export interface MarketplaceSourceConfig {
  github_branch: string
  modules: string
  index_name: string
  /** 市场拉取（raw / release）使用的代理池条目 id；空表示直连。 */
  proxy_id: string
  auto_sync_enabled: boolean
  sync_interval_minutes: number
  /** 已生效的解析结果（.env / 内置默认），仓库地址看 effective.repo_url。 */
  effective: {
    repo_url: string
    owner: string
    repo: string
    branch: string
    modules: string[]
    index_name: string
    enabled: boolean
    writable: boolean
  }
  // ── 外部榜单同步（Agent-Leaderboard）─────────────────────────────────────
  // 全部 opt-in：未显式打开 leaderboard_sync_enabled 时整条同步链不跑，其它部署
  // 只消费已配置的市场仓库，不抓外部榜单。
  leaderboard_sync_enabled: boolean
  leaderboard_sync_interval_hours: number
  leaderboard_repo: string
  leaderboard_boards: string
  /** 补 MCP 启动方式的专用 agent id；0=未配置，同步可用但 agent 补全会拒绝。 */
  leaderboard_launch_agent_id: number
  /** MCP launch_spec 发布门禁：true=必须 verified 才能发布；false（默认）=filled 即放行。 */
  leaderboard_require_verified: boolean
  // ── 内容源同步（agency-agents / agency-agents-zh / agentscope）──
  agency_agents_enabled: boolean
  agency_agents_interval_hours: number
  agency_agents_ref: string
  agency_agents_zh_enabled: boolean
  agency_agents_zh_interval_hours: number
  agency_agents_zh_ref: string
  agentscope_enabled: boolean
  agentscope_interval_hours: number
  // 各源出网代理：留空回落 proxy_id 全局；agentscope 无此字段（恒走全局）
  leaderboard_proxy_id: string
  agency_agents_proxy_id: string
  agency_agents_zh_proxy_id: string
  // 各源最近一次同步时间（后端同步收尾写入，随配置持久化——重启不丢）
  leaderboard_last_sync_at: string
  agency_agents_last_sync_at: string
  agency_agents_zh_last_sync_at: string
  agentscope_last_sync_at: string
  default_leaderboard_repo: string
  default_leaderboard_boards: string
}

export interface MarketplaceSourceInput {
  proxy_id?: string
  // 外部榜单同步：只传要改的字段，未传的不动。enabled 必须显式 true 才打开。
  leaderboard_sync_enabled?: boolean
  leaderboard_sync_interval_hours?: number
  leaderboard_repo?: string
  leaderboard_boards?: string
  leaderboard_launch_agent_id?: number
  leaderboard_require_verified?: boolean
  leaderboard_proxy_id?: string
  agency_agents_enabled?: boolean
  agency_agents_interval_hours?: number
  agency_agents_ref?: string
  agency_agents_proxy_id?: string
  agency_agents_zh_enabled?: boolean
  agency_agents_zh_interval_hours?: number
  agency_agents_zh_ref?: string
  agency_agents_zh_proxy_id?: string
  agentscope_enabled?: boolean
  agentscope_interval_hours?: number
}

export async function getMarketplaceSourceConfig(): Promise<MarketplaceSourceConfig> {
  const response = await request.get<MarketplaceSourceConfig>(
    "/api/v1/marketplace/admin/source-config",
  )
  return response.data
}

export async function updateMarketplaceSourceConfig(
  config: MarketplaceSourceInput,
): Promise<MarketplaceSourceConfig> {
  const response = await request.put<{ ok: boolean } & MarketplaceSourceConfig>(
    "/api/v1/marketplace/admin/source-config",
    config,
  )
  return response.data
}

// ---------- 运行模式 ----------

export interface RunModeConfig {
  debug: boolean;
}

/** GET /admin/global-config/run-mode */
export async function getRunModeConfig(): Promise<RunModeConfig> {
  const response = await request.get<RunModeConfig>(
    "/admin/global-config/run-mode",
  );
  return response.data;
}

/** PUT /admin/global-config/run-mode */
export async function updateRunModeConfig(
  config: RunModeConfig,
): Promise<RunModeConfig> {
  const response = await request.put<{ ok: boolean; debug: boolean }>(
    "/admin/global-config/run-mode",
    config,
  );
  return { debug: response.data.debug };
}

// ---------- 代理池 ----------

export interface ProxyPoolTabConfig {
  proxies: ProxyEntry[];
}

/** GET /admin/global-config/proxy-pool */
export async function getProxyPoolTabConfig(): Promise<ProxyPoolTabConfig> {
  const response = await request.get<ProxyPoolTabConfig>(
    "/admin/global-config/proxy-pool",
  );
  return response.data;
}

/**
 * PUT /admin/global-config/proxy-pool —— 全量替换代理列表，保留既有 id 以稳定账号引用。
 */
export async function updateProxyPoolTabConfig(
  proxies: ProxyInput[],
): Promise<{ ok: boolean; count: number }> {
  const response = await request.put<{ ok: boolean; count: number }>(
    "/admin/global-config/proxy-pool",
    proxies,
  );
  return response.data;
}

// ---------- 节点全局 ----------

export interface NodeGlobalConfig {
  revision: string | number;
  ipv4_urls: string[];
  ipv6_urls: string[];
}

/**
 * 节点 RPC 经 connect JSON 透出的是 camelCase（ipv4Urls/ipv6Urls），
 * 这里统一归一成 snake_case，避免调用方按错字段读到 undefined。
 */
function normalizeNodeGlobalConfig(raw: unknown): NodeGlobalConfig {
  const data = (raw ?? {}) as Record<string, unknown>;
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    revision: (data.revision as string | number) ?? 0,
    ipv4_urls: list(data.ipv4_urls ?? data.ipv4Urls),
    ipv6_urls: list(data.ipv6_urls ?? data.ipv6Urls),
  };
}

/** GET /api/v1/admin/global-config/node-global */
export async function getNodeGlobalConfig(): Promise<NodeGlobalConfig> {
  const response = await request.get<unknown>(
    "/api/v1/admin/global-config/node-global",
  );
  return normalizeNodeGlobalConfig(response.data);
}

/** PUT /api/v1/admin/global-config/node-global —— 实时下发到在线节点 */
export async function updateNodeGlobalConfig(
  config: NodeGlobalConfig,
): Promise<NodeGlobalConfig> {
  const response = await request.put<unknown>(
    "/api/v1/admin/global-config/node-global",
    { ipv4_urls: config.ipv4_urls, ipv6_urls: config.ipv6_urls },
  );
  return normalizeNodeGlobalConfig(response.data);
}

// ---------- 渠道配置 ----------

export interface OutputInterceptionRule {
  name: string;
  enabled: boolean;
  match_type: "regex" | "text";
  pattern: string;
}

export interface OutputInterceptionRulesConfig {
  enabled: boolean;
  rules: OutputInterceptionRule[];
}

export interface ChannelTabConfig {
  scheduled: {
    model_refresh: { interval_minutes: number };
    message_delete: { enabled: boolean; interval_minutes: number };
  };
  /** 定时检测全局配置：并发度 + 「最近请求过则跳过本轮」窗口秒数。全局共用一个消费者池。 */
  scheduled_test: {
    concurrency: number;
    skip_if_requested_within_seconds: number;
  };
  retry: {
    max_retries: number;
    context_overflow_not_retryable_enabled: boolean;
    output_interception_rules: OutputInterceptionRulesConfig;
  };
  stream: { incomplete_error_enabled: boolean };
  rate_limit: {
    status_codes: number[];
    cooldown_seconds: number;
    exception_cooldown_seconds: number;
    allow_token_reservation_overflow: boolean;
  };
  account_test: { types: TestTypeDef[] };
  default_freeze_policy: { enabled: boolean; rules: ProviderLimitFreezeRule[] };
  header_templates: Array<{
    id: string;
    name: string;
    headers: Record<string, string>;
  }>;
  /** 全局模型规则模版库；渠道的改写条目按 id 活引用这里的模版。 */
  model_rule_templates: ModelRuleTemplate[];
}

/** GET /admin/global-config/channels */
export async function getChannelTabConfig(): Promise<ChannelTabConfig> {
  const response = await request.get<ChannelTabConfig>(
    "/admin/global-config/channels",
  );
  return response.data;
}

/** PUT /admin/global-config/channels —— 只改本 Tab 字段，未提供字段保持原值 */
export async function updateChannelTabConfig(
  config: Partial<ChannelTabConfig>,
): Promise<{ ok: boolean }> {
  const response = await request.put<{ ok: boolean }>(
    "/admin/global-config/channels",
    config,
  );
  return response.data;
}

// ---------- 模型规则模版（全局，供渠道的改写条目引用） ----------

/** GET /admin/model-rule-templates */
export async function getModelRuleTemplates(): Promise<ModelRuleTemplate[]> {
  const response = await request.get<{ templates: ModelRuleTemplate[] }>(
    "/admin/model-rule-templates",
  );
  return response.data.templates || [];
}

/** PUT /admin/model-rule-templates —— 全量替换模版库，保存后即时下发运行时 */
export async function saveModelRuleTemplates(
  templates: ModelRuleTemplate[],
): Promise<ModelRuleTemplate[]> {
  const response = await request.put<{ ok: boolean; templates: ModelRuleTemplate[] }>(
    "/admin/model-rule-templates",
    { templates },
  );
  return response.data.templates || [];
}

// ---------- 模型配置 ----------

export interface TokenizerPolicyRule {
  family: string;
  pattern: string;
  type: "chars" | "tiktoken" | "huggingface";
  encoding?: string;
  repo?: string;
}

export interface TokenizerPolicy {
  /** built_in：策略由后端按模型族自动选择，用户不可编辑。 */
  mode: "built_in";
  editable: false;
  rules: TokenizerPolicyRule[];
  note?: string;
}

export interface TokenizerVocabItem {
  repo: string;
  /** 词表是否已存入数据库（所有实例共享）。false 时运行时降级到近似分词器。 */
  present: boolean;
  etag?: string | null;
  bytes?: number | null;
  downloaded_at?: number | null;
  remote_etag?: string | null;
  /** current / missing / update_available / unknown / check_failed */
  status: string;
  error?: string | null;
}

export interface TokenizerVocabConfig {
  enabled: boolean;
  interval_hours: number;
  mirror: string;
  /** 词表存数据库，所有实例共享；状态反映数据库快照。 */
  items: TokenizerVocabItem[];
}

export interface ModelTabConfig {
  /** 内置 tokenizer 策略摘要，只读展示。不再回传用户可编辑规则。 */
  tokenizer_policy?: TokenizerPolicy;
  /** HF 词表版本检查配置与状态。检查只比对 ETag，更新需管理员手动触发。 */
  tokenizer_vocab?: TokenizerVocabConfig;
  /** 上下文超限拦截开关。关闭后不再按本地估算返回 context_too_large，渠道 token 预占不受影响。 */
  context_detection_enabled: boolean;
  thinking: {
    /** 保留以兼容旧前端读取；不再在 UI 渲染编辑器。 */
    reasoning_owned_by?: string[];
    thinking_global_enabled: boolean;
    simulated_client_defaults?: {
      reasoning_effort?: string;
      auto_search?: boolean;
    };
    // 只读展示的系统默认值
    thinking_defaults?: Record<string, unknown>;
    reasoning_defaults?: Record<string, unknown>;
  };
  owned_by_options: string[];
  default_metadata: ModelMetadataEntry | null;
}

/** GET /admin/global-config/models */
export async function getModelTabConfig(): Promise<ModelTabConfig> {
  const response = await request.get<ModelTabConfig>(
    "/admin/global-config/models",
  );
  return response.data;
}

/** PUT /admin/global-config/models —— 只提交 thinking/context/词表检查/default metadata；tokenizer 规则不可编辑 */
export async function updateModelTabConfig(
  config: Pick<ModelTabConfig, "context_detection_enabled" | "thinking" | "default_metadata"> & {
    tokenizer_vocab?: Pick<TokenizerVocabConfig, "enabled" | "interval_hours" | "mirror">;
  },
): Promise<{ ok: boolean }> {
  const response = await request.put<{ ok: boolean }>(
    "/admin/global-config/models",
    config,
  );
  return response.data;
}

export interface TokenizerWarmupResult {
  ok: boolean;
  repo: string;
  bytes: number;
  path: string;
  /** 词表已落盘但缺 tokenizers 库时为 false，运行时仍会降级。 */
  loadable: boolean;
  warning?: string | null;
}

/**
 * POST /admin/config/main/tokenizer-rules/warmup
 *
 * 下载 HuggingFace 词表到服务端本地磁盘。词表可达 20MB，估算函数在请求热路径上，
 * 绝不能在那里联网，所以必须先在这里预热。
 */
export async function warmupTokenizerVocab(
  repo: string,
  mirror?: string,
): Promise<TokenizerWarmupResult> {
  const response = await request.post<TokenizerWarmupResult>(
    "/admin/config/main/tokenizer-rules/warmup",
    { repo, ...(mirror ? { mirror } : {}) },
  );
  return response.data;
}

export interface TokenizerTestRow {
  attempt_key: string;
  model: string;
  rule: string;
  real_prompt_tokens: number;
  estimated_prompt_tokens: number;
  /** 估算/真实。1.00 为准。 */
  ratio: number;
}

export interface TokenizerTestResult {
  ok: boolean;
  samples: number;
  rows: TokenizerTestRow[];
  summary: {
    samples: number;
    median_ratio: number;
    p10_ratio: number;
    p90_ratio: number;
    worst_ratio: number;
    /** 把中位数拉到 1.00 所需的系数，可直接填进规则的 calibration。 */
    suggested_calibration: number | null;
  } | null;
  note?: string;
}

/**
 * POST /admin/config/main/tokenizer-rules/test
 *
 * 用真实历史日志试算候选规则：地面真值取上游回报的 prompt_tokens，请求体从
 * ClickHouse 取回。候选规则不落盘，存之前就能看到偏差。
 */
export async function testTokenizerRules(payload: {
  rules?: TokenizerRule[];
  limit?: number;
  model?: string;
}): Promise<TokenizerTestResult> {
  const response = await request.post<TokenizerTestResult>(
    "/admin/config/main/tokenizer-rules/test",
    payload,
  );
  return response.data;
}

export interface TokenizerVocabStatusResponse {
  enabled: boolean;
  interval_hours: number;
  mirror: string;
  items: TokenizerVocabItem[];
}

/** GET /admin/config/main/tokenizer-vocab/status —— 当前实例的词表状态。 */
export async function getTokenizerVocabStatus(): Promise<TokenizerVocabStatusResponse> {
  const response = await request.get<TokenizerVocabStatusResponse>(
    "/admin/config/main/tokenizer-vocab/status",
  );
  return response.data;
}

/** POST /admin/config/main/tokenizer-vocab/check —— 立即比对 ETag，不下载。 */
export async function checkTokenizerVocabNow(): Promise<{ ok: boolean; items: TokenizerVocabItem[] }> {
  const response = await request.post<{ ok: boolean; items: TokenizerVocabItem[] }>(
    "/admin/config/main/tokenizer-vocab/check",
    {},
  );
  return response.data;
}

// ---------- 社区运营配置（技术交流群 + 社区通知） ----------
//
// 存 DB 主配置 blob 的独立 community key（不进市场仓库）。管理端入口在
// 市场管理 → 配置 → 社区运营；用户控制台弹窗读公开端点（见 api/marketplaceRaw）。

export interface CommunityGroup {
  id: string;
  /** 群类型：wechat / feishu / dingtalk / qq / other。 */
  type: string;
  /** 群展示名；空则用户侧回落群类型的 i18n 标签。 */
  label: string;
  /** 二维码图片：data URL（管理端上传时已压 512px/WebP）。 */
  qr_image: string;
}

export interface CommunityNoticeEntry {
  id: string;
  kind: "text" | "image";
  text?: string;
  image?: string;
}

export interface CommunityConfig {
  groups: CommunityGroup[];
  notice: {
    enabled: boolean;
    entries: CommunityNoticeEntry[];
  };
}

/** GET /api/v1/marketplace/admin/community-config */
export async function getCommunityConfig(): Promise<CommunityConfig> {
  const response = await request.get<CommunityConfig>(
    "/api/v1/marketplace/admin/community-config",
  );
  return normalizeCommunityConfig(response.data);
}

/** PUT /api/v1/marketplace/admin/community-config —— groups / notice 整段替换，未传的不动 */
export async function updateCommunityConfig(
  config: { groups?: CommunityGroup[]; notice?: CommunityConfig["notice"] },
): Promise<CommunityConfig> {
  const response = await request.put<{ ok: boolean } & CommunityConfig>(
    "/api/v1/marketplace/admin/community-config",
    config,
  );
  return normalizeCommunityConfig(response.data);
}

/** 服务端形状归一的兜底：字段缺失/类型不对时回空骨架，避免渲染层到处判空。 */
function normalizeCommunityConfig(raw: unknown): CommunityConfig {
  const data = (raw ?? {}) as Record<string, unknown>;
  const groups = Array.isArray(data.groups)
    ? data.groups.filter((g): g is CommunityGroup => !!g && typeof g === "object" && !!g.qr_image)
    : [];
  const noticeRaw = (data.notice ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(noticeRaw.entries)
    ? noticeRaw.entries.filter((e): e is CommunityNoticeEntry => !!e && typeof e === "object")
    : [];
  return {
    groups,
    notice: { enabled: noticeRaw.enabled === true && entries.length > 0, entries },
  };
}
