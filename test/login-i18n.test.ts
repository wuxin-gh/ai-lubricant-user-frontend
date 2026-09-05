import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const loginSource = readFileSync(
  new URL("../src/pages/login.tsx", import.meta.url),
  "utf8",
);

test("登录页只保留账号密码登录与后端配置的登录方式", () => {
  assert.match(loginSource, /useTranslation/);
  assert.match(loginSource, /t\("login\.title"\)/);
  assert.match(loginSource, /t\("login\.choices\.oidc"\)/);
  assert.match(loginSource, /t\("login\.fields\.account"\)/);
  assert.match(loginSource, /t\("login\.toast\.missingCredentials"\)/);

  // 已删除的入口不应再出现在登录页源码里。
  assert.doesNotMatch(loginSource, /login\.choices\.baizhi/);
  assert.doesNotMatch(loginSource, /login\.choices\.signup/);
  assert.doesNotMatch(loginSource, /login\.actions\.forgotPassword/);
  assert.doesNotMatch(loginSource, /login\.choices\.github/);
  assert.doesNotMatch(loginSource, /login\.choices\.google/);
  assert.doesNotMatch(loginSource, /login\.agreement/);
  assert.doesNotMatch(loginSource, /userLoginHref|inviter_id/);
});

test("后端配置的登录方式在两种 edition 下都拉取", () => {
  assert.match(loginSource, /\/api\/v1\/users\/oidc\/default-team/);
  // 不应再有按 edition 跳过拉取的早返回。
  assert.doesNotMatch(loginSource, /IS_OFFLINE_EDITION|IS_ONLINE_EDITION/);
});

test("登录页翻译资源提供中英文文案", () => {
  assert.equal(cn.login.title, "Ai Lubricant 智能开发平台");
  assert.equal(en.login.title, "Ai Lubricant Platform");
  assert.equal(cn.login.choices.oidc, "企业登录");
  assert.equal(en.login.choices.oidc, "Enterprise Sign-in");
  assert.equal(cn.login.toast.captchaFailed, "验证码验证失败");
  assert.equal(en.login.toast.captchaFailed, "Captcha verification failed");
});
