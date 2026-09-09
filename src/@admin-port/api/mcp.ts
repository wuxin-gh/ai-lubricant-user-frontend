import request from "./client";

// ==================== 类型定义 ====================

export interface McpService {
  id: number;
  name: string;
  display_name: string;
  description: string;
  category: string;
  transport: string;
  command: string | null;
  args: string[];
  env_template: Record<string, string>;
  url: string | null;
  icon: string | null;
  version: string | null;
  author: string | null;
  docs_url: string | null;
  install_command?: string | null;
  source: string | null;
  market_id?: string | null;
  market_version?: string;
  template: boolean;
  builtin: boolean;
  enabled: boolean;
  kind?: string | null;
  expose?: string | null;
  active_version_id?: number | null;
  runtime_status?: string | null;
  runtime_last_error?: string | null;
  runtime_restarts?: number | null;
  runtime_last_ping?: string | null;
  tools_cache: McpTool[] | null;
  tools_cached_at: string | null;
  // ── 部署形态与安装编排（Phase 2）──
  // deploy_scope: 这个 MCP 的进程在哪里跑、谁能连它（由 transport 客观推导，不让用户选）
  deploy_scope?: "server" | "session" | "node_hosted";
  // install_state：安装进度，与 runtime_status（运行态）分开
  install_state?: string; // created|configuring|starting|testing|ready|error
  install_step?: string; // 当前步骤人话描述，前端直接显示
  install_error?: string;
  configured_at?: string | null;
  started_at?: string | null;
  tested_at?: string | null;
  ready_at?: string | null;
  // node_hosted 形态：托管该 stdio 的执行节点
  host_node_id?: string | null;
  host_port?: number | null;
  host_status?: string; // starting|running|dead
  created_at: string;
  updated_at: string;
}

export interface McpTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  service_name: string;
}

export interface McpEnvVar {
  id?: number;
  key: string;
  value: string;
  secret: boolean;
  description?: string;
  masked?: boolean;
  updated_at?: string | null;
}

export interface McpClientConfigUser {
  user_id: number;
  name: string;
}

export interface McpClientConfig {
  service_id: number;
  service_name: string;
  transport: string;
  sse_url: string;
  ws_session_url?: string;
  token_template?: string;
  auth_enabled?: boolean;
  users?: McpClientConfigUser[];
  runtime_status?: string | null;
  enabled?: boolean;
  configs: Record<string, unknown>;
}

export interface McpUser {
  id: number;
  name: string;
  /** 展示用 token（token_hint 脱敏值）；创建/轮换时返回明文，masked=false。 */
  token: string;
  enabled: boolean;
  chat_enabled: boolean;
  description: string;
  masked?: boolean;
  /** principal token 状态：active=可用，disabled=已禁用（启用/禁用走此字段）。 */
  token_status?: "active" | "disabled";
  /** 平台级=管理端建的（NULL）；用户id=用户侧建的。区分来源。 */
  owner_user_id?: string | null;
  /** 用途：agent/external/task。只影响入口与 token 展示，不参与鉴权。 */
  usage_type?: "agent" | "external" | "task";
  created_at?: string | null;
  updated_at?: string | null;
}

export interface McpUserParam {
  param_key: string;
  param_value: string;
  created_at?: string | null;
}

export interface McpUserAuthorizationResource {
  // 后端实际下发 "service" | "builtin_resource"（旧类型写 builtin_instance 是漂移）。
  resource_kind: "service" | "builtin_resource" | "builtin_instance";
  resource_id: number;
  resource_type: string;
  name: string;
  /** service 项：执行器 kind；stdio=true 时前端标灰禁用（管理端端点暂未下发）。 */
  kind?: string;
  stdio?: boolean;
  required_param?: string;
  children: Array<{ child_kind: string; child_id: number; name: string }>;
}

export interface McpServiceUsers {
  service_id: number;
  user_ids: number[];
  auth_enabled: boolean;
}

export interface McpMarketSettingsService {
  id: number;
  name: string;
  display_name: string;
  enabled: boolean;
  auth_enabled: boolean;
}

export interface McpMarketSettingsUser extends McpUser {
  service_ids: number[];
}

export interface McpMarketSettings {
  users: McpMarketSettingsUser[];
  services: McpMarketSettingsService[];
}

export interface McpRuntimeSettings {
  port: number;
  display_host: string;
  connection_base?: string;
}

export type McpSchemaValue = string | number | boolean | null;
export type McpResourceCapability = "list" | "read" | "create" | "update" | "delete" | "replace" | "filter" | "relate" | "runtime-apply" | string;

export interface McpObjectSchema {
  type: "object";
  properties: Record<string, McpResourceField>;
  required?: string[];
}

export interface McpRendererUi {
  renderer?: string;
  scrollY?: number;
  resources?: Record<string, string>;
}

export interface McpResourceDefinition {
  title: string;
  cardinality: "singleton" | "collection";
  binding: string;
  capabilities: McpResourceCapability[];
  schema: McpObjectSchema;
  relation?: { parentResource: string; parentId?: string; foreignKey?: string; display?: string };
  ui?: McpRendererUi & { idField?: string; displayField?: string; columns?: string[]; order?: string[] };
}

export interface McpResourceField {
  type: "string" | "integer" | "number" | "boolean" | "array";
  title?: string;
  description?: string;
  format?: string;
  default?: McpSchemaValue;
  enum?: McpSchemaValue[];
  items?: { type?: string };
  minimum?: number;
  maximum?: number;
  readOnly?: boolean;
  writeOnly?: boolean;
  "x-secret"?: boolean;
  "x-reference"?: string;
}

export interface McpViewDefinition {
  title: string;
  binding: string;
  capabilities?: McpResourceCapability[];
  refresh?: { manual?: boolean; interval_seconds?: number };
  ui?: McpRendererUi & { columns?: string[]; idField?: string };
}

export interface McpActionDefinition {
  title: string;
  binding?: string;
  resource?: string;
  operation?: string;
  inputSchema?: McpObjectSchema;
  ui?: McpRendererUi;
}

export interface McpReferenceOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export type McpReferenceOptions = Record<string, McpReferenceOption[]>;

export interface McpSecretState {
  state: "set" | "unset";
}

export interface McpResourceRecord extends Record<string, unknown> {
  revision?: number;
  _secrets?: Record<string, McpSecretState>;
}

export interface McpConfigurationContract {
  schema: 2;
  service_id: number;
  service_name: string;
  runtime_status?: string | null;
  revision?: number;
  reference_options?: McpReferenceOptions;
  resources: Record<string, McpResourceDefinition>;
  views: Record<string, McpViewDefinition>;
  actions: Record<string, McpActionDefinition>;
  panels: Record<string, McpManifestPanel>;
}

export interface McpApplyResult {
  ok?: boolean;
  status?: string;
  state?: "applied" | "pending" | "failed" | string;
  error?: string;
  message?: string;
}

export interface McpResponseMeta {
  revision?: number;
  capabilities?: McpResourceCapability[];
  count?: number;
  token_once?: boolean;
  apply?: McpApplyResult | null;
}

export interface McpResourceResponse<T = McpResourceRecord | McpResourceRecord[]> {
  data: T;
  meta: McpResponseMeta;
}

export interface McpRuntimeActionResult {
  ok: boolean;
  status?: string;
  state?: string;
  port?: number;
  display_host?: string;
  tools?: number;
  error?: string;
}

export interface CreateMcpPayload {
  name: string;
  display_name?: string;
  description?: string;
  category?: string;
  transport?: string;
  command?: string | null;
  args?: string[];
  env_template?: Record<string, string>;
  url?: string | null;
  version?: string;
  author?: string;
  docs_url?: string;
  install_command?: string;
  source?: string | null;
  template?: boolean;
  enabled?: boolean;
  market_id?: string;
  market_version?: string;
}

export type UpdateMcpPayload = Partial<Omit<CreateMcpPayload, "name">>;

// ==================== API ====================

export async function listMcpCatalog(): Promise<McpService[]> {
  const { data } = await request.get("/mcp/catalog");
  return Array.isArray(data) ? data : data?.services ?? [];
}

export async function listMcpServices(): Promise<McpService[]> {
  const { data } = await request.get("/mcp/services");
  return Array.isArray(data) ? data : data?.services ?? [];
}

export async function getMcpService(id: number): Promise<McpService> {
  const { data } = await request.get(`/mcp/services/${id}`);
  return data;
}

export async function createMcpService(payload: CreateMcpPayload): Promise<McpService> {
  const { data } = await request.post("/mcp/services", payload);
  return data;
}

// ── 安装编排（Phase 2）──
//
// 全局形态（remote）建完记录后服务端后台跑 configuring->starting->testing->ready，
// 前端轮询 install/status 显示步骤条；失败用 retry 从当前失败步推进。
// session 形态（stdio）无安装流程，create 时已 ready。

export interface McpInstallStatus {
  id: number;
  deploy_scope?: string;
  install_state?: string;
  install_step?: string;
  install_error?: string;
  configured_at?: string | null;
  started_at?: string | null;
  tested_at?: string | null;
  ready_at?: string | null;
  host_node_id?: string | null;
  host_port?: number | null;
  host_status?: string;
}

export async function getMcpInstallStatus(id: number): Promise<McpInstallStatus> {
  const { data } = await request.get(`/mcp/services/${id}/install/status`);
  return data;
}

export async function retryMcpInstall(id: number): Promise<McpInstallStatus> {
  const { data } = await request.post(`/mcp/services/${id}/install/retry`);
  return data;
}

/**
 * 形态 C：把 stdio MCP 部署到执行节点上常驻，并代理成全局可用的 remote。
 * 成功后该服务的 deploy_scope 变为 node_hosted，从「会话工具」区移入「全局服务」区。
 */
export async function deployMcpToNode(
  serviceId: number,
  nodeId: string,
): Promise<{ service_id: number; node_id: string; port: number; pid: number }> {
  const { data } = await request.post(`/mcp/services/${serviceId}/deploy-to-node`, {
    node_id: nodeId,
  });
  return data;
}

/** 杀掉节点上的托管进程，把服务打回会话形态。 */
export async function undeployMcpFromNode(serviceId: number): Promise<{ stopped: boolean }> {
  const { data } = await request.post(`/mcp/services/${serviceId}/undeploy-from-node`);
  return data;
}

export async function updateMcpService(id: number, payload: UpdateMcpPayload): Promise<McpService> {
  const { data } = await request.patch(`/mcp/services/${id}`, payload);
  return data;
}

export async function deleteMcpService(id: number): Promise<void> {
  await request.delete(`/mcp/services/${id}`);
}

export async function toggleMcpService(id: number): Promise<{ id: number; enabled: boolean }> {
  const { data } = await request.post(`/mcp/services/${id}/toggle`);
  return data;
}

export async function testMcpService(id: number): Promise<{ ok: boolean; message?: string; error?: string }> {
  const { data } = await request.post(`/mcp/services/${id}/test`);
  return data;
}

export async function getMcpServiceTools(id: number, refresh = false): Promise<McpTool[]> {
  const { data } = await request.get(`/mcp/services/${id}/tools`, { params: refresh ? { refresh: true } : undefined });
  return Array.isArray(data) ? data : [];
}

// ==================== Agent 侧可配置参数 schema ====================

export type McpConfigFieldType = "string" | "integer" | "number" | "boolean";

export interface McpConfigField {
  key: string;
  label: string;
  type: McpConfigFieldType;
  default: unknown;
  description: string;
  required: boolean;
  enum: unknown[] | null;
  secret: boolean;
  /** 字段来源：manifest / config_json */
  source: string;
}

export interface McpAgentConfigSchema {
  service_name: string;
  fields: McpConfigField[];
}

export async function getMcpAgentConfigSchema(id: number): Promise<McpAgentConfigSchema> {
  const { data } = await request.get(`/mcp/services/${id}/agent-config-schema`);
  return data;
}

export async function listMcpEnvVars(id: number): Promise<McpEnvVar[]> {
  const { data } = await request.get(`/mcp/services/${id}/env-vars`);
  return Array.isArray(data) ? data : [];
}

export async function saveMcpEnvVars(id: number, items: McpEnvVar[]): Promise<McpEnvVar[]> {
  const { data } = await request.put(`/mcp/services/${id}/env-vars`, { items });
  return Array.isArray(data) ? data : [];
}

export async function deleteMcpEnvVar(id: number, key: string): Promise<void> {
  await request.delete(`/mcp/services/${id}/env-vars/${encodeURIComponent(key)}`);
}

export async function startMcpService(id: number): Promise<McpRuntimeActionResult> {
  const { data } = await request.post(`/mcp/runtime/services/${id}/start`);
  return data;
}

export async function stopMcpService(id: number): Promise<McpRuntimeActionResult> {
  const { data } = await request.post(`/mcp/runtime/services/${id}/stop`);
  return data;
}

export async function getMcpClientConfig(id: number): Promise<McpClientConfig> {
  const { data } = await request.get(`/mcp/runtime/services/${id}/client-config`);
  return data;
}

// ==================== 内置工具全量 token（管理端） ====================
//
// 用户侧 /api/v1/users/builtin-tools 只显示 external；服务自动签发的 agent/node/user
// 只在管理端可见。这里只读列表 + 状态管理（禁用/删除），明文永不返回（只留 hint）。

export interface BuiltinToolInstanceOverview {
  id: number;
  tool_kind: "cdp" | "mail" | "device";
  owner_user_id: string;
  name: string;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
  details: Array<Record<string, unknown>>;
  tokens: BuiltinToolTokenRow[];
  token_summary: { total: number; active: number; disabled: number; external: number };
  cdp?: {
    clients_total: number;
    clients_enabled: number;
    clients_connected: number;
    active_pages: number;
    contexts: Array<Record<string, unknown>>;
  };
  mail?: {
    account_configured: boolean;
    account_enabled: boolean;
    mailbox_type?: string | null;
    addresses_total: number;
  };
}

export async function listBuiltinToolInstances(): Promise<BuiltinToolInstanceOverview[]> {
  const { data } = await request.get("/mcp/builtin-tools/instances");
  return Array.isArray(data?.instances) ? data.instances : [];
}

export interface BuiltinToolTokenRow {
  id: number;
  instance_id: number | null;
  service_id: number | null;
  target_type: "agent" | "node" | "user" | "external";
  target_id?: string | null;
  display_token: boolean;
  status: "active" | "disabled";
  token_hint?: string | null;
  expires_at?: string | null;
  created_at?: string;
  updated_at?: string;
  // join 出的名称/owner 快照（list_all_tokens 附带）。
  owner_user_id?: string | null;
  instance_name?: string | null;
  instance_tool_kind?: string | null;
  service_name?: string | null;
  service_display_name?: string | null;
}

export async function listBuiltinToolTokens(): Promise<BuiltinToolTokenRow[]> {
  const { data } = await request.get("/mcp/builtin-tools/tokens");
  return Array.isArray(data?.tokens) ? data.tokens : [];
}

export async function setBuiltinToolTokenStatus(
  tokenId: number,
  status: "active" | "disabled",
): Promise<BuiltinToolTokenRow> {
  // 复用用户侧端点不行（owner 隔离），管理端走 admin token 直接改库。
  const { data } = await request.put(`/mcp/builtin-tools/tokens/${tokenId}/status`, { status });
  return data;
}

export async function deleteBuiltinToolToken(tokenId: number): Promise<{ deleted: boolean }> {
  const { data } = await request.delete(`/mcp/builtin-tools/tokens/${tokenId}`);
  return data ?? { deleted: true };
}

// ==================== MCP 用户体系 + 服务鉴权 ====================

export async function getMcpServiceConfiguration(serviceId: number): Promise<McpConfigurationContract> {
  const { data } = await request.get(`/mcp/services/${serviceId}/configuration`);
  return data;
}

export interface McpResourceMutationOptions {
  parentId?: number;
  expectedRevision?: number;
}

function mutationParams(options?: McpResourceMutationOptions): Record<string, number> | undefined {
  const params: Record<string, number> = {};
  if (options?.parentId != null) params.parent_id = options.parentId;
  if (options?.expectedRevision != null) params.expected_revision = options.expectedRevision;
  return Object.keys(params).length ? params : undefined;
}

export async function listMcpResource(serviceId: number, resourceKey: string, parentId?: number): Promise<McpResourceResponse> {
  const { data } = await request.get(`/mcp/services/${serviceId}/resources/${resourceKey}`, { params: parentId == null ? undefined : { parent_id: parentId } });
  return data;
}

export async function replaceMcpResource(serviceId: number, resourceKey: string, items: Record<string, unknown>[], expectedRevision?: number): Promise<McpResourceResponse> {
  const { data } = await request.put(`/mcp/services/${serviceId}/resources/${resourceKey}`, { value: { items }, expected_revision: expectedRevision });
  return data;
}

export async function createMcpResource(serviceId: number, resourceKey: string, value: Record<string, unknown>, parentId?: number): Promise<McpResourceResponse> {
  const { data } = await request.post(`/mcp/services/${serviceId}/resources/${resourceKey}`, { value }, { params: parentId == null ? undefined : { parent_id: parentId } });
  return data;
}

export async function updateMcpResource(serviceId: number, resourceKey: string, itemId: string | number, value: Record<string, unknown>, options?: McpResourceMutationOptions): Promise<McpResourceResponse> {
  const { data } = await request.patch(
    `/mcp/services/${serviceId}/resources/${resourceKey}/${encodeURIComponent(String(itemId))}`,
    { value, expected_revision: options?.expectedRevision },
    { params: mutationParams(options) },
  );
  return data;
}

export async function deleteMcpResource(serviceId: number, resourceKey: string, itemId: string | number, options?: McpResourceMutationOptions): Promise<McpResourceResponse<{ ok: boolean }>> {
  const { data } = await request.delete(`/mcp/services/${serviceId}/resources/${resourceKey}/${encodeURIComponent(String(itemId))}`, { params: mutationParams(options) });
  return data;
}

export async function rotateMcpResourceToken(serviceId: number, resourceKey: string, itemId: string | number, expectedRevision?: number): Promise<McpResourceResponse> {
  const { data } = await request.post(
    `/mcp/services/${serviceId}/resources/${resourceKey}/${encodeURIComponent(String(itemId))}/rotate-token`,
    { expected_revision: expectedRevision },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" } },
  );
  return data;
}

export async function revokeMcpResourceToken(serviceId: number, resourceKey: string, itemId: string | number, expectedRevision?: number): Promise<McpResourceResponse> {
  const { data } = await request.post(`/mcp/services/${serviceId}/resources/${resourceKey}/${encodeURIComponent(String(itemId))}/revoke`, { expected_revision: expectedRevision });
  return data;
}

export async function queryMcpView(serviceId: number, viewKey: string, params?: Record<string, unknown>): Promise<McpResourceResponse<unknown>> {
  const { data } = await request.get(`/mcp/services/${serviceId}/views/${viewKey}`, { params });
  return data;
}

export async function executeMcpAction(serviceId: number, actionKey: string, value: Record<string, unknown>, timeout?: number): Promise<McpResourceResponse<unknown>> {
  const { data } = await request.post(
    `/mcp/services/${serviceId}/actions/${actionKey}`,
    { value },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" }, timeout },
  );
  return data;
}

export async function listMcpUsers(): Promise<McpUser[]> {
  const { data } = await request.get("/mcp/users");
  return Array.isArray(data) ? data : [];
}

export async function getAgentByMcpUser(principalId: number): Promise<{ agent_id: number | null }> {
  const { data } = await request.get(`/agent/agents/by-mcp-user/${principalId}`);
  return data;
}

export async function getMcpRuntimeSettings(): Promise<McpRuntimeSettings> {
  const { data } = await request.get("/mcp/runtime-settings");
  return data;
}

export async function updateMcpRuntimeSettings(payload: Pick<McpRuntimeSettings, "port" | "display_host">): Promise<McpRuntimeSettings> {
  const { data } = await request.put("/mcp/runtime-settings", payload);
  return data;
}

export async function getMcpMarketSettings(): Promise<McpMarketSettings> {
  const { data } = await request.get("/mcp/market-settings");
  return data;
}

export async function setMcpUserServices(userId: number, serviceIds: number[]): Promise<{ user_id: number; service_ids: number[] }> {
  const { data } = await request.put(`/mcp/market-settings/users/${userId}/services`, { service_ids: serviceIds });
  return data;
}

export async function createMcpUser(payload: {
  name: string;
  token?: string;
  enabled?: boolean;
  chat_enabled?: boolean;
  description?: string;
  /** 用途：agent|external；task 由任务内部建，管理端禁止。 */
  usage_type?: "agent" | "external";
}): Promise<McpUser> {
  const { data } = await request.post("/mcp/users", payload);
  return data;
}

export async function updateMcpUser(
  id: number,
  payload: { name?: string; token?: string; enabled?: boolean; chat_enabled?: boolean; description?: string },
): Promise<McpUser> {
  const { data } = await request.patch(`/mcp/users/${id}`, payload);
  return data;
}

export async function deleteMcpUser(id: number): Promise<void> {
  await request.delete(`/mcp/users/${id}`);
}

export async function rotateMcpUserToken(id: number): Promise<McpUser> {
  const { data } = await request.post(`/mcp/users/${id}/rotate-token`);
  return data;
}

/** 禁用/启用 principal token（不影响 enabled 这个业务开关）。 */
export async function setMcpUserTokenStatus(
  id: number,
  status: "active" | "disabled",
): Promise<McpUser> {
  const { data } = await request.put(`/mcp/users/${id}/token-status`, { status });
  return data;
}

/** 读取 principal 的操作参数。 */
export async function getMcpUserParams(id: number): Promise<McpUserParam[]> {
  const { data } = await request.get(`/mcp/users/${id}/params`);
  return Array.isArray(data?.params) ? data.params : [];
}

/** 全量替换 principal 的操作参数。 */
export async function setMcpUserParams(id: number, params: McpUserParam[]): Promise<McpUserParam[]> {
  const { data } = await request.put(`/mcp/users/${id}/params`, { params });
  return Array.isArray(data?.params) ? data.params : [];
}

export async function listMcpUserAuthorizationOptions(): Promise<McpUserAuthorizationResource[]> {
  const { data } = await request.get("/mcp/users/authorization-options");
  return Array.isArray(data?.resources) ? data.resources : [];
}

export async function getServiceUsers(id: number): Promise<McpServiceUsers> {
  const { data } = await request.get(`/mcp/services/${id}/users`);
  return data;
}

export async function setServiceUsers(id: number, userIds: number[]): Promise<McpServiceUsers> {
  const { data } = await request.put(`/mcp/services/${id}/users`, { user_ids: userIds });
  return data;
}

// 说明：服务级「关闭鉴权」已移除——所有 MCP 服务一律要求 token（后端
// PUT /mcp/services/{id}/auth 对 auth_enabled=false 一律 409），不再提供
// 该 API 的前端封装。

// ==================== Manifest / 附件 / 热重载 / 客户端快照 ====================

export interface McpManifestAsset {
  id: string;
  label: string;
  file_name: string;
  description?: string;
  kind: "file" | "directory_zip";
  source: string;
  mime?: string;
  download_url?: string;
}

export interface McpManifestHelpSection {
  heading: string;
  body: string;
}

export interface McpManifestHelp {
  title: string;
  sections: McpManifestHelpSection[];
}

export interface McpManifestPanelStorage {
  type: "api";
  list?: string;
  create?: string;
  update?: string;
  delete?: string;
  rotate_token?: string;
  get?: string;
  get_users?: string;
  save_users?: string;
  save_auth?: string;
  get_grants?: string;
  save_grants?: string;
}

export interface McpManifestPanel {
  kind: "config" | "tools" | "env" | "info" | "resource" | "view" | "action";
  read_only: boolean;
  resources?: string[];
  view?: string;
  action?: string;
  relations?: string[];
  storage?: McpManifestPanelStorage;
  reload_after_save?: boolean;
  copyable?: boolean;
  ui?: { renderer?: string; scrollY?: number };
  refresh?: { manual?: boolean; interval_seconds?: number };
}

export interface McpManifestAction {
  id: string;
  label: string;
  icon?: string;
  panel: string;
}

export interface McpBuiltinRules {
  default_installed?: boolean;
  removable?: boolean;
  editable_fields?: string[];
}

export interface McpServiceManifest {
  schema?: number;
  name: string;
  display_name?: string;
  description?: string;
  icon?: string | null;
  category?: string;
  builtin_rules?: McpBuiltinRules;
  agent_config?: { fields?: McpConfigField[] };
  assets?: McpManifestAsset[];
  help?: McpManifestHelp;
  home_actions?: McpManifestAction[];
  panels?: Record<string, McpManifestPanel>;
}

export interface McpServiceManifestEntry {
  service: McpService;
  manifest: McpServiceManifest;
}

export interface McpServiceAssets {
  service_name: string;
  assets: McpManifestAsset[];
}

export async function listMcpServiceManifests(): Promise<McpServiceManifestEntry[]> {
  const { data } = await request.get("/mcp/services/manifests");
  return Array.isArray(data) ? data : data?.manifests ?? [];
}

export async function listMcpServiceAssets(serviceName: string): Promise<McpServiceAssets> {
  const { data } = await request.get(`/mcp/services/${serviceName}/assets`);
  return data;
}

export function getMcpServiceAssetDownloadUrl(serviceName: string, assetId: string): string {
  return `/mcp/services/${serviceName}/assets/${encodeURIComponent(assetId)}/download`;
}

export async function reloadMcpService(id: number): Promise<McpRuntimeActionResult> {
  const { data } = await request.post(`/mcp/runtime/services/${id}/reload`);
  return data;
}

// ==================== SOP：内置服务 sop/*.md 在线编辑 ====================

export interface McpSopFile {
  name: string;
  content: string;
}

export interface McpServiceSop {
  service_name: string;
  files: McpSopFile[];
}

export async function getMcpServiceSop(serviceName: string): Promise<McpServiceSop> {
  const { data } = await request.get(`/mcp/services/${serviceName}/sop`);
  return data;
}

export async function saveMcpServiceSop(
  serviceName: string,
  files: McpSopFile[],
): Promise<{ service_name: string; updated: { name: string; bytes: number }[] }> {
  const { data } = await request.put(`/mcp/services/${serviceName}/sop`, { files });
  return data;
}
