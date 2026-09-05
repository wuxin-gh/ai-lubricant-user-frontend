import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const readSource = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

const sources = {
  index: readSource("../src/pages/console/user/project/overview/index.tsx"),
  info: readSource("../src/pages/console/user/project/overview/info-tab.tsx"),
  description: readSource("../src/pages/console/user/project/overview/description-tab.tsx"),
  readme: readSource("../src/pages/console/user/project/overview/project-readme.tsx"),
  issues: readSource("../src/pages/console/user/project/overview/issues-tab.tsx"),
  tasks: readSource("../src/pages/console/user/project/overview/tasks-tab.tsx"),
};
const combinedSource = Object.values(sources).join("\n");
// 只检查 JSX 文本与字符串字面量里的中文，注释里的中文说明允许保留。
const cjkPattern = /[㐀-鿿]/;
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("项目 overview 页面使用 projectOverview i18n key", () => {
  assert.match(combinedSource, /useTranslation/);
  assert.match(combinedSource, /t\("projectOverview\.tabs\.info"\)/);
  assert.match(combinedSource, /t\("projectOverview\.tabs\.description"\)/);
  assert.match(combinedSource, /t\("projectOverview\.tabs\.editors"\)/);
  assert.match(combinedSource, /t\("projectOverview\.issues\.create"\)/);
  assert.match(combinedSource, /t\("projectOverview\.tasks\.delete\.title"\)/);
  assert.match(combinedSource, /t\("projectOverview\.readme\.loading"\)/);
  assert.match(combinedSource, /t\("projectOverview\.readme\.noDocs"\)/);
});

test("overview 页签与 README 展示不硬编码中文", () => {
  for (const key of ["index", "info", "description", "readme", "tasks"] as const) {
    assert.doesNotMatch(stripComments(sources[key]), cjkPattern, `${key} 存在硬编码中文`);
  }
});

test("项目 overview 页面提供中英文资源", () => {
  assert.equal(cn.projectOverview.tabs.info, "信息");
  assert.equal(en.projectOverview.tabs.info, "Info");
  assert.equal(cn.projectOverview.tabs.description, "描述");
  assert.equal(en.projectOverview.tabs.description, "Description");
  assert.equal(cn.projectOverview.tabs.editors, "编辑器");
  assert.equal(en.projectOverview.tabs.editors, "Editors");
  assert.equal(cn.projectOverview.readme.loading, "正在加载...");
  assert.equal(en.projectOverview.readme.loading, "Loading...");
  assert.equal(cn.projectOverview.readme.noDocs, "暂无文档");
  assert.equal(en.projectOverview.readme.noDocs, "No documentation");
  assert.equal(cn.projectOverview.tasks.emptyTitle, "暂无任务");
  assert.equal(en.projectOverview.tasks.emptyTitle, "No tasks");
  assert.equal(cn.projectOverview.issues.create, "创建需求/bug");
  assert.equal(en.projectOverview.issues.create, "Create requirement / bug");
});
