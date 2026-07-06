import { loadDotEnv } from "./env.js";
loadDotEnv();

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";
import { startBackgroundRefresh } from "./aggregate.js";

const PORT = Number(process.env.PORT ?? 8080);

const app = express();
app.use(express.json({ limit: "1mb" }));

// 헬스체크 (로드밸런서/심사용)
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "farm-subsidy-mcp", time: new Date().toISOString() });
});

// Stateless Streamable HTTP: 요청마다 서버/트랜스포트 인스턴스 생성
app.post("/mcp", async (req, res) => {
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless 모드
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// stateless 모드에서는 GET/DELETE 세션 요청 미지원
const methodNotAllowed = (_req: express.Request, res: express.Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

// 기동 시 1회 수집 + 10분 주기 백그라운드 갱신 (tool 응답은 항상 캐시에서 즉시)
void startBackgroundRefresh();

app.listen(PORT, () => {
  console.log(`farm-subsidy-mcp listening on :${PORT} (endpoint: POST /mcp)`);
});
