
/**
 * model_id 改写条目：把上游模型 ID 改写成对外 model_id。
 * 顺序敏感——后端自上而下逐条 re.sub，不是命中即停。
 *
 * 条目分两种：内联规则（kind 可省，存量数据即此形态）与全局模版引用。
 * 二者同列排序，位置即优先级，模版与内联规则之间没有高低之分。
 *
 * 字段全必填：读写两侧都过 normalizeModelIdRewriteRules 补齐，
 * 留 optional 只会让消费方到处写兜底。
 */
export interface ModelIdRewriteRule {
  /** 省略即内联规则；显式 "rule" 与省略等价。 */
  kind?: "rule";
  name: string;
  enabled: boolean;
  pattern: string;
  replacement: string;
}

/** 对全局模型规则模版的活引用：改模版立即影响所有引用它的渠道。 */
export interface ModelIdRewriteTemplateRef {
  kind: "template";
  template_id: string;
  enabled: boolean;
}

export type ModelIdRewriteEntry = ModelIdRewriteRule | ModelIdRewriteTemplateRef;

/** 全局模型规则模版：存 app_config，rules 只含内联规则（不能嵌模版）。 */
export interface ModelRuleTemplate {
  id: string;
  name: string;
  rules: ModelIdRewriteRule[];
}

export function isModelIdRewriteTemplateRef(
  entry: ModelIdRewriteEntry,
): entry is ModelIdRewriteTemplateRef {
  return entry.kind === "template";
}

// ==================== 认证 ====================

export interface LoginResponse {
  token: string;
  expires_in: number;
}

export interface CheckAuthResponse {
  ok: boolean;
}

// ==================== 主配置 /admin/config/main ====================

/** config.json 顶层结构（部分字段） */
export interface MainConfig {
  accounts?: Array<{
    username: string;
    password?: string;
    proxy?: string | null;
    switch?: boolean;
  }>;
  server?: {
    host?: string;
    port?: number;
  };
  admin?: {
    password_hash?: string;
    password_salt?: string;
    session_duration_hours?: number;
  };
  api_keys?: {
    enabled?: boolean;
  };
  retry?: {
    max_retries?: number;
    non_retryable_parameter_errors?: {
      status_codes?: number[];
      types?: string[];
      codes?: string[];
      params?: string[];
      markers?: string[];
    };
  };
  stream?: {
    incomplete_error_enabled?: boolean;
  };
  rate_limit?: {
    status_codes?: number[];
    cooldown_seconds?: number;
    exception_cooldown_seconds?: number;
  };
  logging?: {
    level?: string;
  };
  model_refresh?: {
    interval_minutes?: number;
  };
  message_delete?: {
    enabled?: boolean;
    interval_minutes?: number;
  };
  log_retention?: {
    max_entries?: number;
  };
  data_retention?: {
    log_days?: number;
    archive_keep_entries?: number;
    keep_full_entries_per_provider?: number;
    cleanup_hour?: number;
  };
  proxies?: Array<{
    id?: string;
    name: string;
    mode?: "network" | "url_prefix" | "direct";
    url: string;
    username?: string;
    password?: string;
  }>;
  system?: {
    debug?: boolean;
  };
  model_routes?: {
    routes?: Array<Record<string, unknown>>;
  };
  model_groups?: {
    groups?: Record<string, unknown>;
  };
  tokenizer?: {
    rules?: Array<Record<string, unknown>>;
  };
  account_test?: {
    types?: TestTypeDef[];
  };
  [key: string]: unknown;
}

// 账号测试类型（可配置）。每项 = 一组消息 + 附加 body 字段；
// operation 非空表示媒体类型（image / video / tts_generation），messages 为空。
export interface TestTypeDef {
  key: string;
  label: string;
  operation?: string | null;
  messages?: Array<Record<string, unknown>>;
  body?: Record<string, unknown>;
}

// ==================== 全局思考配置 /admin/config/thinking-global ====================

export interface ThinkingGlobalConfig {
  reasoning_owned_by: string[];
  thinking_global_enabled: boolean;
  thinking_defaults: Record<string, unknown>;
  reasoning_defaults: Record<string, unknown>;
  simulated_client_defaults?: {
    reasoning_effort?: string;
    auto_search?: boolean;
  };
}

// ==================== 渠道（Provider） ====================

export interface BuiltinProviderInfo {
  name: string;
  remark: string;
  description: string;
  created: boolean;
  doc_url?: string;
}

export interface ProviderLite {
  id: string;
  name: string;
  enabled: boolean;
  remark: string;
  tags: string[];
  custom_channel: boolean;
  builtin_type: string;
  protocol: string | null;
  models: string[];
}

export interface ProviderSummary extends Record<string, unknown> {
  id: string;
  name: string;
  enabled: boolean;
  remark: string;
  tags: string[];
  type: "custom" | "builtin";
  custom_channel: boolean;
  builtin_type: string;
  protocol: string | null;
  base_url: string | null;
  website_url?: string;
  icon?: string;
  account_count: number;
  enabled_account_count: number;
  auth_account_count: number;
  auth_failed_account_count: number;
  checking_account_count: number;
  supports_token_auto_refresh: boolean;
  requesting_account_count: number;
  cooldown_account_count: number;
  disabled_account_count: number;
  retry_count?: number | null;
  extra_retry_status_codes?: number[];
  updated_at_ts: number;
  models: string[];
}

export interface ChatProtocolConfig {
  id?: string;
  enabled?: boolean;
  protocol: string;
  path: string;
  upstream_stream?: boolean | 'auto';
  client_preset?: string;
  header_template?: string;
  system_type?: string;
  /** openai 协议行专用：是否把 assistant.reasoning_content 透传给上游。默认 true。 */
  send_reasoning_content?: boolean;
  models?: string[];
}

export interface TemplateChatProtocolConfig extends ChatProtocolConfig {
  /** GitHub 模板只携带可移植名称；打开创建弹窗时解析为本地 header_template id。 */
  header_template_name?: string;
}

export interface ProviderCreatePreset {
  remark?: string;
  tags?: string[];
  enabled?: boolean;
  protocol?: string | null;
  base_url?: string;
  chat_path?: string | null;
  website_url?: string;
  icon?: string;
  models_path?: string | null;
  image_path?: string | null;
  video_path?: string | null;
  speech_path?: string | null;
  timeout?: number;
  retry_count?: number | null;
  extra_retry_status_codes?: number[];
  billing_mode?: "token" | "request";
  chat_protocols?: TemplateChatProtocolConfig[];
  rate_limit?: RateLimitConfig;
  freeze_policy?: ProviderLimitPolicy["freeze_policy"];
  account_priority?: number;
  account_weight?: number;
  auto_update_models?: boolean;
  /** 上游模型 ID → 对外 model_id 的改写条目，顺序敏感；可内联规则或全局模版引用 */
  model_id_rewrite_rules?: ModelIdRewriteEntry[];
  models?: Array<string | ProviderModelEntry>;
  accounts?: Array<{ api_key?: string; username?: string }>;
  template_warnings?: string[];
  /** 代码渠道（builtin_type='code'）的 Provider Python 源码，来自渠道目录预设。 */
  code?: string;
  // 复制流程携带：以下字段后端 _provider_base_response 已返回，复制时需原样带进新建草稿。
  supports_image_generation?: boolean;
  supports_video_generation?: boolean;
  supports_tts?: boolean;
  health_check?: HealthCheckConfig;
  scheduled_test?: ScheduledTestConfig;
  clear_conversation?: Record<string, unknown>;
}

export interface ChannelCatalogEntry {
  id: string;
  name: string;
  description: string;
  category?: string;
  tags: string[];
  icon?: string;
  builtin_type?: string;
  preset: ProviderCreatePreset;
}

export interface ChannelCatalogResponse {
  items: ChannelCatalogEntry[];
  updated_at: string;
  stale: boolean;
  ok?: boolean;
  error?: string;
}

export interface ChannelTemplateManifestV1 {
  schema: "ai-lubricant.channel-template/v1";
  id: string;
  kind: "channel_template";
  name: string;
  display_name: string;
  summary: string;
  version: string;
  status?: string;
  publisher?: string;
  category?: string;
  tags?: string[];
  resource: {
    type: "channel_template";
    channel: ProviderCreatePreset;
    freeze_policy: ProviderLimitPolicy["freeze_policy"];
  };
}

export interface HeaderTemplate {
  id: string;
  name: string;
  headers: Record<string, string>;
}

export interface ProviderBaseConfig {
  id: string;
  name: string;
  enabled: boolean;
  rate_limit: RateLimitConfig;
  clear_conversation: Record<string, unknown>;
  remark: string;
  tags: string[];
  type: "custom" | "builtin";
  custom_channel: boolean;
  builtin_type: string;
  protocol: string | null;
  base_url: string | null;
  chat_path: string | null;
  models_path: string | null;
  image_path: string | null;
  video_path: string | null;
  speech_path?: string | null;
  chat_protocols?: ChatProtocolConfig[];
  chat_protocols_error?: string; // 后端标注：为空表示未配置对话协议行，需在页面提示且禁止保存
  endpoint_configs?: ChatProtocolConfig[]; // 兼容旧字段，由后端镜像 chat_protocols
  supports_image_generation: boolean;
  supports_video_generation: boolean;
  supports_tts?: boolean;
  account_priority: number;
  account_weight: number;
  auto_update_models: boolean;
  model_id_rewrite_rules?: ModelIdRewriteEntry[];
  timeout: number;
  retry_count?: number | null;
  extra_retry_status_codes?: number[];
  health_check: HealthCheckConfig;
  scheduled_test: ScheduledTestConfig;
  billing_mode?: "token" | "request" | string;
  balance?: Record<string, unknown>;
  models: string[];
  model_rows?: ProviderModelEntry[];
  website_url?: string;
  icon?: string;
  /** 代码渠道（builtin_type='code'）的 Provider Python 源码，编辑态回显用。 */
  code?: string;
  /** 上一次定时检测到点触发的时间戳（Unix 秒）；从未触发过为 null。 */
  last_scheduled_test_at?: number | null;
}

export interface ProviderModelLite {
  upstream_model_id: string;
  model_id: string;
}

export interface ProviderModelEntry extends Record<string, unknown> {
  upstream_model_id?: string;
  model_id?: string;
  id?: string;
  name?: string;
  extra_config?: Record<string, unknown>;
  /** 上游原始模型名（未切 "/"、未套规则），获取上游模型预览用 */
  raw_model_id?: string;
  /** 纯规则结果（不考虑撞名让位）；is_regex 为真时即这行被改成的名字 */
  regex_model_id?: string;
  /** 改写规则是否命中这行；开关开启时这行显示 regex_model_id（预览自动更新结果） */
  is_regex?: boolean;
  /** 显示用：开关开=regex_model_id，关=raw_model_id；只渲染，不影响导入。 */
  _display_model_id?: string;
  tracked?: boolean;
  current_model_id?: string;
}

export interface ProviderModelsResponse {
  ok: boolean;
  provider: string;
  models: ProviderModelEntry[];
}

export interface ProviderModelsSaveResponse extends OkResponse {
  count?: number | null;
  skipped?: boolean;
}

export interface ProviderLimitFreezeRule {
  condition: "status_code" | "headers" | "exception" | "error_type" | "body";
  key: string;
  operator: "in" | "==" | "!=" | "<=" | ">=" | "<" | ">" | "exists" | "contains" | "";
  value: string;
  /** 冻结对象：作用范围 */
  freeze_object: "account" | "account_model" | "channel" | "channel_model";
  /** 冻结周期：冻结多久 */
  freeze_period: "none" | "disabled" | "permanent" | "seconds" | "minutes" | "hours" | "days" | "today" | "week" | "month";
  /** 冻结数值：分钟/小时/天/秒 周期填正整数；其余周期忽略 */
  freeze_value: number;
  /** 规则开关：关掉后这条规则不参与匹配，配置保留。缺省视为开 */
  enabled?: boolean;
}

export interface ProviderLimitPolicy {
  provider_name?: string;
  name: string;
  enabled: boolean;
  account_rpm: number;
  account_tpm: number;
  model_tpm: number;
  account_concurrent: number;
  /** 每小时次数（触线即冻结账号到窗口末） */
  account_rph: number;
  /** 每小时 tokens（触线即冻结账号到窗口末） */
  account_tph: number;
  /** 每天次数（触线即冻结账号到当天结束） */
  account_rpd: number;
  /** 每天 tokens（触线即冻结账号到窗口末） */
  account_tpd: number;
  cooldown_policy: Record<string, string>;
  freeze_policy: {
    enabled: boolean;
    /** 渠道级开关：失败命中规则时是否按本次规则刷新已冻结对象 TTL；关时保留现有到期时间 */
    refresh_freeze_on_failure?: boolean;
    rules: ProviderLimitFreezeRule[];
  };
  extra?: Record<string, unknown>;
}

export interface ProviderLimitPolicyResponse extends OkResponse {
  policy: ProviderLimitPolicy;
}

export interface ProviderAccountPayload extends Record<string, unknown> {
  username: string;
  password?: string;
  api_key?: string;
  key?: string;
  proxy?: string | null;
  switch?: boolean;
  priority?: number;
  weight?: number;
  rpm_limit?: number;
  tpm_limit?: number;
  concurrent_limit?: number;
  /** 账号备注 / 价格说明 */
  price_remark?: string;
  /** Cloudflare Workers AI 渠道：Account ID */
  account_id?: string;
  /** EdgeOne AI：二级域名 name */
  name?: string;
  /** EdgeOne AI：本系统对外模型名 */
  model_name?: string;
  /** Tabbit：OAuth client_id */
  client_id?: string;
  /** Tabbit：OAuth client_secret */
  client_secret?: string;
  /** Tabbit：refresh_token，用于刷新 access_token */
  refresh_token?: string;
  /** Tabbit：access_token */
  access_token?: string;
  /** Tabbit：access_token 过期时间（Unix 秒） */
  access_token_expires_at?: number;
  add_method?: string;
  metadata?: Record<string, unknown>;
  /** 额外字段（任意未识别字段的兜底存储） */
  extra?: Record<string, unknown>;
}

export type AccountSchemaFieldType = "text" | "password" | "number" | "textarea" | "select" | "checkbox" | "datetime";

export interface AccountSchemaField extends Record<string, unknown> {
  key: string;
  label: string;
  type?: AccountSchemaFieldType;
  required?: boolean;
  readonly?: boolean;
  secret?: boolean;
  placeholder?: string;
  help_text?: string;
  section?: string;
  span?: number;
  default?: unknown;
  default_value?: unknown;
  options?: Array<{ label: string; value: string | number | boolean }>;
}

export interface ProviderAccountSchema extends Record<string, unknown> {
  provider_name: string;
  display_name?: string;
  add_methods: string[];
  fields: AccountSchemaField[];
  auth_start?: {
    enabled?: boolean;
    label?: string;
    description?: string;
    /** 授权模式，后端据此分发：device_code 走设备码流，oauth_callback 走回调流。 */
    mode?: "device_code" | "oauth_callback" | "callback" | "popup" | string;
    /**
     * 授权完成方式，决定授权区 UI 形态：
     * - poll：纯轮询自动认领，无需输入框
     * - callback：上游回调服务端 redirect_uri，无需输入框
     * - loopback：上游只回调 127.0.0.1:{port}；同机自动命中，跨机时显示输入框让用户粘 URL 补投
     */
    completion?: "poll" | "callback" | "loopback" | string;
    [key: string]: unknown;
  };
  add_guidance?: string;
  metadata_badges?: string[];
}

/** POST /admin/providers/{id}/accounts/auth/start 的请求体。 */
export interface ProviderAccountAuthStartPayload {
  account: Record<string, unknown>;
  /**
   * 浏览器自身的 origin（`window.location.origin`）。回调地址的服务端部分必须是
   * 浏览器可达的地址，后端从当次请求推导会在反代/容器后拼出内网地址；路径由后端拼。
   */
  origin: string;
}

export interface ProviderAccountAuthStartResponse extends OkResponse {
  state?: string;
  /** 框架生成的回调地址（浏览器 origin + 框架路径），仅回调式授权返回。 */
  redirect_uri?: string;
  auth_url?: string;
  verification_uri?: string;
  login_url?: string;
  user_code?: string;
  expires_in?: number;
  interval?: number;
  mode?: string;
  poll_status?: boolean;
  poll_interval?: number;
  /** 完成方式（与 account_schema.auth_start.completion 一致），前端据此决定是否显示补投输入框。 */
  completion?: "poll" | "callback" | "loopback" | string;
  message?: string;
}

/** POST /admin/providers/{id}/accounts/auth/replay 的响应（手工补投本机回调地址）。 */
export interface ProviderAccountAuthReplayResponse extends OkResponse {
  /** completed = 补投即完成授权；pending = 票据已更新，等扫描器换取凭证。 */
  status?: "completed" | "pending" | string;
  message?: string;
  username?: string;
}

export type ProviderAccountAuthStatus =
  | "idle"
  | "pending"
  | "authorized"
  | "completed"
  | "error"
  | "expired"
  | "cancelled";

export interface ProviderAccountAuthStatusResponse {
  status: ProviderAccountAuthStatus;
  state?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  elapsed?: number;
  username?: string;
  account?: Record<string, unknown>;
  message?: string;
  error?: string;
}

export interface ProviderUpstreamModelItem {
  upstream_model_id?: string;
  model_id?: string;
  /** 原始上游模型名（未经切 "/" 与改写规则处理）；前端开关切换显示用 */
  raw_model_id?: string;
  /** 纯规则改写结果（不考虑撞名让位）；is_regex 为 true 时与 raw_model_id 不同 */
  regex_model_id?: string;
  /** 改写规则是否命中这一行。只切 "/" 前缀不算命中（那是无配置时的默认形态） */
  is_regex?: boolean;
  name?: string;
  tracked?: boolean;
  current_model_id?: string;
  raw?: unknown;
}

export interface ProviderUpstreamModelsResponse extends OkResponse {
  provider?: string;
  upstream_models?: ProviderUpstreamModelItem[];
  /** @deprecated 已弃用：服务端不会返回该字段；保留以兼容旧调用方，请读取 upstream_models */
  models?: Array<string | ProviderModelEntry>;
  error?: string;
}

export interface ProviderAccountsActionResponse extends OkResponse {
  username?: string;
  message?: string;
}

export interface ProviderAccountsTestResponse extends OkResponse {
  accounts?: Array<Record<string, unknown>>;
  results?: Array<Record<string, unknown>>;
}

export interface DetectModelResult {
  username: string
  ok: boolean
  /** 本次实际构造并发送的目标窗口大小（字符近似） */
  target_tokens: number
  target_size?: string
  /** 请求成功时等于 target_tokens */
  verified_tokens?: number
  /** metadata 声明窗口，仅供对照，不参与测试大小计算 */
  declared_limit?: number | null
  error_message?: string
  sample?: string
  duration_ms: number
}

export interface DetectModelResponse extends OkResponse {
  results: DetectModelResult[]
}

export interface RateLimitConfig {
  status_codes?: number[];
  rpm_per_account?: number;
  tpm_per_account?: number;
  tpm_per_model?: number;
  concurrent_per_account?: number;
  requests_per_minute_per_account?: number;
}

export interface HealthCheckConfig {
  enabled: boolean;
  interval_minutes: number;
  test_model: string;
}

/** 渠道定时检测配置：到点按测试 tab 同款参数跑一次真实测试请求（is_probe 模式）。 */
export interface ScheduledTestConfig {
  enabled: boolean;
  /** 测试频率单位：daily=每天；minutes=每 N 分钟；hours=每 N 小时 */
  frequency_unit: 'daily' | 'minutes' | 'hours';
  /** 频率数值：daily 时忽略；minutes/hours 时为正整数 */
  frequency_value: number;
  /** 检测账号白名单；空/缺省 = 该渠道全部账号 */
  accounts?: string[];
  /** 测试类型 key（来自全局「测试类型」配置）；缺省 chat */
  test_type?: string;
  /** 客户端类型：none/claude-code/codex-cli/codex-tui/codex-openai/opencode/workbuddy */
  client_type?: string;
  /** 测试协议：openai/anthropic/responses/gemini */
  protocol?: string;
  /** 检测结果范围：只检测可用账号、只检测不可用账号、或全部 */
  account_filter?: 'available' | 'unavailable' | 'all';
  /** 是否保留定时检测请求日志；缺省视为 true，关闭后定时检测（成功与失败）都不写请求日志 */
  retain_failed_logs?: boolean;
  /** 测试模型白名单；空/缺省时使用渠道默认模型 */
  test_models?: string[];
  /** 兼容旧配置的单模型字段 */
  test_model?: string;
}

/** 立即触发定时检测的响应：入队账号数 + 触发时间戳。 */
export interface ScheduledTestRunNowResponse {
  ok: boolean;
  /** 成功入队的账号任务数；0 表示当前无候选账号，-1 表示队列未就绪（由后端转成 ok=false） */
  enqueued: number;
  /** 本次触发时间戳（Unix 秒）；成功时回填到详情的 last_scheduled_test_at */
  triggered_at?: number | null;
  /** 人类可读的结果说明 */
  detail?: string;
}

/** 结构化冻结项；展示文案由各前端按需格式化。 */
/** 账号规范状态（后端 rate_limiter.AccountState 同源）。
 *  优先级：disabled > frozen > cooling > model_frozen > auth_failed > checking > available。
 *  frozen=永久冻结；cooling=临时冷却（有剩余秒数）；model_frozen=账号级未冻但部分模型在冻。
 *  具体是哪些模型见 freeze_items（scope=account_model）。 */
export type AccountState =
  | "disabled"
  | "frozen"
  | "cooling"
  | "model_frozen"
  | "auth_failed"
  | "checking"
  | "available";

export interface FreezeItem {
  scope: "account" | "account_model";
  model: string | null;
  reason: string;
  remaining: number | null;
  until: number | null;
  permanent: boolean;
}

/** 账号冷却状态 */
export interface ModelCooldown {
  model: string;
  remaining: number;
  until: number;
  reason: string;
}

/** 账号级冻结状态（来自 /accounts/status） */
export interface AccountCooldownStatus {
  remaining: number | null;
  until: number | null;
  reason: string;
  permanent?: boolean;
}

/** 账号冻结状态项 */
export interface ProviderAccountStatus {
  username: string;
  cooldown: boolean;
  is_frozen?: boolean;
  cooldown_scope: "none" | "account" | "model" | "mixed";
  cooldown_reason: string;
  cooldown_remaining: number;
  cooldown_until: number;
  account_cooldown: AccountCooldownStatus | null;
  model_cooldowns: ModelCooldown[];
  freeze_items?: FreezeItem[];
}

export interface ProviderAccountStatusResponse {
  ok: boolean;
  provider: string;
  accounts: ProviderAccountStatus[];
}

/** 账号可用性诊断项（按目标模型 / 模型组） */
export interface AccountAvailability {
  username: string;
  status: string;
  reason: string;
  retry_after: number;
  cooldown_scope: "none" | "account" | "model" | "mixed";
}

export interface ProviderAccountsAvailabilityResponse {
  ok: boolean;
  provider: string;
  model: string;
  is_group: boolean;
  member_models: string[];
  accounts: AccountAvailability[];
}

export interface ProviderAccountLite {
  username: string;
  switch: boolean;
  cooldown: boolean;
  /** 账号规范状态（lite 视图也带，供移动端/下拉直接展示） */
  state?: AccountState;
}

export interface ProviderAccountCopy {
  username: string;
  password?: string;
  api_key?: string;
  key?: string;
}

export interface ProviderAccount extends ProviderAccountPayload {
  username: string;
  switch: boolean;
  auth: boolean | null;
  auth_checked_at: number | null;
  auth_error: string | null;
  rpm_limit: number;
  tpm_limit: number;
  concurrent_limit: number;
  concurrent_used: number;
  rpm_used: number;
  rpm_available: number;
  tpm_used: number;
  tpm_available: number;
  rpd_limit: number;
  rpd_used: number;
  rpd_available: number;
  disabled: boolean;
  disable_reason: string | null;
  priority: number;
  weight: number;
  cooldown: boolean;
  /** 账号规范状态：状态展示/筛选的唯一判据（后端一次算好） */
  state: AccountState;
  /** 账号级是否处于冻结中（永久+临时都为 true）；判永久请用 state==='frozen' */
  is_frozen: boolean;
  cooldown_reason: string;
  cooldown_remaining: number;
  cooldown_until: number;
  cooldown_scope: "none" | "account" | "model" | "mixed";
  model_cooldowns: ModelCooldown[];
  freeze_items?: FreezeItem[];
  has_access_token?: boolean;
  token_expires_at?: number;
  has_cookies?: boolean;
  proxy_url?: string;
}

// ==================== API Keys /admin/config/api-keys ====================

export interface ApiKey {
  id: number;
  key: string;
  name: string;
  rate_limit: Record<string, unknown>;
  provider_whitelist: string[];
  provider_blacklist: string[];
  editor_provider_whitelist: string[];
  editor_provider_blacklist: string[];
  model_whitelist: string[];
  model_blacklist: string[];
  selection_strategy: string;
  thinking_config: Record<string, unknown>;
  disabled: boolean;
  created_at: number;
  /** 该系统 Key 授权给哪些 C 端分组使用（TeamGroup UUID）；空=全局可用 */
  group_ids?: string[];
  /** 编辑器子 Key 的父 Key */
  parent_id?: number | null;
  expires_at?: number | null;
  usage_limit?: Record<string, unknown>;
  version?: number;
  label?: string;
  scope?: string;
  editor_id?: string | null;
  editor_name?: string | null;
}

export interface ApiKeyConfig {
  enabled: boolean;
  keys: ApiKey[];
}

export interface ApiKeyUsageItem extends ApiKey {
  ledger_usage?: {
    requests?: number;
    total_tokens?: number;
    [key: string]: unknown;
  };
  usage: {
    rpm?: number;
    tpm?: number;
    rpm_used?: number;
    rpm_limit?: number;
    rpd_used?: number;
    rpd_limit?: number;
    rp5h_used?: number;
    rp5h_limit?: number;
    rpw_used?: number;
    rpw_limit?: number;
    tpm_used?: number;
    tpm_limit?: number;
    tpd_used?: number;
    tpd_limit?: number;
    tpw_used?: number;
    tpw_limit?: number;
    concurrent_used?: number;
    concurrent_limit?: number;
    [key: string]: unknown;
  };
}

// ==================== 请求日志 ====================

export interface RequestLogProxyInfo {
  mode: "direct" | "network" | "url_prefix" | "node" | string;
  proxy_config_id?: string;
  proxy_url?: string;
  url_prefix?: string;
  node_id?: string;
  target_host?: string;
}

export interface RequestLog {
  id: number;
  request_id: string;
  attempt_key: string;
  attempt_no: number;
  time: number;
  api_key_name: string;
  provider_name: string;
  // 后端按 provider_name 从渠道配置快照补的备注/显示名；渠道已删除时为空，
  // 前端回落显示 provider_name（即渠道 id）。请求日志页因此不再查渠道列表。
  provider_remark?: string;
  account_username: string;
  model: string;
  requested_model: string;
  actual_model: string;
  upstream_returned_model: string | null;
  endpoint: string;
  success: boolean;
  status: string;
  stream: boolean;
  duration_ms: number | null;
  first_token_ms: number | null;
  client_type: string | null;
  session_id: string | null;
  editor_id?: string | null;
  editor_session_id?: string | null;
  api_key_version?: number | null;
  upstream_status: string | null;
  /** 发请求前系统按模型 tokenizer 规则预测的输入 token（与渠道预占同一口径）。旧日志为 0。 */
  estimated_prompt_tokens?: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_tokens: number | null;
  cache_creation_tokens: number | null;
  has_error: boolean;
  error_preview: string;
  // 队列压力分级降级时，writer 会剥离大字段并置此标记，前端需提示"正文已省略"
  payload_truncated?: boolean;
  payload_truncation_reason?: string;
  route_duration_ms?: number;
  candidate_collect_ms?: number;
  strategy_select_ms?: number;
  account_reserve_ms?: number;
  routing_redis_degraded?: boolean;
  redis_timeout_stage?: string;
  routing_detail?: {
    model_group_check_ms?: number;
    strategy_config_ms?: number;
    candidate_group_members_ms?: number;
    candidate_metadata_ms?: number;
    provider_filter_ms?: number;
    candidate_tpm_check_ms?: number;
    candidate_operation_check_ms?: number;
    candidate_volume_factor_ms?: number;
    candidate_scan_ms?: number;
    outer_retry_index?: number;
    inner_retry_index?: number;
    inner_retry_limit?: number;
  };
  // 实际出站代理：由 ProxyManager 在真正发请求处写入，反映真实路由（非上层配置引用）
  proxy_info?: RequestLogProxyInfo;
}

export interface RequestLogDetail extends RequestLog {
  request_body: Record<string, unknown>;
  request_headers: Record<string, unknown>;
  router_request_body: Record<string, unknown>;
  router_request_headers: Record<string, unknown>;
  router_request_path: string | null;
  router_response_body: unknown;
  response_body: Record<string, unknown>;
  response_headers: Record<string, unknown>;
  attempts: RequestLogAttempt[];
  channel_retry_attempts?: ChannelRetryAttempt[];
  total_duration_ms?: number;
  actual_attempt_count?: number;
  security_events?: RequestLogSecurityEvent[];
  // 归档态：archived=true 表示该日志已归档，仅保留元数据，7 个大字段为空 {}
  archived?: boolean;
  source?: "live" | "archive";
}

export interface RequestLogSecurityEvent {
  id: number;
  request_id?: string;
  event_type?: string;
  severity?: string;
  tag?: string;
  detail?: Record<string, unknown>;
  api_key?: string;
  model?: string;
  source_ip?: string;
  event_time?: number;
}

export interface ChannelRetryAttempt {
  attempt_no: number;
  started_at: number;
  finished_at: number;
  duration_ms: number;
  status: "success" | "error" | string;
  upstream_status?: number | string | null;
  error?: string;
}

export interface RequestLogAttempt {
  id: number;
  request_id: string;
  attempt_key: string;
  attempt_no: number;
  time: number;
  provider_name: string;
  provider_remark?: string;
  account_username: string;
  model: string;
  actual_model: string | null;
  upstream_returned_model: string | null;
  endpoint: string;
  success: boolean;
  status: string;
  stream: boolean;
  duration_ms: number | null;
  first_token_ms: number | null;
  client_type: string | null;
  session_id: string | null;
  upstream_status: string | null;
  /** 发请求前系统按模型 tokenizer 规则预测的输入 token（与渠道预占同一口径）。旧日志为 0。 */
  estimated_prompt_tokens?: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_tokens: number | null;
  cache_creation_tokens: number | null;
  has_error: boolean;
  error_preview: string;
  channel_retry_attempts?: ChannelRetryAttempt[];
  request_body: Record<string, unknown>;
  router_request_body: Record<string, unknown>;
  router_request_path: string | null;
  router_response_body: unknown;
  response_body: Record<string, unknown>;
  router_request_headers: Record<string, unknown>;
  response_headers: Record<string, unknown>;
  // 该 attempt 是否来自归档表（无 body）；以及是否因队列压力被剥离正文
  source?: "live" | "archive";
  archived?: boolean;
  payload_truncated?: boolean;
  payload_truncation_reason?: string;
  route_duration_ms?: number;
  candidate_collect_ms?: number;
  strategy_select_ms?: number;
  account_reserve_ms?: number;
  routing_redis_degraded?: boolean;
  redis_timeout_stage?: string;
  routing_detail?: {
    model_group_check_ms?: number;
    strategy_config_ms?: number;
    candidate_group_members_ms?: number;
    candidate_metadata_ms?: number;
    provider_filter_ms?: number;
    candidate_tpm_check_ms?: number;
    candidate_operation_check_ms?: number;
    candidate_volume_factor_ms?: number;
    candidate_scan_ms?: number;
    outer_retry_index?: number;
    inner_retry_index?: number;
    inner_retry_limit?: number;
  };
  // 实际出站代理：由 ProxyManager 在真正发请求处写入，反映真实路由（非上层配置引用）
  proxy_info?: RequestLogProxyInfo;
}

export interface PaginatedRequestLogs {
  total: number;
  rows: RequestLog[];
}

// ==================== 最近日志 /admin/recent-logs ====================

export interface RecentLog extends Record<string, unknown> {
  time: number;
  api_key: string;
  api_key_name: string;
  model: string;
  endpoint: string;
  status: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
  error: string | null;
  client_type: string | null;
}

// ==================== 概览统计 /admin/stats ====================

export interface ProviderStatItem {
  name: string;
  total_accounts: number;
  auth_ok: number;
  cooldown: number;
}

export interface TokenStatsEntry {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  cache_creation_tokens: number;
  requests: number;
}

export interface DashboardRankingItem {
  name: string;
  requests: number;
  tokens: number;
  token_share?: number;
  request_share?: number;
  success_rate?: number;
  failure_rate?: number;
  avg_duration_ms?: number;
  cache_hit_rate?: number;
  cached_tokens?: number;
  prompt_tokens?: number;
  success_requests?: number;
}

export interface DashboardRankings {
  model_usage_top?: DashboardRankingItem[];
  provider_usage_top?: DashboardRankingItem[];
  model_requests_top?: DashboardRankingItem[];
  provider_requests_top?: DashboardRankingItem[];
  provider_success_rate_top?: DashboardRankingItem[];
  model_failure_rate_top?: DashboardRankingItem[];
  provider_failure_rate_top?: DashboardRankingItem[];
  model_speed_top?: DashboardRankingItem[];
  provider_speed_top?: DashboardRankingItem[];
  model_cache_hit_top?: DashboardRankingItem[];
  provider_cache_hit_top?: DashboardRankingItem[];
  // 账号维度占比榜：按 account_username 聚合，过滤空账号。
  // 传 provider 过滤时即该渠道下各账号占比；不传为全平台账号占比。
  account_usage_top?: DashboardRankingItem[];
  account_requests_top?: DashboardRankingItem[];
  // 自定义模型（客户端请求名/模型组别名）占用榜，次要指标，可选展示。
  custom_model_usage_top?: DashboardRankingItem[];
}

export interface DashboardStats {
  grain: string;
  summary?: {
    requests: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    cached_tokens: number;
    cache_creation_tokens: number;
    reasoning_tokens?: number;
    reasoning_requests?: number;
    reasoning_request_rate?: number;
    avg_duration_ms: number;
    error_count: number;
    retry_count: number;
    avg_prm: number;
    avg_tpm: number;
  };
  by_provider?: Array<{
    name: string;
    requests: number;
    tokens: number;
  }>;
  by_model?: Array<{
    name: string;
    requests: number;
    tokens: number;
  }>;
  rankings?: DashboardRankings;
  series?: Record<string, DashboardSeriesItem[]>;
}

export interface DashboardSeriesItem {
  bucket: number;
  name: string;
  value: number;
  problem?: string;
}

// ==================== 模型路由 ====================

export interface ModelRouteProvider extends Record<string, unknown> {
  name: string;
  remark: string;
  enabled: boolean;
  tags: string[];
  accounts: string[];
  models: string[];
}

export interface ModelGroupConfig extends Record<string, unknown> {
  name?: string;
  kind?: "custom" | "real";
  enabled?: boolean;
  remark?: string;
  models?: string[];
  aliases?: string[];
  provider_whitelist?: string[];
  provider_blacklist?: string[];
  selection_strategy?: string;
  backup_group?: string;
  backup_model_group?: string;
  response_model?: string;
  metadata_model?: string;
  metadata?: Record<string, unknown>;
  schemes?: Array<Record<string, unknown>>;
  active_scheme?: string;
  created_at?: number;
}

export interface ModelRoutingResponse {
  /** 专线已废弃；保留为可选以兼容旧响应或降级数据 */
  model_routes?: {
    routes: Array<Record<string, unknown>>;
  };
  model_groups: {
    groups: Record<string, ModelGroupConfig>;
  };
  providers: ModelRouteProvider[];
  models: Array<Record<string, unknown>>;
  api_keys?: Array<Record<string, unknown>>;
}

// ==================== 中转站（Relay） ====================

export interface RelaySite {
  id: number;
  name: string;
  base_url: string;
  framework: string;
  enabled?: boolean;
  username?: string;
  password?: string;
  access_token?: string;
  user_id?: string;
  session?: Record<string, unknown>;
  config?: Record<string, unknown>;
  last_checkin?: Record<string, unknown>;
  last_balance?: Record<string, unknown>;
  linked_provider_name?: string;
  created_at?: number;
  updated_at?: number;
  tasks?: RelayTask[];
  accounts?: RelaySiteAccount[];
  api_keys?: RelayApiKey[];
  bindings?: RelaySiteChannelBinding[];
  [key: string]: unknown;
}

export interface RelaySiteDetail extends RelaySite {
  accounts: RelaySiteAccount[];
  api_keys: RelayApiKey[];
  bindings: RelaySiteChannelBinding[];
  tasks: RelayTask[];
}

export interface RelayTask {
  id?: number;
  relay_site_id?: number;
  task_type?: string;
  enabled?: boolean;
  interval_minutes?: number;
  last_run_at?: number;
  last_result?: Record<string, unknown>;
  created_at?: number;
  updated_at?: number;
  [key: string]: unknown;
}

export interface RelaySiteAccount {
  id: number;
  relay_site_id?: number;
  access_token?: string;
  user_id?: string;
  balance?: Record<string, unknown>;
  checkin_status?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created_at?: number;
  updated_at?: number;
  [key: string]: unknown;
}

export interface RelayApiKey {
  id: number;
  relay_site_id?: number;
  account_id?: number;
  relay_token_id?: string;
  name?: string;
  api_key?: string;
  metadata?: Record<string, unknown>;
  created_at?: number;
  updated_at?: number;
  [key: string]: unknown;
}

export interface RelaySiteChannelBinding {
  id: number;
  relay_site_id?: number;
  api_key_id: number;
  provider_name: string;
  channel_base_url?: string;
  models_path?: string;
  remark?: string;
  metadata?: Record<string, unknown>;
  created_at?: number;
  updated_at?: number;
  [key: string]: unknown;
}

// ==================== 通知 ====================

export interface Notification {
  id: number;
  title?: string;
  message?: string;
  status?: string;
  severity?: string;
  kind?: string;
  created_at?: number;
  [key: string]: unknown;
}

export interface PaginatedNotifications {
  items: Notification[];
  total: number;
  page: number;
  page_size: number;
  unread_count: number;
}

// ==================== 模型元数据 ====================

export interface ModelMetadata {
  name?: string;
  owned_by?: string;
  object?: string;
  created?: number;
  max_tokens?: number;
  max_context_tokens?: number;
  input_modalities?: string[];
  output_modalities?: string[];
  multimodal?: string[];
  function_calling?: boolean;
  auto_search?: boolean;
  auto_thinking?: boolean;
  capabilities?: Record<string, unknown>;
  icon_url?: string;
}

// ==================== 账号每日用量 ====================

export interface AccountDailyUsageResponse {
  ok: boolean;
  usage: Array<Record<string, unknown>>;
  daily_remaining: number | null;
  daily_limit: number | null;
  model_daily_remaining: Record<string, number>;
  model_daily_quota: Record<string, { limit: number; remaining: number; used: number }>;
  provider_name: string | null;
}

// ==================== 公用操作响应 ====================

export interface OkResponse {
  ok: boolean;
}

/**
 * 创建渠道响应：后端 POST /admin/custom-providers 返回 { ok, name }
 * name 为服务端自动生成/去重后的渠道名，用于后续按名保存 limit policy 等二级资源。
 */
export interface CreateProviderResponse extends OkResponse {
  name: string;
}

// ==================== 安全模块 ====================

export interface SecurityConfig {
  enabled: boolean;
  block_on_high: boolean;
  masking_enabled: boolean;
  detectors: {
    credential_leak: boolean;
    prompt_injection: boolean;
    input_validation: boolean;
  };
  input_limits: {
    max_message_size_bytes: number;
    max_messages: number;
  };
}

export interface SecurityEvent {
  id: number;
  request_id?: string;
  event_time?: string;
  event_type?: string;
  severity?: string;
  tag?: string;
  detail?: Record<string, unknown>;
  api_key?: string;
  model?: string;
  source_ip?: string;
}

export interface SecurityEventsResponse {
  items: SecurityEvent[];
  total: number;
  page: number;
  page_size: number;
}

export interface SecurityStats {
  total: number;
  by_severity: Record<string, number>;
  by_tag: Record<string, number>;
  recent: SecurityEvent[];
  hours: number;
}

export interface SensitiveRule {
  id: string;
  label: string;
  pattern: string;
  ignorecase: boolean;
  severity: 'high' | 'warn' | 'info';
  detect_enabled: boolean;
  mask_enabled: boolean;
  fake: string;
  group: number | null;
  enabled: boolean;
  builtin: boolean;
}

export interface RuleTestFragment {
  match: string;
  start: number;
  end: number;
}

export interface RuleTestMatch {
  rule_id: string;
  label: string;
  severity: string;
  fragments: RuleTestFragment[];
}

export interface RuleTestResponse {
  ok?: boolean;
  matches: RuleTestMatch[];
}