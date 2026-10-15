import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { GoogleGenAI } from "@google/genai";
import {
  attachUser, requireLogin, requireAdmin, publicUser,
  findUserByCredentials, findUserByUsername, listUsers, setSessionCookie, clearSessionCookie
} from "./auth.js";
import { store, storeMode, trackStat } from "./store.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);
// gemini-2.5-* đã đóng với người dùng mới; dùng dòng Gemini 3.x
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is missing. /api/valuate will not work");
}
if (!process.env.TAVILY_API_KEY) {
  console.warn("WARNING: TAVILY_API_KEY is missing. Market prices will not be available");
}

// Khởi tạo Google Gemini AI (nhận diện ảnh + lọc kết quả tìm kiếm phù hợp)
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

// Vercel (và hầu hết hosting) đứng sau proxy: cần tin header X-Forwarded-For
// để rate limit tính theo IP thật của người dùng thay vì IP của proxy.
app.set("trust proxy", 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // CSP cho frontend trong public/ (Tailwind CDN, FontAwesome, Google Fonts, ảnh Unsplash, onclick inline)
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
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

const valuationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút." }
});

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateImages(images) {
  if (!Array.isArray(images) || images.length < 1 || images.length > MAX_IMAGES) {
    throw httpError(400, `Cần gửi từ 1 đến ${MAX_IMAGES} ảnh sản phẩm.`);
  }

  return images.map((image, index) => {
    if (!image || typeof image.base64 !== "string") {
      throw httpError(400, `Ảnh ${index + 1} không hợp lệ.`);
    }

    const mediaType = String(image.mediaType || "").toLowerCase();
    if (!ALLOWED_MIME.has(mediaType)) {
      throw httpError(400, `Ảnh ${index + 1} phải là JPEG, PNG, WEBP hoặc GIF.`);
    }

    const base64 = image.base64.replace(/^data:[^,]+,/, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      throw httpError(400, `Dữ liệu ảnh ${index + 1} không hợp lệ.`);
    }

    const estimatedBytes = Math.floor((base64.length * 3) / 4);
    if (estimatedBytes > MAX_IMAGE_BYTES) {
      throw httpError(413, `Mỗi ảnh tối đa ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    }

    return { base64, mediaType };
  });
}

function parseJsonFromText(text) {
  if (!text) throw new Error("AI không trả về nội dung.");
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI không trả về JSON hợp lệ.");
    return JSON.parse(match[0]);
  }
}

async function identifyProduct(images, note, usedFor) {
  const prompt = `Bạn là chuyên gia nhận diện sản phẩm đồ đã qua sử dụng tại Việt Nam.
Phân tích CHỈ những gì có căn cứ từ ảnh và thông tin người dùng. Không tự đoán model, năm sản xuất hay giá.
Nếu ghi chú của người dùng nêu rõ thương hiệu/model và không mâu thuẫn với ảnh, hãy dùng đúng thương hiệu/model đó
(điền vào "brand", "model" và đưa vào "product_name", ví dụ "Tai nghe Sony WH-1000XM4").
Nếu cả ảnh lẫn ghi chú đều chưa đủ căn cứ xác định model, hãy ghi null và nêu câu hỏi cần hỏi người dùng.
Đánh giá ngoại hình nhìn thấy được; không được khẳng định chức năng bên trong hoạt động nếu ảnh không chứng minh được.
Trả về JSON thuần theo cấu trúc:
{
 "is_product": boolean,
 "product_name": string,
 "brand": string|null,
 "model": string|null,
 "category": string,
 "identification_confidence": number,
 "visible_condition": {"grade":"Như mới|Tốt|Khá|Kém|Chưa xác định","score":number,"defects":string[]},
 "known_facts": string[],
 "unknowns": string[],
 "questions": string[]
}
score là điểm ngoại hình 0-100, không phải xác suất sản phẩm hoạt động. identification_confidence từ 0 đến 1.
Ghi chú của người dùng: ${String(note || "Không có").slice(0, 1500)}
Mục đích sử dụng/thông tin tuổi đời: ${String(usedFor || "Chưa cung cấp").slice(0, 500)}`;

  const response = await callGemini({
    model: MODEL,
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        ...images.map((image) => ({
          inlineData: { mimeType: image.mediaType, data: image.base64 }
        }))
      ]
    }],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 2048,
      // Gemini 2.5 tính token "suy nghĩ" vào maxOutputTokens; tắt đi để JSON không bị cắt cụt
      thinkingConfig: { thinkingBudget: 0 }
    }
  });

  return parseJsonFromText(response.text);
}

// Bọc lời gọi Gemini để chuyển lỗi hết hạn mức/quá tải thành thông báo dễ hiểu
async function callGemini(request) {
  trackStat("gemini_calls");
  try {
    return await ai.models.generateContent(request);
  } catch (error) {
    const status = Number(error?.status);
    if (status === 429) {
      throw httpError(429, "Đã hết lượt dùng Gemini trong hôm nay hoặc gửi quá nhanh. Vui lòng thử lại sau.");
    }
    if (status === 503 || status === 500) {
      throw httpError(503, "Gemini đang quá tải. Vui lòng thử lại sau ít phút.");
    }
    if (status === 404) {
      console.error("Gemini model unavailable:", error?.message);
      throw httpError(502, `Model ${request.model} không còn khả dụng. Hãy đổi GEMINI_MODEL sang model khác.`);
    }
    if (status === 400 || status === 403) {
      console.error("Gemini request rejected:", error?.message);
      throw httpError(502, "Gemini từ chối yêu cầu. Kiểm tra lại GEMINI_API_KEY và GEMINI_MODEL.");
    }
    throw error;
  }
}

function productIdentity(product) {
  return [product.brand, product.model, product.product_name]
    .filter(Boolean)
    .filter((part, index, parts) => !parts.slice(0, index).some((prev) =>
      normalizeText(prev).includes(normalizeText(part)) || normalizeText(part).includes(normalizeText(prev))))
    .join(" ")
    .trim();
}

// Tìm giá thị trường bằng Tavily (gói miễn phí 1.000 credit/tháng, không cần thẻ).
// "basic" = 1 credit/truy vấn, "advanced" = 2 credit/truy vấn (nội dung trích dẫn dài hơn).
const TAVILY_SEARCH_DEPTH = process.env.TAVILY_SEARCH_DEPTH === "advanced" ? "advanced" : "basic";

async function tavilySearch(query) {
  trackStat("tavily_calls");
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.TAVILY_API_KEY}`
    },
    body: JSON.stringify({
      query,
      search_depth: TAVILY_SEARCH_DEPTH,
      topic: "general",
      country: "vietnam",
      max_results: 8,
      include_answer: false,
      include_raw_content: false
    }),
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error("Tavily error:", response.status, details.slice(0, 500));
    if (response.status === 429 || response.status === 432 || response.status === 433) {
      throw httpError(429, "Đã hết lượt tìm giá thị trường (Tavily) của tháng này hoặc gửi quá nhanh.");
    }
    if (response.status === 401 || response.status === 403) {
      throw httpError(502, "TAVILY_API_KEY không hợp lệ.");
    }
    throw httpError(502, "Không thể truy vấn nguồn tìm kiếm giá lúc này.");
  }

  const data = await response.json();
  return (data.results || []).map((r) => ({
    title: String(r.title || "").slice(0, 300),
    url: String(r.url || ""),
    content: String(r.content || "").slice(0, 1800)
  })).filter((r) => /^https?:\/\//i.test(r.url));
}

// 2 truy vấn mỗi lần định giá (2 credit với "basic") -> khoảng 500 lần định giá/tháng ở gói miễn phí.
function searchQueries(product) {
  const identity = productIdentity(product);
  if (!identity) return [];
  return [
    `${identity} cũ giá bán Việt Nam`,
    `${identity} đã qua sử dụng giá site:chotot.com OR site:muaban.net`
  ];
}

// Gemini chỉ CHỌN kết quả nào đúng sản phẩm; giá được trích xuất riêng bằng code từ nội dung nguồn.
async function selectComparableSources(product, searchResults) {
  if (!searchResults.length) return [];

  const compactResults = searchResults.map((r, index) => ({
    index,
    title: r.title,
    url: r.url,
    snippet: r.content,
    visible_prices: extractPrices(`${r.title} ${r.content}`)
  }));

  const prompt = `Chọn các kết quả có khả năng là cùng sản phẩm hoặc đúng model để tham khảo giá đồ cũ tại Việt Nam.
Chỉ chọn khi có bằng chứng đủ phù hợp; ưu tiên đúng model/phiên bản. Loại trang không liên quan, bài hướng dẫn chung, phụ kiện riêng, sản phẩm khác model và giá không rõ ngữ cảnh.
Không suy đoán giá. Chỉ trả JSON {"relevant_indexes":[số nguyên,...]}.
Sản phẩm nhận diện: ${JSON.stringify({
    product_name: product.product_name,
    brand: product.brand,
    model: product.model,
    category: product.category
  })}
Kết quả tìm kiếm: ${JSON.stringify(compactResults)}`;

  const response = await callGemini({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingBudget: 0 }
    }
  });

  let parsed;
  try {
    parsed = parseJsonFromText(response.text);
  } catch {
    return [];
  }

  const indexes = Array.isArray(parsed.relevant_indexes)
    ? parsed.relevant_indexes.filter((n) => Number.isInteger(n) && n >= 0 && n < searchResults.length)
    : [];

  return [...new Set(indexes)].map((index) => searchResults[index]);
}

async function searchMarketListings(product) {
  if (!process.env.TAVILY_API_KEY) {
    throw httpError(503, "Chưa cấu hình TAVILY_API_KEY để tìm giá thị trường.");
  }

  const queries = searchQueries(product);
  const batches = await Promise.allSettled(queries.map((query) => tavilySearch(query)));
  const failures = batches.filter((b) => b.status === "rejected");
  if (failures.length === batches.length && failures.length) throw failures[0].reason;

  const seen = new Set();
  const searchResults = batches
    .flatMap((b) => (b.status === "fulfilled" ? b.value : []))
    .filter((result) => {
      if (seen.has(result.url)) return false;
      seen.add(result.url);
      return true;
    });

  return { listings: await selectComparableSources(product, searchResults) };
}

// Extract only explicit price strings found in search result text.
// Do not let the language model invent prices.
function extractPrices(text) {
  const source = String(text || "");
  // Dùng (?![\p{L}\p{N}]) thay cho \b: trong regex JS, \b chỉ hiểu ký tự ASCII nên "8.500.000 đ"
  // hoặc "8.500.000₫" (không có chữ cái ASCII sau đ/₫) trước đây không bao giờ khớp.
  const patterns = [
    /(?:₫|đ|vnd)\s*([0-9][0-9.,\s]{2,})/giu,
    /([0-9][0-9.,\s]{2,})\s*(?:₫|đ|vnd)(?![\p{L}\p{N}])/giu,
    /(?:giá|price)\s*[:\-]?\s*([0-9][0-9.,\s]{2,})\s*(?:k|nghìn|triệu|tr)?(?![\p{L}\p{N}])/giu
  ];
  const values = [];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const raw = match[1].trim();
      const compact = raw.replace(/\s/g, "");

      let value;
      if (/^\d{1,3}(?:[.,]\d{3})+$/.test(compact)) {
        value = Number(compact.replace(/[.,]/g, ""));
      } else if (/^\d{4,9}$/.test(compact)) {
        value = Number(compact);
      } else {
        // Decimal-looking values are ambiguous; ignore rather than guess.
        continue;
      }

      if (Number.isFinite(value) && value >= 10000 && value <= 10000000000) {
        values.push(value);
      }
    }
  }
  return [...new Set(values)];
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numericMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function getConditionMultiplier(grade) {
  // Conservative starting assumptions, to be calibrated with real sales data.
  // These multipliers adjust only the item's condition relative to typical used listings.
  const map = {
    "Như mới": 1.05,
    "Tốt": 1.00,
    "Khá": 0.88,
    "Kém": 0.65,
    "Chưa xác định": 0.90
  };
  return map[grade] ?? 0.90;
}

function buildPriceEstimate(product, comparableResults, originalPrice) {
  const listings = comparableResults.map((r) => {
    const prices = extractPrices(`${r.title}\n${r.content}`);
    return {
      title: r.title,
      url: r.url,
      snippet: r.content,
      prices
    };
  }).filter((r) => r.prices.length > 0);

  const allPrices = listings.flatMap((listing) => listing.prices);
  if (allPrices.length < 2) {
    return {
      listings,
      price: null,
      reason: "Không tìm được ít nhất hai mức giá rõ ràng từ các nguồn phù hợp. Không tự tạo giá thay thế."
    };
  }

  // Remove extreme outliers using a robust median/MAD rule when enough samples exist.
  const median = numericMedian(allPrices);
  const deviations = allPrices.map((v) => Math.abs(v - median));
  const mad = numericMedian(deviations);
  const filtered = mad > 0
    ? allPrices.filter((v) => Math.abs(v - median) <= 3 * 1.4826 * mad)
    : allPrices;

  if (filtered.length < 2) {
    return {
      listings,
      price: null,
      reason: "Dữ liệu giá quá phân tán để đưa ra khoảng giá đáng tin cậy."
    };
  }

  const baseMedian = numericMedian(filtered);
  const multiplier = getConditionMultiplier(product.visible_condition?.grade);
  let suggested = Math.round((baseMedian * multiplier) / 1000) * 1000;

  // Original purchase price is a cross-check, not a market-price anchor.
  const original = Number(originalPrice);
  const originalPriceNote = Number.isFinite(original) && original > 0
    ? "Giá mua ban đầu chỉ được dùng làm thông tin đối chiếu, không thay thế dữ liệu thị trường."
    : null;

  const sorted = [...filtered].sort((a, b) => a - b);
  const lowBase = sorted[Math.max(0, Math.floor((sorted.length - 1) * 0.2))];
  const highBase = sorted[Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * 0.8))];

  let min = Math.round((lowBase * multiplier) / 1000) * 1000;
  let max = Math.round((highBase * multiplier) / 1000) * 1000;

  min = Math.min(min, suggested);
  max = Math.max(max, suggested);
  if (max < min) max = min;

  return {
    listings,
    price: { min, max, suggested },
    stats: {
      comparable_price_count: filtered.length,
      market_median_before_condition: baseMedian,
      condition_multiplier: multiplier,
      source_count: listings.length
    },
    originalPriceNote
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    model: MODEL,
    marketSearch: "tavily",
    marketSearchConfigured: Boolean(process.env.TAVILY_API_KEY),
    authConfigured: Boolean(process.env.AUTH_USERS && process.env.AUTH_SECRET),
    storage: storeMode
  });
});

// --- ĐĂNG NHẬP ---
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút." }
});

app.post("/api/auth/login", loginLimiter, (req, res) => {
  const user = findUserByCredentials(req.body?.username, req.body?.password);
  if (!user) {
    return res.status(401).json({ error: "Tên đăng nhập hoặc mật khẩu không đúng." });
  }
  setSessionCookie(req, res, user);
  trackStat("logins");
  res.json({ user: publicUser(user) });
});

// Đăng nhập nhanh không cần mật khẩu, CHỈ dùng để chạy thử/demo (DEMO_LOGIN=true).
// Bật trên web công khai thì ai cũng vào được tài khoản admin.
const DEMO_LOGIN = process.env.DEMO_LOGIN === "true";
if (DEMO_LOGIN && process.env.VERCEL) {
  console.warn("WARNING: DEMO_LOGIN đang bật trên Vercel: ai cũng đăng nhập được mọi tài khoản, kể cả admin");
}

app.get("/api/auth/demo-accounts", (_req, res) => {
  res.json({ accounts: DEMO_LOGIN ? listUsers().map(publicUser) : [] });
});

app.post("/api/auth/demo-login", loginLimiter, (req, res) => {
  if (!DEMO_LOGIN) return res.status(404).json({ error: "Không tìm thấy API." });
  const user = findUserByUsername(req.body?.username);
  if (!user) return res.status(404).json({ error: "Tài khoản không tồn tại." });
  setSessionCookie(req, res, user);
  trackStat("logins");
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// --- TIN ĐĂNG ---
// Tin của user thường chờ admin duyệt mới hiện lên chợ; tin của admin được duyệt ngay.
const LISTING_TYPES = new Set(["buy", "trade", "both"]);
const LISTING_CATEGORIES = new Set(["dien-tu", "thoi-trang", "gia-dung", "my-pham"]);
const LISTING_STATUSES = new Set(["pending", "approved", "rejected"]);
const MAX_LISTING_IMAGE_CHARS = 1.5 * 1024 * 1024;
const DEFAULT_LISTING_IMAGE = "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=60";

const listingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Bạn đăng tin quá nhanh. Vui lòng thử lại sau ít phút." }
});

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanMoney(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, 10_000_000_000) : 0;
}

function validateListing(body) {
  const name = cleanText(body?.name, 150);
  if (!name) throw httpError(400, "Vui lòng nhập tên sản phẩm.");

  const type = LISTING_TYPES.has(body?.type) ? body.type : "buy";
  const category = LISTING_CATEGORIES.has(body?.category) ? body.category : "dien-tu";
  const price = cleanMoney(body?.price);
  if (type !== "trade" && price <= 0) throw httpError(400, "Vui lòng nhập giá bán hợp lệ.");

  let image = DEFAULT_LISTING_IMAGE;
  if (body?.image) {
    const value = String(body.image);
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw httpError(400, "Ảnh sản phẩm không hợp lệ.");
    }
    if (value.length > MAX_LISTING_IMAGE_CHARS) throw httpError(413, "Ảnh sản phẩm quá lớn.");
    image = value;
  }

  const variants = (Array.isArray(body?.variants) ? body.variants : [])
    .map((v) => cleanText(v, 60)).filter(Boolean).slice(0, 10);

  return {
    name,
    type,
    category,
    price,
    originalPrice: Math.max(price, cleanMoney(body?.originalPrice)),
    discount: cleanText(body?.discount, 30) || "Mới đăng",
    desiredExchange: type === "buy" ? "" : cleanText(body?.desiredExchange, 200),
    description: cleanText(body?.description, 2000) || "Sản phẩm người dùng tự đăng.",
    location: cleanText(body?.location, 80) || "TP. Hồ Chí Minh",
    variants: variants.length ? variants : ["Mặc định"],
    image
  };
}

function canManageListing(user, listing) {
  return Boolean(user && (user.role === "admin" || listing.owner === user.username));
}

// Ai cũng thấy tin đã duyệt; chủ tin thấy cả tin chờ duyệt/bị từ chối của mình; admin thấy tất cả.
app.get("/api/listings", async (req, res, next) => {
  try {
    const listings = (await store.listListings())
      .filter((l) => l.status === "approved" || canManageListing(req.user, l))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ listings });
  } catch (error) {
    next(error);
  }
});

app.post("/api/listings", requireLogin, listingLimiter, async (req, res, next) => {
  try {
    const listing = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      ...validateListing(req.body),
      rating: 5.0,
      sold: "0",
      owner: req.user.username,
      ownerName: req.user.name,
      status: req.user.role === "admin" ? "approved" : "pending",
      createdAt: new Date().toISOString()
    };
    await store.saveListing(listing);
    trackStat("listings_created");
    res.status(201).json({ listing });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/listings/:id", requireAdmin, async (req, res, next) => {
  try {
    const listing = await store.getListing(req.params.id);
    if (!listing) throw httpError(404, "Tin đăng không tồn tại hoặc đã bị gỡ.");
    if (!LISTING_STATUSES.has(req.body?.status)) throw httpError(400, "Trạng thái không hợp lệ.");
    const updated = {
      ...listing,
      status: req.body.status,
      reviewedBy: req.user.username,
      reviewedAt: new Date().toISOString()
    };
    await store.saveListing(updated);
    res.json({ listing: updated });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/listings/:id", requireLogin, async (req, res, next) => {
  try {
    const listing = await store.getListing(req.params.id);
    if (!listing) throw httpError(404, "Tin đăng không tồn tại hoặc đã bị gỡ.");
    if (!canManageListing(req.user, listing)) throw httpError(403, "Bạn không có quyền gỡ tin này.");
    await store.deleteListing(listing.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// --- THỐNG KÊ CHO ADMIN ---
app.get("/api/admin/stats", requireAdmin, async (_req, res, next) => {
  try {
    const [usage, listings] = await Promise.all([store.getStats(), store.listListings()]);
    const byStatus = { pending: 0, approved: 0, rejected: 0 };
    for (const l of listings) if (l.status in byStatus) byStatus[l.status]++;
    res.json({ usage, listings: { total: listings.length, ...byStatus }, storage: storeMode });
  } catch (error) {
    next(error);
  }
});
app.post("/api/valuate", valuationLimiter, async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw httpError(503, "Chưa cấu hình GEMINI_API_KEY.");
    }

    const images = validateImages(req.body?.images);
    const note = String(req.body?.note || "").slice(0, 1500);
    const usedFor = String(req.body?.usedFor || "").slice(0, 500);
    const originalPrice = req.body?.originalPrice;

    trackStat("valuations");
    const product = await identifyProduct(images, note, usedFor);

    if (!product.is_product) {
      throw httpError(422, "Ảnh chưa cho thấy một sản phẩm có thể định giá. Vui lòng tải ảnh khác.");
    }

    if (!product.product_name || !String(product.product_name).trim()) {
      throw httpError(422, "AI chưa nhận diện được sản phẩm. Hãy thêm tên/model hoặc chụp rõ tem sản phẩm.");
    }

    if (!product.model && !product.brand && !note.trim()) {
      return res.status(200).json({
        is_product: true,
        product_name: product.product_name,
        brand: product.brand || null,
        category: product.category || "khac",
        condition: product.visible_condition || {
          grade: "Chưa xác định", score: 50, defects: []
        },
        price: null,
        confidence: 0,
        reasoning: "Chưa xác định đủ thương hiệu/model để tìm giá tương đương. Vui lòng bổ sung tên, model hoặc thông tin trên tem.",
        questions: product.questions || ["Thương hiệu và model chính xác của sản phẩm là gì?"],
        selling_tips: [],
        sources: [],
        requires_more_info: true
      });
    }

    // Nếu tìm giá thất bại (hết credit Tavily, Gemini quá tải...), vẫn trả kết quả nhận diện
    // kèm price: null thay vì làm hỏng cả lần định giá.
    let market = { listings: [] };
    let marketError = null;
    try {
      market = await searchMarketListings(product);
    } catch (error) {
      console.error("Market search failed:", error.status || "", error.message);
      marketError = error.status
        ? error.message
        : "Chưa tìm được giá thị trường lúc này. Vui lòng thử lại sau ít phút.";
    }
    const estimate = buildPriceEstimate(product, market.listings, originalPrice);

    const sources = estimate.listings.map((listing) => ({
      title: listing.title,
      url: listing.url,
      prices_vnd: listing.prices,
      snippet: listing.snippet.slice(0, 500)
    }));

    const noPriceMessage = "Không đủ dữ liệu giá thị trường có thể kiểm chứng để đưa ra giá. ReLoop không tự tạo giá thay thế; hãy thử lại hoặc bổ sung model chính xác.";

    res.json({
      is_product: true,
      product_name: product.product_name,
      brand: product.brand || null,
      model: product.model || null,
      category: product.category || "khac",
      condition: product.visible_condition || {
        grade: "Chưa xác định", score: 50, defects: []
      },
      price: estimate.price,
      confidence: estimate.price
        ? Math.min(0.95, 0.35 + 0.1 * estimate.stats.source_count + 0.05 * estimate.stats.comparable_price_count)
        : 0.15,
      reasoning: estimate.price
        ? `Giá được ước tính từ các mức giá trích xuất được trong ${estimate.stats.source_count} nguồn tham khảo phù hợp. Giá trung vị tham khảo trước điều chỉnh tình trạng: ${estimate.stats.market_median_before_condition.toLocaleString("vi-VN")} VND. Hệ số tình trạng áp dụng: ${estimate.stats.condition_multiplier}. Đây là giá rao bán tham khảo, không phải dữ liệu giao dịch đã xác minh.`
        : (marketError || noPriceMessage),
      questions: product.questions || [],
      selling_tips: [
        "Chụp rõ tem model/serial (che thông tin cá nhân nếu có).",
        "Chụp cận cảnh các vết trầy, nứt hoặc hư hỏng.",
        "Nêu rõ chức năng đã kiểm tra, phụ kiện và thời hạn bảo hành."
      ],
      sources,
      price_method: "median_of_extracted_comparable_listing_prices_adjusted_for_visible_condition",
      market_data_note: "Giá được trích xuất từ nội dung kết quả tìm kiếm. Các trang có thể thay đổi giá; cần kiểm tra trực tiếp trước khi giao dịch.",
      original_price_note: estimate.originalPriceNote || null,
      requires_more_info: !estimate.price
    });
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error("Valuation error:", error);
    trackStat("valuation_errors");
    res.status(status).json({
      error: status >= 500
        ? (error.status ? error.message : "Đã xảy ra lỗi khi định giá. Vui lòng thử lại.")
        : error.message
    });
  }
});

// API không tồn tại -> trả JSON thay vì trang HTML mặc định của Express
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Không tìm thấy API." });
});

// Lỗi từ middleware (JSON sai cú pháp, body quá lớn...) -> luôn trả JSON tiếng Việt
app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "Ảnh gửi lên quá lớn. Vui lòng dùng ảnh nhỏ hơn hoặc ít ảnh hơn." });
  }
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Dữ liệu gửi lên không hợp lệ." });
  }
  if (error?.status && error.status < 500) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error("Unhandled error:", error);
  res.status(500).json({ error: "Đã xảy ra lỗi máy chủ. Vui lòng thử lại." });
});

// Trên Vercel: app được export làm Vercel Function, file trong public/ do CDN phục vụ.
// Chạy local (npm run dev): tự phục vụ public/ và lắng nghe cổng PORT.
if (!process.env.VERCEL) {
  app.use(express.static("public"));
  app.listen(PORT, () => {
    console.log(`ReLoop đang chạy tại http://localhost:${PORT}`);
  });
}

export default app;
