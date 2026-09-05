import request from "./client";
import type { ModelRoutingResponse, ProviderSummary } from "../types/admin";
import { getProviders } from "./providers";

// ==================== 自定义模型 API ====================

export type ModelGroupPayload = Record<string, unknown>;

/**
 * 获取当前自定义模型配置
 * GET /admin/model-routing
 */
export async function getModelRouting(): Promise<ModelRoutingResponse> {
  const response = await request.get<ModelRoutingResponse>("/admin/model-routing");
  return response.data;
}

/**
 * 备用数据：当 /admin/model-routing 不可用时，从 /admin/providers 构造一个
 * 最小化的结构，用于展示 provider-model 映射。
 */
export async function getModelRoutingFromProviders(): Promise<ModelRoutingResponse> {
  const providers = await getProviders({ lite: true });

  const routeProviders = providers.map((provider) => ({
    name: provider.name,
    remark: provider.remark,
    enabled: provider.enabled,
    tags: provider.tags ?? [],
    accounts: [],
    models: provider.models,
  }));

  return {
    model_groups: { groups: {} },
    providers: routeProviders,
    models: [],
    api_keys: [],
  };
}

/**
 * 获取自定义模型配置，优先调用真实 endpoint；失败时降级到 providers 列表。
 */
export async function getModelRoutingWithFallback(): Promise<ModelRoutingResponse> {
  try {
    return await getModelRouting();
  } catch (error) {
    console.warn("[modelRouting] /admin/model-routing 调用失败，降级到 providers 列表", error);
    return getModelRoutingFromProviders();
  }
}

// ==================== 单项自定义模型 ====================

export async function createModelGroup(payload: ModelGroupPayload): Promise<void> {
  await request.post("/admin/model-groups", payload);
}

export async function updateModelGroup(name: string, payload: ModelGroupPayload): Promise<void> {
  await request.put(`/admin/model-groups/${encodeURIComponent(name)}`, payload);
}

export async function deleteModelGroup(name: string): Promise<void> {
  await request.delete(`/admin/model-groups/${encodeURIComponent(name)}`);
}

export type { ProviderSummary };
