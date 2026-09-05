import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import cn from "../src/i18n/resources/cn.ts"
import en from "../src/i18n/resources/en.ts"

const source = readFileSync(new URL("../src/components/console/project/auto-review-dialog.tsx", import.meta.url), "utf8")
const stripComments = (value: string) => value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")

test("review configuration uses webhook APIs and capability fields", () => {
  assert.match(source, /getProjectWebhook/)
  assert.match(source, /listProjectReviewNodes/)
  assert.match(source, /review_node_ids/)
  assert.match(source, /review_capabilities/)
  assert.match(source, /review_framework/)
  assert.match(source, /review_api_key_id/)
  assert.match(source, /review_model_limits/)
  assert.match(source, /review_max_concurrency/)
  assert.doesNotMatch(source, /v1UsersProjectsAutoReviewCreate/)
})

test("review configuration provides Chinese and English resources", () => {
  assert.equal(cn.projectOverview.review.title, "Review 配置")
  assert.equal(en.projectOverview.review.title, "Review configuration")
  assert.equal(cn.projectOverview.review.tool.ocr, "OpenCodeReview")
  assert.equal(en.projectOverview.review.tool.ocr, "OpenCodeReview")
  assert.equal(cn.projectOverview.review.nodePool, "Review 候选节点池")
  assert.equal(en.projectOverview.review.nodePool, "Review candidate node pool")
  assert.equal(cn.projectOverview.review.tool["editor:codex"], "Codex CLI")
  assert.equal(en.projectOverview.review.tool["editor:codex"], "Codex CLI")
})

test("review configuration JSX has no hardcoded Chinese", () => {
  assert.doesNotMatch(stripComments(source), /[㐀-鿿]/)
})
