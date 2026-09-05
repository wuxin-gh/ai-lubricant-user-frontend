import request from "./client";
import type {
  ApiKeyConfig,
  ApiKeyUsageItem,
  ApiKey,
  OkResponse,
} from "../types/admin";

// ==================== API Key 管理 API ====================

/**
 * 获取所有 API Key 列表
 * GET /admin/config/api-keys
 *
 * 列表已裁字段：只含 id/name/disabled/parent_id/expires_at/key 等展示列，
 * rate_limit / 各类 whitelist / thinking_config / usage_limit / group_ids 为空占位。
 * 编辑弹窗需要全字段时调 getApiKeyDetail(id)。
 */
export async function getApiKeys(): Promise<ApiKeyConfig> {
  const response = await request.get<ApiKeyConfig>("/admin/config/api-keys");
  return response.data;
}

/**
 * 获取单个 API Key 全字段详情（编辑弹窗按需拉取）
 * GET /admin/config/api-keys/{keyId}
 */
export async function getApiKeyDetail(keyId: number): Promise<ApiKey> {
  const response = await request.get<{ ok: boolean; key: ApiKey }>(
    `/admin/config/api-keys/${keyId}`,
  );
  return response.data.key;
}

/**
 * 获取 API Key 使用情况
 * GET /admin/config/api-keys/usage
 */
export async function getApiKeyUsage(): Promise<ApiKeyUsageItem[]> {
  const response = await request.get<ApiKeyUsageItem[]>(
    "/admin/config/api-keys/usage",
  );
  return response.data;
}

/**
 * 新增 API Key
 * PUT /admin/config/api-keys/add
 * Body: { name, rate_limit?, provider_whitelist?, provider_blacklist?, thinking_config? }
 */
export async function addApiKey(
  data: Record<string, unknown>,
): Promise<{ ok: boolean; key: ApiKey }> {
  const response = await request.put<{ ok: boolean; key: ApiKey }>(
    "/admin/config/api-keys/add",
    data,
  );
  return response.data;
}

/**
 * 更新 API Key
 * PUT /admin/config/api-keys/{keyId}
 * Body: { name?, rate_limit?, provider_whitelist?, provider_blacklist?, thinking_config? }
 */
export async function updateApiKey(
  keyId: number,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; key: ApiKey }> {
  const response = await request.put<{ ok: boolean; key: ApiKey }>(
    `/admin/config/api-keys/${keyId}`,
    data,
  );
  return response.data;
}

/**
 * 删除 API Key
 * DELETE /admin/config/api-keys/{keyId}
 */
export async function deleteApiKey(keyId: number): Promise<OkResponse> {
  const response = await request.delete<OkResponse>(
    `/admin/config/api-keys/${keyId}`,
  );
  return response.data;
}

/**
 * 切换 API Key 启用/停用状态
 * PUT /admin/config/api-keys/{keyId}/disable?disabled=<bool>
 */
export async function toggleApiKeyDisabled(
  keyId: number,
  disabled: boolean,
): Promise<OkResponse> {
  const response = await request.put<OkResponse>(
    `/admin/config/api-keys/${keyId}/disable`,
    {},
    { params: { disabled } },
  );
  return response.data;
}

/**
 * 切换全局 API Key 认证开关
 * PUT /admin/config/api-keys/enabled?enabled=<bool>
 */
export async function toggleApiKeysEnabled(
  enabled: boolean,
): Promise<OkResponse> {
  const response = await request.put<OkResponse>(
    '/admin/config/api-keys/enabled',
    null,
    { params: { enabled } },
  );
  return response.data;
}

/** 子 Key 创建入参：省略的字段继承父 Key，给出的字段必须落在父范围内（后端强制）。 */
export interface CopyApiKeyPayload {
  name?: string;
  /** 必须 ⊆ 父白名单；省略=继承父 */
  provider_whitelist?: string[];
  /** 必须 ⊇ 父黑名单（后端取并集）；省略=继承父 */
  provider_blacklist?: string[];
  /** 编辑器客户端白名单：claude / codex / opencode；必须 ⊆ 父白名单；省略=继承父 */
  editor_provider_whitelist?: string[];
  /** 编辑器客户端黑名单：claude / codex / opencode；必须 ⊇ 父黑名单；省略=继承父 */
  editor_provider_blacklist?: string[];
  model_whitelist?: string[];
  model_blacklist?: string[];
  selection_strategy?: string;
  /** 不受父子约束（Redis 按单 key 独立计数）；省略=继承父 */
  rate_limit?: Record<string, number>;
  /** max_requests / max_total_tokens 均不得超过父上限 */
  usage_limit?: { max_requests?: number; max_total_tokens?: number };
  /** epoch 秒；不得晚于父过期时间。父有过期时间时不可设为永不过期 */
  expires_at?: number | null;
}

/**
 * 按父子关系创建子 Key（副本）
 * PUT /admin/config/api-keys/{keyId}/copy
 * parent_id 指向根 Key，用量按 api_key_id OR api_key_parent_id 汇总回父。
 * 权限维度由后端强制收窄到父范围内，越权返回 400。
 */
export async function copyApiKey(
  keyId: number,
  data?: CopyApiKeyPayload,
): Promise<{ ok: boolean; key: ApiKey }> {
  const response = await request.put<{ ok: boolean; key: ApiKey }>(
    `/admin/config/api-keys/${keyId}/copy`,
    data ?? {},
  );
  return response.data;
}
