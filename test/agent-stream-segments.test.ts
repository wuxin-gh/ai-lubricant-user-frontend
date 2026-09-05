/**
 * agent-stream-events 的 segment 时序契约：AI 的正文与工具调用必须按事件到达顺序
 * 交织（说一句 → 做一步 → 说下一句），而不是工具堆上面、文字堆最下面。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { applyAssistantEvent } from "../src/components/console/agent/agent-stream-events.ts";
import type { AgentDisplayMessage } from "../src/components/console/agent/agent-message-list";

const empty = (): AgentDisplayMessage => ({
  id: "m1",
  role: "assistant",
  content: "",
  status: "streaming",
  toolCalls: [],
  subagents: [],
});

test("正文与工具调用按到达顺序交织成 segments", () => {
  let msg = empty();
  msg = applyAssistantEvent(msg, { type: "content", text: "我先看一下文件。" });
  msg = applyAssistantEvent(msg, { type: "tool_call", name: "list_files", args: {} });
  msg = applyAssistantEvent(msg, { type: "content", text: "然后再读第一个。" });
  msg = applyAssistantEvent(msg, { type: "tool_call", name: "file_read", args: {} });
  msg = applyAssistantEvent(msg, { type: "content", text: "读到了，总结如下。" });

  assert.deepEqual(
    msg.segments?.map((s) => (s.kind === "tool" ? s.index : s.kind)),
    ["text", 0, "text", 1, "text"],
  );
});

test("连续 content 事件合并进同一个 text 段，工具调用切断", () => {
  let msg = empty();
  msg = applyAssistantEvent(msg, { type: "content", text: "第一句" });
  msg = applyAssistantEvent(msg, { type: "content", text: "，继续" });
  msg = applyAssistantEvent(msg, { type: "tool_call", name: "search", args: {} });
  msg = applyAssistantEvent(msg, { type: "content", text: "工具后的话" });

  assert.equal(msg.segments?.length, 3);
  assert.deepEqual(msg.segments?.[0], { kind: "text", text: "第一句，继续" });
  assert.deepEqual(msg.segments?.[1], { kind: "tool", index: 0 });
  assert.deepEqual(msg.segments?.[2], { kind: "text", text: "工具后的话" });
});

test("tool_result 更新 toolCalls，segment 的 index 引用保持有效", () => {
  let msg = empty();
  msg = applyAssistantEvent(msg, { type: "tool_call", name: "search", args: {} });
  msg = applyAssistantEvent(msg, { type: "tool_result", name: "search", data: { hits: 3 } });
  msg = applyAssistantEvent(msg, { type: "tool_call", name: "file_read", args: {} });

  const toolSegment = msg.segments?.find((s) => s.kind === "tool");
  assert.ok(toolSegment && toolSegment.kind === "tool");
  const tool = msg.toolCalls[toolSegment.index];
  assert.equal(tool.name, "search");
  assert.equal(tool.status, "done");
  assert.deepEqual(tool.result, { hits: 3 });
});

test("历史消息没有 segments 时保持 undefined，走分组渲染", () => {
  const restored: AgentDisplayMessage = {
    ...empty(),
    status: "done",
    content: "历史正文",
    toolCalls: [{ name: "search", args: {}, status: "done" }],
  };
  assert.equal(restored.segments, undefined);
});
