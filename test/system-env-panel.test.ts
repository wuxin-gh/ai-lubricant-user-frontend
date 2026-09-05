import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  panel: readSource("../src/components/console/environment/system-env-panel.tsx"),
  client: readSource("../src/api/systemEnvClient.ts"),
  nodes: readSource("../src/components/console/settings/nodes.tsx"),
};

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("系统环境面板区分「平台已装」与「本机自有」两类来源", () => {
  assert.match(sourceFiles.panel, /platform_managed \? "平台已装" : "本机自有"/);
  // 本机自有只能归档，不给卸载入口——删操作者的东西不是平台的权限。
  assert.match(sourceFiles.panel, /归档入库/);
  assert.match(sourceFiles.panel, /entry\.platform_managed \?/);
});

test("面板对 MCP 只展示不提供装卸（写操作者 MCP 配置会泄任务凭据）", () => {
  assert.match(sourceFiles.panel, /kind: "mcp", label: "MCP", installable: false/);
  assert.match(sourceFiles.panel, /section\.installable \?/);
});

test("安装弹框带「覆盖同名」显式选项，默认不覆盖", () => {
  assert.match(sourceFiles.panel, /useState\(false\)[\s\S]{0,200}?overwrite|const \[overwrite, setOverwrite\] = useState\(false\)/);
  assert.match(sourceFiles.panel, /覆盖同名资源/);
  assert.match(sourceFiles.panel, /本机已存在同名资源会跳过/);
});

test("节点未开启系统环境时给出开启指引而不是空面板", () => {
  assert.match(sourceFiles.panel, /system_env_enabled/);
  assert.match(sourceFiles.panel, /AGENT_COMPOSE_NODE_ALLOW_SYSTEM_ENV=on/);
});

test("客户端按 node 寻址（系统环境没有 env_id）", () => {
  assert.match(sourceFiles.client, /\/api\/v1\/teams\/nodes/);
  assert.match(sourceFiles.client, /system-env/);
  for (const fn of [
    "getSystemEnv",
    "refreshSystemEnv",
    "installSystemEnvResource",
    "archiveSystemEnvResource",
    "removeSystemEnvResource",
  ]) {
    assert.match(sourceFiles.client, new RegExp(`export async function ${fn}`));
  }
});

test("节点详情弹框把系统环境挂成独立 tab（与共用环境并列）", () => {
  assert.match(sourceFiles.nodes, /TabsTrigger value="system-env"/);
  assert.match(sourceFiles.nodes, /<SystemEnvPanel nodeId=\{node\.node_id\} \/>/);
  assert.match(sourceFiles.nodes, /TabsContent value="environments"/);
});

test("系统环境 tab 标题的 i18n key 已定义", () => {
  assert.equal(cn.consoleSettings.nodes.detail.systemEnv, "系统内置环境");
  assert.equal(en.consoleSettings.nodes.detail.systemEnv, "System environment");
});
