# ai-lubricant-user-frontend

用户端门户前端（vendored chaitin/MonkeyCode 前端，AGPL-3.0，见 LICENSE/NOTICE）。
构建产物 `user-frontend/dist` 由主仓库 ai-lubricant 的 main.py 挂载服务
（/console 与 /manager 共用此 SPA）。

```bash
pnpm --dir user-frontend install
pnpm --dir user-frontend build
```
