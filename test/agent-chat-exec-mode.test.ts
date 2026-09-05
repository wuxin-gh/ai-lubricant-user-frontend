/**
 * Agent 会话页执行模式（interact / plan / goal）契约测试。
 *
 * 后端 SendMessageRequest 早就支持三种模式，之前 UI 没把开关接出来，
 * 这里用源码断言锁住「选择器存在 + 参数真的传给了 sendMessageStream」。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/pages/console/user/agent-chat.tsx", import.meta.url),
  "utf8",
);

const menuSource = readFileSync(
  new URL("../src/components/console/chat/agent-mode-menu.tsx", import.meta.url),
  "utf8",
);

test("Agent 会话页默认交互模式并渲染模式菜单", () => {
  assert.match(pageSource, /useState<AgentExecutionMode>\("interact"\)/);
  assert.match(pageSource, /<AgentModeMenu value=\{execMode\} onChange=\{setExecMode\} \/>/);
});

test("模式菜单三种模式都带中文+英文标签", () => {
  assert.match(menuSource, /value: "interact",\s*label: "普通 Interact"/);
  assert.match(menuSource, /value: "plan",\s*label: "规划 Plan"/);
  assert.match(menuSource, /value: "goal",\s*label: "目标 Goal"/);
});

test("模式菜单与思考等级菜单共用同一套触发器样式", () => {
  // 两个下拉必须长得一样：同高度、同圆角、同 hover/focus 处理。
  const effortSource = readFileSync(
    new URL("../src/components/console/chat/reasoning-effort.tsx", import.meta.url),
    "utf8",
  );
  const shared = [
    "h-7",
    "shrink-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
    "IconChevronDown className=\"size-3 shrink-0 opacity-60\"",
  ];
  for (const fragment of shared) {
    assert.ok(effortSource.includes(fragment), `reasoning-effort should contain: ${fragment}`);
    assert.ok(menuSource.includes(fragment), `agent-mode-menu should contain: ${fragment}`);
  }
});

test("Agent 会话页只在目标模式显示目标与预算输入", () => {
  assert.match(pageSource, /\{execMode === "goal" && \([\s\S]*?placeholder="目标（一句话）"/);
  assert.match(pageSource, /\{execMode === "goal" && \([\s\S]*?value=\{goalBudgetMinutes\}/);
});

test("Agent 会话页目标模式发送前要求填写目标", () => {
  assert.match(
    pageSource,
    /if \(execMode === "goal" && !goalObjective\.trim\(\)\) \{[\s\S]*?toast\.error\("目标模式请先填写目标"\)[\s\S]*?return/,
  );
});

test("Agent 会话页把模式与目标配置传给 sendMessageStream", () => {
  assert.match(pageSource, /budget_seconds: Math\.max\(60, Math\.round\(goalBudgetMinutes \* 60\)\)/);
  assert.match(
    pageSource,
    /sendMessageStream\(convId, content, undefined, undefined, reasoningEffort, execMode, goalConfig\)/,
  );
});

test("Agent 会话页新建或切换会话时把模式重置回交互", () => {
  // 模式是每条消息的入参、不随会话持久化，换会话必须回到默认值。
  const resets = pageSource.match(/setExecMode\("interact"\)/g) || [];
  assert.ok(resets.length >= 2, `expected at least 2 execMode resets, got ${resets.length}`);
});
