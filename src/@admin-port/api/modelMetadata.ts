import request from "./client";
import type { ThinkingGlobalConfig } from "../types/admin";

// ==================== 类型定义 ====================

/** 模型元数据条目（/admin/model-metadata -> models[]） */
export interface ModelMetadataEntry extends Record<string, unknown> {
  model_id?: string;
  id?: string;
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
  is_thinking?: boolean;
  capabilities?: Record<string, unknown>;
  icon_url?: string;
  /** real 行的渠道策略：渠道标签白名单（激活方案的投影） */
  provider_whitelist?: string[];
  /** real 行的渠道策略：渠道标签黑名单（激活方案的投影） */
  provider_blacklist?: string[];
  /** real 行的多套渠道策略方案；单方案/无配置时后端合成一套默认方案 */
  schemes?: RealModelScheme[];
  /** 激活方案的 id（不是 name） */
  active_scheme?: string;
}

/** 运行时模型条目（/admin/model-metadata -> runtime_models[]） */
export interface RuntimeModelEntry extends Record<string, unknown> {
  model_id: string;
  routes: Array<Record<string, unknown>>;
  providers: string[];
  has_metadata: boolean;
  available: boolean;
  metadata: ModelMetadataEntry | null;
  reason: string | null;
}

/** /admin/model-metadata 响应 */
export interface ModelMetadataResponse {
  default: Record<string, unknown>;
  models: ModelMetadataEntry[];
  runtime_models: RuntimeModelEntry[];
  summary: {
    runtime_model_count: number;
    route_count: number;
    metadata_model_count: number;
    missing_metadata_count: number;
  };
}

/** 创建/更新元数据时请求体 */
export interface UpdateModelMetadataBody {
  name?: string;
  owned_by?: string;
  object?: string;
  max_context_tokens?: number;
  max_tokens?: number;
  input_modalities?: string[];
  output_modalities?: string[];
  multimodal?: string[];
  function_calling?: boolean;
  auto_thinking?: boolean;
  is_thinking?: boolean;
  auto_search?: boolean;
  capabilities?: Record<string, unknown>;
  icon_url?: string;
}

/** 单条导入结果 */
export interface ImportSyncResult {
  model_id: string;
  ok: boolean;
  error?: string;
}

/** OpenRouter / models.dev 同步响应 */
export interface ImportSyncResponse {
  results: ImportSyncResult[];
}

export interface CatalogItem extends Record<string, unknown> {
  id: string;
  name?: string;
  context_length?: number | null;
  normalized?: Record<string, unknown>;
}

export interface ModelsDevCatalogItem extends CatalogItem {
  provider: string;
  family?: string;
  output_limit?: number | null;
}

export interface TokenizerRule {
  name: string;
  enabled: boolean;
  pattern: string;
  type: "chars" | "tiktoken" | "huggingface";
  /** chars：非 CJK 字符的字符/token 比。 */
  chars_per_token?: number;
  /** chars：CJK 字符单独计权（每字符约占 1 个 token，与拉丁文本差一个数量级）。 */
  cjk_chars_per_token?: number;
  /** tiktoken 编码器；huggingface 类型下作为词表缺失时的降级编码器。 */
  encoding?: string;
  /** huggingface 词表仓库，形如 zai-org/GLM-5.2。需先预热落盘。 */
  repo?: string;
  /** 计数结果乘的校准系数。闭源模型拿不到真词表，靠系数贴合上游真实口径。 */
  calibration?: number;
  /** 是否叠加 messages 每条固定结构开销。 */
  structural?: boolean;
}

export interface TokenizerRulesConfig {
  rules: TokenizerRule[];
}

export interface OwnedByListResponse {
  owned_by: string[];
}

/** 真实模型单套渠道策略方案（窄写结构，与后端 _normalize_schemes 同构） */
export interface RealModelScheme {
  id: string;
  name: string;
  /** 真实模型下恒为自身单元素数组；保留字段以与自定义方案同构，复用后端校验 */
  models: string[];
  provider_whitelist: string[];
  provider_blacklist: string[];
  /** 仅显式标记的非激活方案进降级链 */
  is_backup: boolean;
}

/** 真实模型渠道策略负载：单对模式（两列）或方案模式（多套方案+激活方案） */
export interface RealModelRoutingBody {
  provider_whitelist?: string[];
  provider_blacklist?: string[];
  schemes?: RealModelScheme[];
  active_scheme?: string;
}

export interface RealModelRoutingResponse {
  ok: boolean;
  model_id: string;
  provider_whitelist: string[];
  provider_blacklist: string[];
  schemes: RealModelScheme[];
  active_scheme: string;
}

// ==================== 模型元数据 API ====================

/**
 * 获取模型元数据（模型广场）
 * GET /admin/model-metadata
 */
export async function getModelMetadata(): Promise<ModelMetadataResponse> {
  const response = await request.get<ModelMetadataResponse>(
    "/admin/model-metadata",
  );
  return response.data;
}

/**
 * 创建或更新模型元数据
 * PUT /admin/model-metadata/{id}
 */
export async function updateModelMetadata(
  id: string,
  body: UpdateModelMetadataBody,
): Promise<ModelMetadataEntry> {
  const response = await request.put<ModelMetadataEntry>(
    `/admin/model-metadata/${encodeURIComponent(id)}`,
    body,
  );
  return response.data;
}

/**
 * 更新真实模型渠道策略（窄写：只改渠道过滤 / 方案，不触碰元数据）
 * PUT /admin/model-metadata/{id}/routing
 */
export async function updateRealModelRouting(
  id: string,
  body: RealModelRoutingBody,
): Promise<RealModelRoutingResponse> {
  const response = await request.put<RealModelRoutingResponse>(
    `/admin/model-metadata/${encodeURIComponent(id)}/routing`,
    body,
  );
  return response.data;
}

/**
 * 删除模型元数据
 * DELETE /admin/model-metadata/{id}
 */
export async function deleteModelMetadata(id: string): Promise<void> {
  await request.delete(`/admin/model-metadata/${encodeURIComponent(id)}`);
}

/**
 * 更新默认元数据
 * PUT /admin/model-metadata/default
 */
export async function updateDefaultMetadata(
  body: UpdateModelMetadataBody,
): Promise<ModelMetadataEntry> {
  const response = await request.put<ModelMetadataEntry>(
    "/admin/model-metadata/default",
    body,
  );
  return response.data;
}

/**
 * 拉取 OpenRouter 模型目录
 * GET /admin/model-metadata/openrouter/fetch
 */
export async function fetchOpenRouterCatalog(): Promise<{ items: CatalogItem[] }> {
  const response = await request.get<{ items: CatalogItem[] }>(
    "/admin/model-metadata/openrouter/fetch",
  );
  return response.data;
}

/**
 * 从 OpenRouter 同步元数据
 * POST /admin/model-metadata/openrouter/sync
 */
export async function syncOpenRouterMetadata(
  targets: { openrouter_id: string; model_id: string }[],
): Promise<ImportSyncResponse> {
  const response = await request.post<ImportSyncResponse>(
    "/admin/model-metadata/openrouter/sync",
    { targets },
  );
  return response.data;
}

/**
 * 拉取 models.dev 模型目录
 * GET /admin/model-metadata/modelsdev/fetch
 */
export async function fetchModelsDevCatalog(): Promise<{ items: ModelsDevCatalogItem[]; providers?: string[] }> {
  const response = await request.get<{ items: ModelsDevCatalogItem[]; providers?: string[] }>(
    "/admin/model-metadata/modelsdev/fetch",
  );
  return response.data;
}

/**
 * 从 models.dev 同步元数据
 * POST /admin/model-metadata/modelsdev/sync
 */
export async function syncModelsDevMetadata(
  targets: { provider: string; source_id: string; model_id: string }[],
): Promise<ImportSyncResponse> {
  const response = await request.post<ImportSyncResponse>(
    "/admin/model-metadata/modelsdev/sync",
    { targets },
  );
  return response.data;
}

/**
 * 拉取 llm-metadata 模型目录
 * GET /admin/model-metadata/llm-metadata/fetch
 */
export async function fetchLlmMetadataCatalog(): Promise<{ items: ModelsDevCatalogItem[]; providers?: string[] }> {
  const response = await request.get<{ items: ModelsDevCatalogItem[]; providers?: string[] }>(
    "/admin/model-metadata/llm-metadata/fetch",
  );
  return response.data;
}

/**
 * 从 llm-metadata 同步元数据
 * POST /admin/model-metadata/llm-metadata/sync
 */
export async function syncLlmMetadataMetadata(
  targets: { provider: string; source_id: string; model_id: string }[],
): Promise<ImportSyncResponse> {
  const response = await request.post<ImportSyncResponse>(
    "/admin/model-metadata/llm-metadata/sync",
    { targets },
  );
  return response.data;
}

export async function getTokenizerRulesConfig(): Promise<TokenizerRulesConfig> {
  const response = await request.get<TokenizerRulesConfig>(
    "/admin/config/main/tokenizer-rules",
  );
  return response.data;
}

export async function updateTokenizerRulesConfig(
  rules: TokenizerRule[],
): Promise<TokenizerRulesConfig> {
  const response = await request.put<TokenizerRulesConfig>(
    "/admin/config/main/tokenizer-rules",
    { rules },
  );
  return response.data;
}

export async function getThinkingGlobalConfig(): Promise<ThinkingGlobalConfig> {
  const response = await request.get<ThinkingGlobalConfig>(
    "/admin/config/thinking-global",
  );
  return response.data;
}

export async function updateThinkingGlobalConfig(body: {
  reasoning_owned_by: string[];
  thinking_global_enabled: boolean;
  simulated_client_defaults?: { reasoning_effort?: string; auto_search?: boolean };
}): Promise<{ ok: boolean }> {
  const response = await request.put<{ ok: boolean }>(
    "/admin/config/thinking-global",
    body,
  );
  return response.data;
}

export async function getOwnedByList(): Promise<OwnedByListResponse> {
  const response = await request.get<OwnedByListResponse>(
    "/admin/config/owned-by-list",
  );
  return response.data;
}
