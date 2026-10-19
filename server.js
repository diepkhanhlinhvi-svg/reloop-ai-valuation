import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { attachUser } from "./auth.js";
import { databaseConfigured } from "./lib/db.js";
import { geminiConfigured, MODEL } from "./lib/gemini.js";
import { asyncRoute } from "./lib/http-error.js";
import { blobConfigured } from "./lib/images.js";
import { createLimiter } from "./lib/rate-limit-store.js";
import { trackStat } from "./lib/stats.js";
import { valuate } from "./lib/valuation.js";
import authRoutes from "./routes/auth.js";
import marketplaceRoutes from "./routes/marketplace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);

for (const [configured, warning] of [
  [geminiConfigured, "GEMINI_API_KEY is missing. /api/valuate will not work"],
  [process.env.TAVILY_API_KEY, "TAVILY_API_KEY is missing. Market prices will not be available"],
  [databaseConfigured, "DATABASE_URL is missing. Listings, orders and trade offers will not work"],
  [blobConfigured, "BLOB_READ_WRITE_TOKEN is missing. Listings cannot upload images"]
]) {
  if (!configured) console.warn(`WARNING: ${warning}`);
}

// Vercel (và hầu hết hosting) đứng sau proxy: cần tin header X-Forwarded-For
// để rate limit tính theo IP thật của người dùng thay vì IP của proxy.
app.set("trust proxy", 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // CSP cho frontend trong public/: script chỉ từ chính site + Tailwind CDN (không còn script inline).
  // script-src-attr vẫn cần 'unsafe-inline' vì giao diện dùng onclick="..." trong template.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.tailwindcss.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  }
}));
// Vercel giới hạn body request 4,5 MB; frontend đã nén ảnh về tối đa 1024px nên thường chỉ vài trăm KB/ảnh.
app.use(express.json({ limit: "4mb" }));

// Prefer serving the existing frontend from this same server.
// If your frontend is on another domain, allow only that known origin.
if (process.env.FRONTEND_ORIGIN) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin === process.env.FRONTEND_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
}

app.use(attachUser);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    geminiConfigured,
    model: MODEL,
    marketSearch: "tavily",
    marketSearchConfigured: Boolean(process.env.TAVILY_API_KEY),
    authConfigured: Boolean(process.env.AUTH_USERS && process.env.AUTH_SECRET),
    databaseConfigured,
    imageStorageConfigured: blobConfigured,
    storage: "postgres"
  });
});

app.use("/api/auth", authRoutes);
app.use("/api", marketplaceRoutes);

const valuationLimiter = createLimiter("valuate", {
  limit: 20,
  message: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút."
});

app.post("/api/valuate", valuationLimiter, asyncRoute(async (req, res) => {
  try {
    res.json(await valuate(req.body));
  } catch (error) {
    trackStat("valuation_errors");
    throw error;
  }
}));

// API không tồn tại -> trả JSON thay vì trang HTML mặc định của Express
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Không tìm thấy API." });
});

// Trang chủ: trả index.html trực tiếp để Vercel đóng gói file này vào Function
// (nếu request "/" lọt vào Express mà không có route này sẽ báo "Cannot GET /").
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Mọi lỗi -> luôn trả JSON tiếng Việt. Lỗi có status (httpError) là lỗi đã biết nên hiện nguyên thông báo.
app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "Ảnh gửi lên quá lớn. Vui lòng dùng ảnh nhỏ hơn hoặc ít ảnh hơn." });
  }
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Dữ liệu gửi lên không hợp lệ." });
  }
  if (error?.status) {
    if (error.status >= 500) console.error("Request failed:", error.message);
    return res.status(error.status).json({
      error: error.message,
      ...(error.unavailable ? { unavailable: error.unavailable } : {})
    });
  }
  console.error("Unhandled error:", error);
  res.status(500).json({ error: "Đã xảy ra lỗi máy chủ. Vui lòng thử lại." });
});

// Trên Vercel: app được export làm Vercel Function, file trong public/ do CDN phục vụ.
// Chạy local (npm run dev): tự phục vụ public/ và lắng nghe cổng PORT.
if (!process.env.VERCEL && !process.env.NODE_TEST_CONTEXT) {
  app.use(express.static(path.join(__dirname, "public")));
  app.listen(PORT, () => {
    console.log(`ReLoop đang chạy tại http://localhost:${PORT}`);
  });
}

export default app;
