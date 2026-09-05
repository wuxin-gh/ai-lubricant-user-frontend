import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

import { clearSingleFlight } from "../src/utils/request-single-flight.ts";

/**
 * 管理端 Axios 单例的 GET 在途合并行为测试。
 *
 * client.ts 导入时就读 localStorage（浏览器全局），Node 下不能直接 import
 * 整个模块；这里复刻 client.ts 中 attachInflightGetAdapter 的实现并跑真
 * 实 HTTP，验证：并发相同 GET 只打一次后端、完成后重发、POST 不合并、
 * 不同 params 不合并。实现如有改动请同步这里（模式与 client.ts 一致）。
 */
import { getSingleFlightKey, singleFlightGet } from "../src/utils/request-single-flight.ts";

function makeApp() {
  const app = axios.create({ baseURL: "" });
  const adapter = axios.getAdapter(app.defaults.adapter);
  app.defaults.adapter = async (config) => {
    const method = (config.method || "get").toLowerCase();
    const hasOwnSignal = Boolean(config.signal);
    if (method !== "get" || hasOwnSignal || config.url == null) {
      return adapter(config);
    }
    const params = config.params ?? {};
    const key = getSingleFlightKey("GET", `${config.baseURL || ""}${config.url}`, params);
    return singleFlightGet(key, () => adapter(config));
  };
  return app;
}

async function withBackend(handler: (req: unknown, res: unknown, hits: { n: number }) => Promise<void> | void) {
  const http = await import("node:http");
  const hits = { n: 0 };
  const server = http.createServer((req, res) => {
    hits.n += 1;
    void handler(req, res, hits);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as { port: number }).port, hits };
}

test("并发相同 GET 只打一次后端，完成后重新发出", async () => {
  clearSingleFlight();
  const { server, port, hits } = await withBackend((_req, res, h) => {
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, n: h.n }));
    }, 20);
  });
  const app = makeApp();
  const url = `http://127.0.0.1:${port}/api/v1/admin/nodes`;

  try {
    const [r1, r2, r3] = await Promise.all([app.get(url), app.get(url), app.get(url)]);
    assert.equal(hits.n, 1, "三个并发相同 GET 只应打一次后端");
    assert.deepEqual(r1.data, r2.data);
    assert.deepEqual(r2.data, r3.data);

    const r4 = await app.get(url);
    assert.equal(hits.n, 2, "上一轮完成后同 URL 重新发出");
    assert.equal(r4.data.n, 2);
  } finally {
    server.close();
  }
});

test("不同 params 的 GET 不合并", async () => {
  clearSingleFlight();
  const { server, port, hits } = await withBackend((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  const app = makeApp();
  const url = `http://127.0.0.1:${port}/api/v1/admin/nodes`;

  try {
    await Promise.all([
      app.get(url, { params: { status: "pending" } }),
      app.get(url, { params: { status: "approved" } }),
    ]);
    assert.equal(hits.n, 2, "参数不同就是两个请求");
  } finally {
    server.close();
  }
});

test("POST 不参与合并", async () => {
  clearSingleFlight();
  const { server, port, hits } = await withBackend((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  const app = makeApp();
  const url = `http://127.0.0.1:${port}/api/v1/admin/nodes/onboard`;

  try {
    await Promise.all([app.post(url, { a: 1 }), app.post(url, { a: 1 })]);
    assert.equal(hits.n, 2, "写请求必须各发各的，不能被去重层合并");
  } finally {
    server.close();
  }
});

test("带取消信号的 GET 不合并", async () => {
  clearSingleFlight();
  const { server, port, hits } = await withBackend((_req, res) => {
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    }, 20);
  });
  const app = makeApp();
  const url = `http://127.0.0.1:${port}/api/v1/admin/nodes`;
  const controller = new AbortController();

  try {
    const [r1, r2] = await Promise.all([
      app.get(url),
      app.get(url, { signal: controller.signal }),
    ]);
    assert.equal(hits.n, 2, "带独立 signal 的 GET 走独立请求");
    assert.equal(r1.data.ok, true);
    assert.equal(r2.data.ok, true);
  } finally {
    controller.abort();
    server.close();
  }
});
