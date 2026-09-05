import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/pages/manager/platform/Channels.tsx", import.meta.url),
  "utf8",
);
const typesSource = readFileSync(
  new URL("../src/@admin-port/types/admin.ts", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../src/@admin-port/api/providers.ts", import.meta.url),
  "utf8",
);

test("渠道基础配置支持展示标签并说明不影响路由", () => {
  assert.match(pageSource, /<label style=\{labelStyle\}>展示标签<\/label>/);
  assert.match(pageSource, /<ProviderTagInput/);
  assert.match(pageSource, /仅展示和筛选，不影响路由/);
  assert.match(pageSource, /输入标签，按 Enter 添加/);
  assert.match(pageSource, /function providerTagColor/);
});

test("渠道创建编辑和复制都携带标签", () => {
  assert.match(pageSource, /tags: normalizeProviderTags\(detail\.tags\)/);
  assert.match(pageSource, /const customPayload[\s\S]*?tags: normalizeProviderTags\(detail\.tags\)/);
  assert.match(pageSource, /remark: `\$\{detail\.remark \|\| '未命名渠道'\} \(副本\)`,[\s\S]*?tags: normalizeProviderTags\(detail\.tags\)/);
  assert.match(apiSource, /tags\?: string\[\]/);
  assert.ok((typesSource.match(/tags: string\[\]/g) ?? []).length >= 3);
});

test("渠道卡片显示标签且首页多选标签按任一匹配", () => {
  assert.match(pageSource, /normalizeProviderTags\(provider\.tags\)\.map/);
  assert.match(pageSource, /selectedTags\.some\(\(tag\) => providerTags\.includes\(tag\)\)/);
  assert.match(pageSource, /<ProviderTagFilter value=\{selectedTags\} options=\{availableTags\} onChange=\{setSelectedTags\} \/>/);
  assert.match(pageSource, /<CommandInput placeholder="搜索标签\.\.\." \/>/);
  assert.match(pageSource, /<Check className=\{cn\('size-4', checked \? 'opacity-100' : 'opacity-0'\)\} \/>/);
  assert.match(pageSource, /setSelectedTags\(\[\]\)/);
  assert.match(pageSource, /命中任一标签即显示/);
});
