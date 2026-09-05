import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { findReadmePath, selectReadmeRef } from "../src/pages/console/user/project/overview/readme-utils.ts"

const hookSource = readFileSync(
  new URL("../src/pages/console/user/project/overview/use-project-readme.ts", import.meta.url),
  "utf8",
)

test("README 分支优先选择 main、master，再按名称排序", () => {
  assert.equal(selectReadmeRef([{ name: "release" }, { name: "main" }, { name: "master" }]), "main")
  assert.equal(selectReadmeRef([{ name: "release" }, { name: "master" }]), "master")
  assert.equal(selectReadmeRef([{ name: "zeta" }, { name: "alpha" }]), "alpha")
  assert.equal(selectReadmeRef([{ name: "" }]), "")
  assert.equal(selectReadmeRef([]), "")
})

test("README 路径匹配忽略文件名大小写且只认 README.md", () => {
  assert.equal(findReadmePath([{ name: "src", path: "src" }, { name: "ReadMe.MD", path: "ReadMe.MD" }]), "ReadMe.MD")
  assert.equal(findReadmePath([{ name: "README.txt", path: "README.txt" }]), "")
  assert.equal(findReadmePath([{ name: "README.md" }]), "")
  assert.equal(findReadmePath([]), "")
})

test("README 只查仓库根目录并按 UTF-8 解码 base64 内容", () => {
  assert.match(hookSource, /recursive: false/)
  assert.match(hookSource, /b64decode\(/)
  // 项目/分支切换时的旧回调必须被丢弃，避免覆盖新项目的内容。
  assert.match(hookSource, /projectIdRef\.current !== requestedProjectId/)
  assert.match(hookSource, /readmeRefValueRef\.current !== requestedReadmeRef/)
})
