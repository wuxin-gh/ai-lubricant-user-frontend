import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  nodeTree: readSource("../src/components/console/editor/node-tree.tsx"),
  createDialog: readSource("../src/components/console/task/canonical-create-task-dialog.tsx"),
  nodeCaps: readSource("../src/pages/manager/platform/nodes/types.ts"),
};

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("NodeTree 支持 requireSystemEnv 过滤（未开启的节点禁用并标注原因）", () => {
  assert.match(sourceFiles.nodeTree, /requireSystemEnv\?: boolean/);
  assert.match(sourceFiles.nodeTree, /requireSystemEnv && !nodeSystemEnvAllowed\(node\)/);
  assert.match(sourceFiles.nodeTree, /未开启系统环境/);
  // 导出的能力位 helper，供创建弹框等消费方复用同一判定。
  assert.match(sourceFiles.nodeTree, /export function nodeSystemEnvAllowed/);
});

test("创建任务弹框不再把系统内置档位绑死在已选节点上", () => {
  // 第一步卡片：只有所有可见执行节点都不支持才禁用（anySystemEnvNode）。
  assert.match(sourceFiles.createDialog, /anySystemEnvNode/);
  assert.doesNotMatch(sourceFiles.createDialog, /tier\.value === "system" && !systemEnvAllowed\b/);
  // 自动回退只在已选节点且该节点不支持时触发，不再在未选节点时偷改档位。
  assert.match(sourceFiles.createDialog, /envMode === "system" && nodeId && !systemEnvAllowed/);
  // submit 兜底：选了不支持的节点要在提交前拦下来并提示。
  assert.match(
    sourceFiles.createDialog,
    /envMode === "system" && !systemEnvAllowed\) return toast\.error/,
  );
  // 第二步节点树传 requireSystemEnv。
  assert.match(sourceFiles.createDialog, /requireSystemEnv=\{envMode === "system"\}/);
  // 系统档说明要写清楚资源不会写入本机（需求 4 的同步现状提示）。
  assert.match(sourceFiles.createDialog, /技能\/MCP 不会写入本机配置/);
});

test("NodeCaps 显式声明 system_env 能力位", () => {
  assert.match(sourceFiles.nodeCaps, /system_env\?: string/);
});

test("节点详情环境 tab 的 i18n key 已定义", () => {
  assert.equal(cn.consoleSettings.nodes.detail.environments, "环境");
  assert.equal(en.consoleSettings.nodes.detail.environments, "Environments");
  assert.equal(cn.consoleSettings.nodes.detail.systemEnv, "系统内置环境");
  assert.equal(en.consoleSettings.nodes.detail.systemEnv, "System environment");
  assert.equal(cn.consoleSettings.nodes.detail.systemEnvEnabled, "已开启");
  assert.equal(en.consoleSettings.nodes.detail.systemEnvEnabled, "Enabled");
  assert.equal(cn.consoleSettings.nodes.detail.systemEnvDisabled, "未开启");
  assert.equal(en.consoleSettings.nodes.detail.systemEnvDisabled, "Disabled");
});
