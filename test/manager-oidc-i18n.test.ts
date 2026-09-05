import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/pages/console/manager/oidc.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[㐀-鿿]/;

test("login-methods page uses loginMethods i18n keys", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("loginMethods\.title"\)/);
  assert.match(source, /t\("loginMethods\.add"\)/);
  assert.match(source, /t\("managerOidc\.toast\.saved"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("login-methods page provides Chinese and English resources", () => {
  assert.equal(cn.loginMethods.title, "登录方式");
  assert.equal(en.loginMethods.title, "Login methods");
  assert.equal(cn.loginMethods.add, "新增登录方式");
  assert.equal(en.loginMethods.add, "Add login method");
  assert.equal(cn.managerOidc.toast.saved, "企业登录配置已保存");
  assert.equal(en.managerOidc.toast.saved, "Enterprise sign-in configuration saved");
});
