import request from "./client";
import type {
  AccountDailyUsageResponse,
  BuiltinProviderInfo,
  ChannelCatalogResponse,
  ChatProtocolConfig,
  CreateProviderResponse,
  HeaderTemplate,
  ModelIdRewriteEntry,
  OkResponse,
  ProviderAccount,
  ProviderAccountCopy,
  ProviderAccountLite,
  ProviderAccountPayload,
  ProviderAccountStatusResponse,
  ProviderAccountsAvailabilityResponse,
  ProviderAccountAuthStartPayload,
  ProviderAccountAuthStartResponse,
  ProviderAccountAuthReplayResponse,
  ProviderAccountAuthStatusResponse,
  ProviderAccountSchema,
  ProviderAccountsActionResponse,
  ProviderAccountsTestResponse,
  ScheduledTestRunNowResponse,
  ProviderBaseConfig,
  ProviderLimitPolicy,
  ProviderLimitPolicyResponse,
  ProviderModelEntry,
  ProviderModelLite,
  ProviderLite,
  ProviderModelsResponse,
  ProviderModelsSaveResponse,
  ProviderSummary,
  ProviderUpstreamModelsResponse,
  DetectModelResponse,
  RateLimitConfig,
  HealthCheckConfig,
  ScheduledTestConfig,
} from "../types/admin";

// ==================== 渠道 API ====================

/**
 * 获取所有渠道列表
 * GET /admin/providers
 */
export async function getProviders(): Promise<ProviderSummary[]>;
export async function getProviders(options: { lite: true }): Promise<ProviderLite[]>;
export async function getProviders(options?: { lite?: boolean }): Promise<ProviderSummary[] | ProviderLite[]> {
  const response = await request.get<ProviderSummary[] | ProviderLite[]>(
    "/admin/providers",
    { params: options?.lite ? { lite: true } : undefined },
  );
  return response.data;
}

/**
 * 获取单个渠道基本信息
 * GET /admin/providers/{id}/base
 */
export async function getProviderDetail(
  id: string,
): Promise<ProviderBaseConfig> {
  const response = await request.get<ProviderBaseConfig>(
    `/admin/providers/${encodeURIComponent(id)}/base`,
  );
  return response.data;
}

/**
 * 获取渠道账号列表
 * GET /admin/providers/{id}/accounts
 */
export async function getProviderAccounts(
  id: string,
): Promise<ProviderAccount[]>;
export async function getProviderAccounts(
  id: string,
  options: { view: "lite" },
): Promise<ProviderAccountLite[]>;
export async function getProviderAccounts(
  id: string,
  options: { view: "copy" },
): Promise<ProviderAccountCopy[]>;
export async function getProviderAccounts(
  id: string,
  options?: { view?: "lite" | "copy" },
): Promise<ProviderAccount[] | ProviderAccountLite[] | ProviderAccountCopy[]> {
  const response = await request.get<ProviderAccount[] | ProviderAccountLite[] | ProviderAccountCopy[]>(
    `/admin/providers/${encodeURIComponent(id)}/accounts`,
    { params: options },
  );
  return response.data;
}

/**
 * 获取渠道账号冻结状态（账号级 + 账号-模型级）
 * GET /admin/providers/{id}/accounts/status
 */
export async function getProviderAccountStatus(
  id: string,
): Promise<ProviderAccountStatusResponse> {
  const response = await request.get<ProviderAccountStatusResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/status`,
  );
  return response.data;
}

/**
 * 按目标模型 / 模型组诊断渠道每个账号的可用性
 * GET /admin/providers/{id}/accounts/availability?model=<model_id_or_group>
 */
export async function getProviderAccountAvailability(
  id: string,
  model: string,
): Promise<ProviderAccountsAvailabilityResponse> {
  const response = await request.get<ProviderAccountsAvailabilityResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/availability`,
    { params: { model } },
  );
  return response.data;
}

/**
 * 获取渠道模型列表
 * GET /admin/providers/{id}/models
 */
export async function getProviderModels(
  id: string,
): Promise<ProviderModelEntry[]>;
export async function getProviderModels(
  id: string,
  options: { lite: true },
): Promise<ProviderModelLite[]>;
export async function getProviderModels(
  id: string,
  options?: { lite?: boolean },
): Promise<ProviderModelEntry[] | ProviderModelLite[]> {
  const response = await request.get<ProviderModelsResponse>(
    `/admin/providers/${encodeURIComponent(id)}/models`,
    { params: options?.lite ? { lite: true } : undefined },
  );
  return response.data.models;
}

/**
 * 整体保存渠道模型列表
 * PUT /admin/providers/{id}/models
 *
 * models 传 undefined 时 body 不含 models 字段，后端跳过模型表更新
 * （前端模型列表未加载完成时用此语义，避免空 state 误清库）。
 */
export async function replaceProviderModels(
  id: string,
  models: ProviderModelEntry[] | undefined,
): Promise<ProviderModelsSaveResponse> {
  const body = models === undefined ? {} : { models };
  const response = await request.put<ProviderModelsSaveResponse>(
    `/admin/providers/${encodeURIComponent(id)}/models`,
    body,
  );
  return response.data;
}

/**
 * 新增/更新单个模型
 * POST /admin/providers/{id}/models
 */
export async function upsertProviderModel(
  id: string,
  model: ProviderModelEntry,
): Promise<OkResponse> {
  const response = await request.post<OkResponse>(
    `/admin/providers/${encodeURIComponent(id)}/models`,
    model,
  );
  return response.data;
}

/**
 * 删除单个模型
 * DELETE /admin/providers/{id}/models/{upstreamModelId}
 */
export async function deleteProviderModel(
  id: string,
  upstreamModelId: string,
): Promise<OkResponse> {
  const response = await request.delete<OkResponse>(
    `/admin/providers/${encodeURIComponent(id)}/models/${encodeURIComponent(upstreamModelId)}`,
  );
  return response.data;
}

/**
 * 手动刷新渠道模型
 * POST /admin/providers/{id}/refresh-models
 */
export async function refreshProviderModels(
  id: string,
): Promise<ProviderUpstreamModelsResponse> {
  const response = await request.post<ProviderUpstreamModelsResponse>(
    `/admin/providers/${encodeURIComponent(id)}/refresh-models`,
  );
  return response.data;
}

/**
 * 拉取渠道上游模型
 * GET /admin/providers/{id}/upstream-models
 * 每行同时返回 model_id（改写后短名）与 raw_model_id（原始上游名），
 * 前端按开关在两者间切换显示，无需重新拉取上游。
 */
export async function getProviderUpstreamModels(
  id: string,
): Promise<ProviderUpstreamModelsResponse> {
  const response = await request.get<ProviderUpstreamModelsResponse>(
    `/admin/providers/${encodeURIComponent(id)}/upstream-models`,
  );
  return response.data;
}

/**
 * 获取渠道限流策略
 * GET /admin/providers/{id}/limit-policy
 */
export async function getProviderLimitPolicy(
  id: string,
): Promise<ProviderLimitPolicy> {
  const response = await request.get<ProviderLimitPolicy>(
    `/admin/providers/${encodeURIComponent(id)}/limit-policy`,
  );
  return response.data;
}

/**
 * 更新渠道限流策略
 * PUT /admin/providers/{id}/limit-policy
 */
export async function updateProviderLimitPolicy(
  id: string,
  payload: ProviderLimitPolicy,
): Promise<ProviderLimitPolicyResponse> {
  const response = await request.put<ProviderLimitPolicyResponse>(
    `/admin/providers/${encodeURIComponent(id)}/limit-policy`,
    payload,
  );
  return response.data;
}

/**
 * 获取渠道原始配置
 * GET /admin/config/providers/{id}
 */
export async function getProviderRawConfig(
  id: string,
): Promise<Record<string, unknown>> {
  const response = await request.get<Record<string, unknown>>(
    `/admin/config/providers/${encodeURIComponent(id)}`,
  );
  return response.data;
}

/**
 * 更新渠道基础配置
 * PUT /admin/providers/{id}/custom
 */
export async function updateProviderCustomConfig(
  id: string,
  payload: Record<string, unknown>,
): Promise<OkResponse> {
  const response = await request.put<OkResponse>(
    `/admin/providers/${encodeURIComponent(id)}/custom`,
    payload,
  );
  return response.data;
}

/**
 * 手动执行健康检查
 * POST /admin/providers/{id}/health-check
 */
export async function runProviderHealthCheck(
  id: string,
): Promise<ProviderAccountsTestResponse> {
  const response = await request.post<ProviderAccountsTestResponse>(
    `/admin/providers/${encodeURIComponent(id)}/health-check`,
  );
  return response.data;
}

export async function deleteProvider(id: string): Promise<OkResponse> {
  const response = await request.delete<OkResponse>(
    `/admin/providers/${encodeURIComponent(id)}`,
  );
  return response.data;
}

/**
 * 启用/禁用渠道
 * PUT /admin/providers/{id}/enabled?enabled=<bool>
 */
export async function updateProviderEnabled(
  id: string,
  enabled: boolean,
): Promise<OkResponse> {
  const response = await request.put<OkResponse>(
    `/admin/providers/${encodeURIComponent(id)}/enabled`,
    null,
    { params: { enabled } },
  );
  return response.data;
}

/**
 * 获取渠道账号表单 schema
 * GET /admin/providers/{id}/account-schema
 */
export async function getProviderAccountSchema(
  id: string,
): Promise<ProviderAccountSchema> {
  const response = await request.get<ProviderAccountSchema>(
    `/admin/providers/${encodeURIComponent(id)}/account-schema`,
  );
  return response.data;
}

/**
 * 启动账号网页登录/设备码授权
 * POST /admin/providers/{id}/accounts/auth/start
 */
export async function startProviderAccountAuth(
  id: string,
  payload: ProviderAccountAuthStartPayload,
): Promise<ProviderAccountAuthStartResponse> {
  const response = await request.post<ProviderAccountAuthStartResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/auth/start`,
    payload,
  );
  return response.data;
}

/**
 * 手工补投本机回调地址（跨机部署时浏览器回调打不到服务端，粘地址栏 URL 补投）
 * POST /admin/providers/{id}/accounts/auth/replay
 */
export async function replayProviderAccountAuth(
  id: string,
  callbackUrl: string,
): Promise<ProviderAccountAuthReplayResponse> {
  const response = await request.post<ProviderAccountAuthReplayResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/auth/replay`,
    { callback_url: callbackUrl },
  );
  return response.data;
}

/**
 * 查询账号授权状态（统一 callback 和 device-code 轮询）
 * GET /admin/providers/{id}/accounts/auth/status
 */
export async function getProviderAccountAuthStatus(
  id: string,
  state: string,
): Promise<ProviderAccountAuthStatusResponse> {
  const response = await request.get<ProviderAccountAuthStatusResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/auth/status`,
    { params: { state } },
  );
  return response.data;
}

/**
 * 取消进行中的账号授权
 * POST /admin/providers/{id}/accounts/auth/cancel
 */
export async function cancelProviderAccountAuth(
  id: string,
  state: string,
): Promise<OkResponse> {
  const response = await request.post<OkResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/auth/cancel`,
    null,
    { params: { state } },
  );
  return response.data;
}

/**
 * 刷新账号授权信息
 * POST /admin/providers/{id}/accounts/{username}/refresh-auth
 */
export async function refreshProviderAccountAuth(
  id: string,
  username: string,
): Promise<ProviderAccountsActionResponse> {
  const response = await request.post<ProviderAccountsActionResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/${encodeURIComponent(username)}/refresh-auth`,
  );
  return response.data;
}

/**
 * 添加渠道账号
 * PUT /admin/providers/{id}/accounts/add
 */
export async function addProviderAccount(
  id: string,
  payload: ProviderAccountPayload,
): Promise<ProviderAccountsActionResponse> {
  const response = await request.put<ProviderAccountsActionResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/add`,
    payload,
  );
  return response.data;
}

/**
 * 更新渠道账号
 * PUT /admin/providers/{id}/accounts/{username}
 */
export async function updateProviderAccount(
  id: string,
  username: string,
  payload: ProviderAccountPayload,
): Promise<OkResponse> {
  const response = await request.put<OkResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/${encodeURIComponent(username)}`,
    payload,
  );
  return response.data;
}

/**
 * 删除渠道账号
 * DELETE /admin/providers/{id}/accounts/{username}
 */
export async function deleteProviderAccount(
  id: string,
  username: string,
): Promise<OkResponse> {
  const response = await request.delete<OkResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/${encodeURIComponent(username)}`,
  );
  return response.data;
}

/**
 * 切换账号开关
 * PUT /admin/providers/{id}/accounts/{username}/switch
 */
export async function updateProviderAccountSwitch(
  id: string,
  username: string,
  enabled: boolean,
): Promise<OkResponse> {
  const response = await request.put<OkResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/${encodeURIComponent(username)}/switch`,
    null,
    { params: { switch: enabled } },
  );
  return response.data;
}

/**
 * 触发账号检查
 * POST /admin/providers/{id}/check-accounts
 */
export async function checkProviderAccounts(
  id: string,
): Promise<ProviderAccountsActionResponse> {
  const response = await request.post<ProviderAccountsActionResponse>(
    `/admin/providers/${encodeURIComponent(id)}/check-accounts`,
  );
  return response.data;
}

/**
 * 立即触发一次定时检测（异步入队，不阻塞）
 * POST /admin/providers/{id}/scheduled-test/run-now
 */
export async function triggerProviderScheduledTestNow(
  id: string,
  payload: {
    accounts?: string[];
    test_type?: string;
    client_type?: string;
    protocol?: string;
    test_models?: string[];
    test_model?: string;
    account_filter?: 'available' | 'unavailable' | 'all';
    retain_failed_logs?: boolean;
  },
): Promise<ScheduledTestRunNowResponse> {
  const response = await request.post<ScheduledTestRunNowResponse>(
    `/admin/providers/${encodeURIComponent(id)}/scheduled-test/run-now`,
    payload,
  );
  return response.data;
}

/**
 * 测试账号
 * POST /admin/providers/{id}/accounts/test
 */
export async function testProviderAccounts(
  id: string,
  payload: { username?: string; model?: string; test_type?: string; protocol?: string; client_type?: string },
): Promise<ProviderAccountsTestResponse> {
  const response = await request.post<ProviderAccountsTestResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/test`,
    payload,
  );
  return response.data;
}

/**
 * 初始化账号
 * POST /admin/providers/{id}/accounts/{username}/init
 */
export async function initProviderAccount(
  id: string,
  username: string,
): Promise<ProviderAccountsActionResponse> {
  const response = await request.post<ProviderAccountsActionResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/${encodeURIComponent(username)}/init`,
  );
  return response.data;
}

/**
 * 清除账号冷却
 * POST /admin/providers/{id}/accounts/{username}/clear-cooldown
 */
export async function clearProviderAccountCooldown(
  id: string,
  username: string,
): Promise<ProviderAccountsActionResponse> {
  const response = await request.post<ProviderAccountsActionResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/${encodeURIComponent(username)}/clear-cooldown`,
  );
  return response.data;
}

/**
 * 批量清除渠道下所有账号冻结（账号级 + 模型级冷却）
 * POST /admin/providers/{id}/accounts/clear-all-cooldowns
 */
export async function clearAllProviderCooldowns(
  id: string,
): Promise<{ ok: boolean; cleared: number }> {
  const response = await request.post<{ ok: boolean; cleared: number }>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/clear-all-cooldowns`,
  );
  return response.data;
}

/**
 * 批量开启/关闭账号开关
 * PUT /admin/providers/{id}/accounts/batch-switch
 */
export async function batchSetProviderAccountSwitch(
  id: string,
  payload: { switch: boolean; usernames?: string[] },
): Promise<{ ok: boolean; changed: number }> {
  const response = await request.put<{ ok: boolean; changed: number }>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/batch-switch`,
    payload,
  );
  return response.data;
}

export interface BatchAccountDeleteResult {
  username: string;
  ok: boolean;
  error?: string;
}

/**
 * 批量新增账号
 * POST /admin/providers/{id}/accounts/batch-add
 */
export async function batchAddProviderAccounts(
  id: string,
  payload: { accounts: ProviderAccountPayload[]; add_method?: string },
): Promise<{ ok: boolean; added: string[]; count: number }> {
  const response = await request.post<{ ok: boolean; added: string[]; count: number }>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/batch-add`,
    payload,
  );
  return response.data;
}

/**
 * 批量删除账号（逐项返回成功/失败）
 * POST /admin/providers/{id}/accounts/batch-delete
 */
export async function batchDeleteProviderAccounts(
  id: string,
  payload: { usernames: string[] },
): Promise<{
  ok: boolean;
  deleted: string[];
  failed: BatchAccountDeleteResult[];
  results: BatchAccountDeleteResult[];
  count: number;
}> {
  const response = await request.post<{
    ok: boolean;
    deleted: string[];
    failed: BatchAccountDeleteResult[];
    results: BatchAccountDeleteResult[];
    count: number;
  }>(`/admin/providers/${encodeURIComponent(id)}/accounts/batch-delete`, payload);
  return response.data;
}

/**
 * 批量修改账号代理（proxy 为空表示清除代理）
 * POST /admin/providers/{id}/accounts/batch-proxy
 */
export async function batchUpdateProviderAccountProxy(
  id: string,
  payload: { usernames: string[]; proxy: string | null },
): Promise<{ ok: boolean; updated: string[]; count: number }> {
  const response = await request.post<{ ok: boolean; updated: string[]; count: number }>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/batch-proxy`,
    payload,
  );
  return response.data;
}

/**
 * 获取账号每日用量
 * GET /admin/accounts/{username}/daily-usage
 */
export async function getAccountDailyUsage(
  username: string,
  providerId?: string,
): Promise<AccountDailyUsageResponse> {
  const response = await request.get<AccountDailyUsageResponse>(
    `/admin/accounts/${encodeURIComponent(username)}/daily-usage`,
    { params: providerId ? { provider_name: providerId } : undefined },
  );
  return response.data;
}

// ==================== 自定义渠道创建 API ====================

/**
 * 创建渠道（自定义或内置）
 * POST /admin/custom-providers
 */
export async function createCustomProvider(payload: {
  name?: string;
  remark?: string;
  tags?: string[];
  builtin_type?: string;
  enabled?: boolean;
  protocol?: string;
  base_url?: string;
  chat_path?: string;
  models_path?: string;
  image_path?: string;
  video_path?: string;
  speech_path?: string;
  timeout?: number;
  retry_count?: number | null;
  extra_retry_status_codes?: number[];
  rate_limit?: RateLimitConfig;
  billing_mode?: "token" | "request";
  client_preset?: string;
  auto_update_models?: boolean;
  model_id_rewrite_rules?: ModelIdRewriteEntry[];
  account_priority?: number;
  account_weight?: number;
  accounts?: Array<{ api_key?: string; password?: string; username?: string }>;
  chat_protocols?: ChatProtocolConfig[];
  models?: Array<string | ProviderModelEntry>;
  website_url?: string;
  icon?: string;
  // 复制/新增态携带：后端 _custom_provider_config_from_payload 已支持直接落库。
  supports_image_generation?: boolean;
  supports_video_generation?: boolean;
  supports_tts?: boolean;
  health_check?: HealthCheckConfig;
  scheduled_test?: ScheduledTestConfig;
  clear_conversation?: { enabled: boolean; max_age_hours: number };
  /** 代码渠道（builtin_type='code'）的 Provider Python 源码。 */
  code?: string;
}): Promise<CreateProviderResponse> {
  const response = await request.post<CreateProviderResponse>(
    "/admin/custom-providers",
    payload,
  );
  return response.data;
}

// ==================== Header 模板库（系统配置） ====================

/**
 * 获取 header 模板库
 * GET /admin/header-templates
 */
export async function getHeaderTemplates(): Promise<HeaderTemplate[]> {
  const response = await request.get<{ templates: HeaderTemplate[] }>(
    "/admin/header-templates",
  );
  return response.data.templates || [];
}

/**
 * 整体保存 header 模板库
 * PUT /admin/header-templates
 */
export async function saveHeaderTemplates(
  templates: HeaderTemplate[],
): Promise<HeaderTemplate[]> {
  const response = await request.put<{ templates: HeaderTemplate[] }>(
    "/admin/header-templates",
    { templates },
  );
  return response.data.templates || [];
}

/**
 * 快捷检测自定义渠道（粘贴文本自动解析 URL + API Key）
 * POST /admin/custom-providers/detect
 */
export async function detectCustomProvider(
  raw: string,
): Promise<Record<string, unknown>> {
  const response = await request.post<Record<string, unknown>>(
    "/admin/custom-providers/detect",
    { raw },
  );
  return response.data;
}

/**
 * 预览自定义渠道上游模型
 * POST /admin/custom-providers/upstream-models
 */
export async function previewCustomProviderModels(payload: {
  protocol?: string;
  base_url: string;
  api_key?: string;
  accounts?: Array<{ api_key?: string; password?: string; username?: string }>;
  chat_protocols?: ChatProtocolConfig[];
}): Promise<ProviderUpstreamModelsResponse> {
  const response = await request.post<ProviderUpstreamModelsResponse>(
    "/admin/custom-providers/upstream-models",
    payload,
  );
  return response.data;
}

/** 本地已预同步的统一渠道目录。添加渠道时不会访问 GitHub。 */
export async function getChannelCatalog(): Promise<ChannelCatalogResponse> {
  const response = await request.get<ChannelCatalogResponse>("/admin/channel-catalog");
  return response.data;
}

/** 要求服务端立即同步渠道目录，然后返回本地快照。 */
export async function refreshChannelCatalog(): Promise<ChannelCatalogResponse> {
  const response = await request.post<ChannelCatalogResponse>("/admin/channel-catalog/refresh");
  return response.data;
}

/**
 * 获取可用的内置渠道类型列表
 * GET /admin/builtin-providers
 */
export async function getBuiltinProviders(): Promise<BuiltinProviderInfo[]> {
  const response = await request.get<BuiltinProviderInfo[]>(
    "/admin/builtin-providers",
  );
  return response.data;
}

/**
 * 测试渠道模型能否真实处理指定大小的上下文窗口。
 * POST /admin/providers/{id}/accounts/detect-model
 *
 * window_tokens 是本次实际构造并发送的目标 token 数（字符近似），后端不会再按 metadata
 * 自动放大，也不会追加降级请求。fallback_size 仅保留给旧调用方兼容使用。
 */
export async function detectModel(
  id: string,
  payload: {
    upstream_model_id: string
    username?: string
    window_tokens?: number
    fallback_size?: string
  },
): Promise<DetectModelResponse> {
  const response = await request.post<DetectModelResponse>(
    `/admin/providers/${encodeURIComponent(id)}/accounts/detect-model`,
    payload,
  )
  return response.data
}
