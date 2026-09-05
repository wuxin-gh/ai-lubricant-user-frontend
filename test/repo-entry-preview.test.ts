import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const readSource = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

const previewSource = readSource("../src/components/console/project/repo-entry-preview.tsx");
const repoTreeSource = readSource("../src/components/console/project/repo-tree.tsx");
const filesSource = readSource("../src/components/console/project/files.tsx");
const markdownSource = readSource("../src/components/common/markdown.tsx");
const readmeSource = readSource("../src/pages/console/user/project/overview/project-readme.tsx");
const associationsSource = readSource("../src/pages/console/user/project/overview/associations-tab.tsx");
const endpointMapSource = readSource("../src/api/endpointMap.ts");
const cjkPattern = /[㐀-鿿]/;
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("预览弹框覆盖目录/图片/二进制/超大四种形态", () => {
  assert.match(previewSource, /'directory'/);
  assert.match(previewSource, /'image'/);
  assert.match(previewSource, /'binary'/);
  assert.match(previewSource, /'tooLarge'/);
  assert.match(previewSource, /'notFound'/);
  // 目录用共享 TreeNode 渲染，与「目录」页签同一套树。
  assert.match(previewSource, /<TreeNode/);
  // 图片走 raw 端点，文本走 JSON blob + AceEditor。
  assert.match(previewSource, /buildRawBlobUrl/);
  assert.match(previewSource, /v1UsersProjectsTreeBlobDetail/);
  assert.match(previewSource, /AceEditor/);
});

test("只给路径时先查目录树解析真实类型", () => {
  // README 链接只有 path，没有 mode/size：列父目录后按 path 精确匹配。
  assert.match(previewSource, /v1UsersProjectsTreeDetail/);
  assert.match(previewSource, /item\.path === requestedPath/);
  assert.match(previewSource, /parentPath/);
});

test("仓库树原语由 repo-tree 单一导出，files.tsx 不再自带副本", () => {
  for (const name of ["FileMode", "isDirectory", "sortEntries", "getFileIcon", "formatSize", "TreeNode"]) {
    assert.match(repoTreeSource, new RegExp(`export const ${name}|export const ${name} =`), `repo-tree 缺少 ${name}`);
  }
  assert.match(filesSource, /from "\.\/repo-tree"/);
  assert.match(filesSource, /RepoEntryPreviewDialog/);
  // 旧副本已移除：files.tsx 不再自行定义这些原语。
  assert.doesNotMatch(filesSource, /^const FileMode = \{/m);
  assert.doesNotMatch(filesSource, /^const sortEntries =/m);
});

test("markdown 相对链接不再限定 .md 才回调", () => {
  assert.match(markdownSource, /onRepositoryLink && !\/\^\(\?:\[a-z\]/);
  assert.doesNotMatch(markdownSource, /onRepositoryLink && \/\\\.\(\?:md\|markdown\)/);
  // 描述页按扩展名分流：.md 就地渲染，其余进预览弹框。
  assert.match(readmeSource, /\\\.\(\?:md\|markdown\)\$/);
  assert.match(readmeSource, /RepoEntryPreviewDialog/);
  assert.match(readmeSource, /projectOverview\.readme\.openFailed/);
});

test("子模块只读展示：endpointMap 条目 + 目录树 badge + 关联页派生区块", () => {
  assert.match(endpointMapSource, /v1UsersProjectsSubmodulesList/);
  assert.match(endpointMapSource, /\/api\/v1\/users\/projects\/\{0\}\/submodules/);
  assert.match(filesSource, /v1UsersProjectsSubmodulesList/);
  assert.match(repoTreeSource, /SubmoduleInfo/);
  assert.match(associationsSource, /v1UsersProjectsSubmodulesList/);
  assert.match(associationsSource, /SubmoduleSection/);
  // 派生列表是纯展示：不提供导入按钮、不写库。
  assert.doesNotMatch(associationsSource, /AssociationsCreate[\s\S]{0,200}submodule/i);
});

test("新增组件不硬编码中文", () => {
  assert.doesNotMatch(stripComments(previewSource), cjkPattern);
  assert.doesNotMatch(stripComments(repoTreeSource), cjkPattern);
  assert.doesNotMatch(stripComments(filesSource), cjkPattern);
  assert.doesNotMatch(stripComments(readmeSource), cjkPattern);
  assert.doesNotMatch(stripComments(associationsSource), cjkPattern);
});

test("预览与子模块文案提供中英文资源", () => {
  assert.equal(cn.consoleProject.files.previewNotFound, "路径不存在或已被移除");
  assert.equal(en.consoleProject.files.previewNotFound, "Path not found or removed");
  assert.ok(cn.consoleProject.files.previewBack.length > 0);
  assert.ok(en.consoleProject.files.previewBack.length > 0);
  assert.ok(cn.projectOverview.associations.derivedTitle.length > 0);
  assert.ok(en.projectOverview.associations.derivedTitle.length > 0);
  assert.ok(cn.projectOverview.associations.derivedHint.length > 0);
  assert.ok(en.projectOverview.associations.derivedHint.length > 0);
  assert.ok(cn.projectOverview.associations.manualTitle.length > 0);
  assert.ok(en.projectOverview.associations.manualTitle.length > 0);
  assert.ok(cn.projectOverview.associations.notLinkedProject.length > 0);
  assert.ok(en.projectOverview.associations.notLinkedProject.length > 0);
});
