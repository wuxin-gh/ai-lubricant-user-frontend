import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const filesSource = readSource("../src/components/console/project/files.tsx");
// 预览弹框与树原语已抽到 repo-entry-preview / repo-tree，行为断言按合并后的源码检查。
const previewSource = readSource("../src/components/console/project/repo-entry-preview.tsx");
const repoTreeSource = readSource("../src/components/console/project/repo-tree.tsx");
const combinedSource = [filesSource, previewSource, repoTreeSource].join("\n");
const cjkPattern = /[㐀-鿿]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("项目文件树组件使用 consoleProject i18n key", () => {
  assert.match(filesSource, /useTranslation/);

  assert.match(filesSource, /t\("consoleProject\.files\.title"\)/);
  assert.match(filesSource, /t\("consoleProject\.files\.empty"\)/);
  assert.match(filesSource, /t\("consoleProject\.files\.tooLarge"/);
  assert.match(combinedSource, /t\("consoleProject\.files\.tooLargeNoPreview"\)/);
  assert.match(combinedSource, /t\("consoleProject\.files\.binaryUnsupported"\)/);
  assert.match(combinedSource, /t\("consoleProject\.files\.imageLoadFailed"\)/);
  assert.doesNotMatch(filesSource, cjkPattern);
});

test("项目文件树组件提供中英文资源", () => {
  assert.equal(cn.consoleProject.files.title, "项目文件");
  assert.equal(en.consoleProject.files.title, "Project files");
  assert.ok(cn.consoleProject.files.tooLarge.length > 0);
  assert.ok(en.consoleProject.files.tooLarge.length > 0);
  assert.ok(cn.consoleProject.files.tooLargeNoPreview.length > 0);
  assert.ok(en.consoleProject.files.tooLargeNoPreview.length > 0);
  assert.ok(cn.consoleProject.files.binaryUnsupported.length > 0);
  assert.ok(en.consoleProject.files.binaryUnsupported.length > 0);
  assert.ok(cn.consoleProject.files.imageLoadFailed.length > 0);
  assert.ok(en.consoleProject.files.imageLoadFailed.length > 0);
});

test("文件预览按图片/二进制/超大降级且走 raw 图片端点", () => {
  // 图片走 raw blob 端点（浏览器直接解码），文本仍走 JSON blob。
  assert.match(repoTreeSource, /tree\/blob\/raw/);
  assert.match(combinedSource, /isPreviewableImageExtension/);
  assert.match(combinedSource, /MAX_IMAGE_PREVIEW_SIZE/);
  assert.match(combinedSource, /MAX_TEXT_PREVIEW_SIZE/);
  // 超阈值只告警不弹框。
  assert.match(filesSource, /toast\.warning/);
  // 二进制不再塞 AceEditor。
  assert.match(previewSource, /kind === 'binary' \|\| kind === 'tooLarge'/);
});
