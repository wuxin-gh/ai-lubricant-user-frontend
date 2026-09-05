import request from "./client";

// ==================== 类型定义 ====================

/**
 * 代理模式：
 * - network=传统网络代理（aiohttp proxy=）；
 * - url_prefix=URL 前缀转发（CF Workers 反代等）；
 * - direct=强制直连，显式表示此绑定不走任何代理（无需填 URL）；
 * - node=通过执行节点转发出站，请求从节点 IP 出网（需选一个节点，无 URL/认证）。
 */
export type ProxyMode = "network" | "url_prefix" | "direct" | "node";

/** 代理配置条目（/admin/config/proxies 返回数组） */
export interface ProxyEntry extends Record<string, unknown> {
  id: string;
  name: string;
  mode: ProxyMode;
  url: string;
  username: string;
  password: string;
  /** node 模式：转发出站的执行节点 id；其余模式为空/缺省。 */
  node_id?: string;
}

/** 新增/更新代理时的输入数据（新增可省略 id 让后端生成；编辑须回传既有 id 以稳定账号引用） */
export interface ProxyInput extends Record<string, unknown> {
  id?: string;
  name: string;
  mode: ProxyMode;
  url: string;
  username: string;
  password: string;
  /** node 模式必填：转发出站的执行节点 id。 */
  node_id?: string;
}

// ==================== 代理池 API ====================

/**
 * 获取代理池列表
 * GET /admin/config/proxies
 */
export async function getProxies(): Promise<ProxyEntry[]> {
  const response = await request.get<ProxyEntry[]>("/admin/config/proxies");
  return response.data;
}

/**
 * 全量更新代理池
 * PUT /admin/config/proxies
 * 后端无专用新增/删除端点，新增/删除需先读取列表再全量 PUT。
 */
export async function updateProxies(
  proxies: ProxyInput[],
): Promise<{ ok: boolean; count: number }> {
  const response = await request.put<{ ok: boolean; count: number }>(
    "/admin/config/proxies",
    proxies,
  );
  return response.data;
}

function toProxyInput(proxy: ProxyEntry): ProxyInput {
  // 保留既有 id：编辑代理（改 URL/模式）时若不回传 id，后端会按 name|mode|url 重算 id，
  // 使绑定该代理的账号 proxy_id 失效。全量 PUT 时未变更条目也须原样携带 id。
  return {
    id: proxy.id,
    name: proxy.name,
    mode: proxy.mode,
    url: proxy.url,
    username: proxy.username,
    password: proxy.password,
    // node 模式条目必须原样携带 node_id，否则全量 PUT 会把未变更节点代理的路由目标清空。
    ...(proxy.mode === "node" ? { node_id: proxy.node_id ?? "" } : {}),
  };
}

/** 添加代理（读取当前列表 → 追加 → 全量 PUT） */
export async function addProxy(data: ProxyInput): Promise<void> {
  const current = await getProxies();
  await updateProxies([...current.map(toProxyInput), data]);
}

/** 删除代理（读取当前列表 → 过滤 → 全量 PUT） */
export async function deleteProxy(id: string): Promise<void> {
  const current = await getProxies();
  await updateProxies(
    current.filter((proxy) => proxy.id !== id).map(toProxyInput),
  );
}
