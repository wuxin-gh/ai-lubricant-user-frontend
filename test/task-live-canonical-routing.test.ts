/**
 * 工具事件 canonical 协议在实时流客户端的契约测试。
 *
 * 协议字段由 runtime 一次性填齐（logical_event_id/event_kind/tool_name/
 * subagent_id/phase/status），上游逐层保真；前端只按协议字段路由，不允许
 * 再做任何猜测。这里用源码断言锁住三条不变量：
 *
 * 1. 子 Agent 路由只看 subagent_id（空=主对话，非空=子 Agent 详情），
 *    不做 name/title/文本猜测；
 * 2. 实时合并与回放共用 mergeItems——按 logical_event_id 合并原始 item
 *    之后再映射，稀疏完成帧不得抹掉开场帧的 title/input；
 * 3. 首个子 Agent 事件在主对话恰好插一张卡片占位
 *    （id=subagent-entry-${agentId}，与回放 reducer 一致）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clientSource = readFileSync(
  new URL("../src/components/console/editor/editor-session-stream-client.ts", import.meta.url),
  "utf8",
);

const itemToMessageSource = readFileSync(
  new URL("../src/components/console/task/item-to-message.ts", import.meta.url),
  "utf8",
);

const workspaceSource = readFileSync(
  new URL("../src/components/console/task/task-workspace-chat.tsx", import.meta.url),
  "utf8",
);

test("实时流按 canonical subagent_id 路由，根/子严格隔离", () => {
  // StreamEvent 接口声明 canonical 字段。
  assert.match(clientSource, /logical_event_id\?: string/);
  assert.match(clientSource, /subagent_id\?: string/);
  // 路由首选 subagent_id，agent_id 仅作同义旧字段兜底。
  assert.match(
    clientSource,
    /stringField\(payload as Record<string, unknown>, "subagent_id"\)/,
  );
  // 不存在按 Task 工具名/标题猜子 Agent 的代码。
  assert.doesNotMatch(clientSource, /toolName === "Task"/);
  assert.doesNotMatch(clientSource, /itemType === "Task"/);
});

test("根条目按 logical_event_id 合并后再映射，稀疏完成帧不抹 title/input", () => {
  // live 客户端复用与回放同一个 mergeItems。
  assert.match(clientSource, /import \{ itemToRootMessage, mergeItems, type NormalizedItem \}/);
  assert.match(clientSource, /const merged = previous \? mergeItems\(previous, normalized\) : normalized/);
  // mergeItems 导出共享（回放 reducer 与 live 客户端两处使用）。
  assert.match(itemToMessageSource, /export function mergeItems/);
  assert.match(itemToMessageSource, /const merged = previous \? mergeItems\(previous, item\) : item/);
  // 合并键先取 logical_event_id，item.id 兜底。
  assert.match(clientSource, /item\.logical_event_id \?\? payload\.logical_event_id \?\? item\.id/);
});

test("首个子 Agent 事件在主对话恰好插一张卡片占位（与回放同 id）", () => {
  // live 路径的占位 id 必须与 reduceItems 的 subagent-entry-${agentId} 一致。
  assert.match(itemToMessageSource, /`subagent-entry-\$\{agentId\}`/);
  assert.match(clientSource, /`subagent-entry-\$\{agentId\}`/);
  // 已见过的子 Agent 不再重复插占位（首见哨兵集合）。
  assert.match(clientSource, /subAgentEntryIds/);
  assert.match(clientSource, /const firstSighting = !this\.subAgentEntryIds\.has\(agentId\)/);
});

test("子 Agent 工具卡名字优先取 canonical tool_name", () => {
  assert.match(
    clientSource,
    /stringField\(payload as Record<string, unknown>, "tool_name"\) \|\| toolTitle\(itemType, item\)/,
  );
});

test("回放路由只读 subagent_id（历史端点负责旧数据回填）", () => {
  // rowToItem 不再读 agent_id —— 兜底在 task_service._backfill_canonical_envelope。
  const rowToItem = workspaceSource.match(
    /function rowToItem[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(rowToItem, "rowToItem 函数存在");
  assert.match(rowToItem, /root\.subagent_id/);
  assert.doesNotMatch(rowToItem, /root\.agent_id/);
});
