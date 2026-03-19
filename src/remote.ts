#!/usr/bin/env node
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { config, isMantisConfigured } from "./config/index.js";
import { createServer } from "./server.js";
import { log } from "./utils/logger.js";

const PORT = config.PORT;
const AUTH_TOKEN = config.SERVER_AUTH_TOKEN;

// 輸出環境配置
log.info("=== Mantis MCP Server (Remote HTTP) 配置資訊 ===", {
  api_url: config.MANTIS_API_URL,
  api_configured: isMantisConfigured(),
  environment: config.NODE_ENV,
  port: PORT,
  auth_enabled: !!AUTH_TOKEN,
});

if (!isMantisConfigured()) {
  log.warn("Mantis API 未完整配置，部分功能可能無法使用");
}

if (!AUTH_TOKEN) {
  log.warn("SERVER_AUTH_TOKEN 未設定，MCP 端點未受保護！建議設定以防止未授權存取。");
}

// 建立 Express app（綁定至 0.0.0.0 以支援遠端連線）
const app = createMcpExpressApp({ host: "0.0.0.0" });

// Bearer Token 驗證 middleware
if (AUTH_TOKEN) {
  app.use("/mcp", (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });
}

// MCP endpoint（無狀態模式：每個 request 建立獨立 transport）
app.post("/mcp", async (req, res) => {
  const mcpServer = createServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // 無狀態模式
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      mcpServer.close();
    });
  } catch (error) {
    log.error("處理 MCP 請求時發生錯誤", { error });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// 健康檢查端點
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: process.env.npm_package_version,
    mantis_configured: isMantisConfigured(),
  });
});

app.listen(PORT, "0.0.0.0", () => {
  log.info("Mantis MCP Server (HTTP) 已啟動", {
    port: PORT,
    mcp_endpoint: `http://0.0.0.0:${PORT}/mcp`,
    health_endpoint: `http://0.0.0.0:${PORT}/health`,
    auth: AUTH_TOKEN ? "Bearer token 已啟用" : "未設定（端點無保護）",
  });
});
