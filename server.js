import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is missing. /api/valuate will not work");
}

if (!process.env.TAVILY_API_KEY) {
  console.warn("WARNING: TAVILY_API_KEY is missing. Market search will not work");
}

// Khởi tạo Google Gemini AI
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "12mb" }));

// Prefer serving the existing frontend from this same server.
// If your frontend is on another domain, allow only that known origin.
if (process.env.FRONTEND_ORIGIN) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin === process.env.FRONTEND_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
}

const valuationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút." }
});

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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
Phân tích CHỈ những gì có căn cứ từ ảnh và thông tin người dùng. Không đoán model, năm sản xuất hay giá.
Nếu chưa đủ căn cứ xác định model, hãy ghi null và nêu câu hỏi cần hỏi người dùng.
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

  const model = ai.getGenerativeModel({
    model: MODEL,
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1200 }
  });
  const response = await model.generateContent([
    { text: prompt },
    ...images.map((image) => ({
      inlineData: { mimeType: image.mediaType, data: image.base64 }
    }))
  ]);

  return parseJsonFromText(response.response.text());
}

async function tavilySearch(query) {
  if (!process.env.TAVILY_API_KEY) {
    throw httpError(503, "Chưa cấu hình TAVILY_API_KEY để tìm giá thị trường.");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.TAVILY_API_KEY}`
    },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
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
    throw httpError(502, "Không thể truy vấn nguồn tìm kiếm giá lúc này.");
  }

  const data = await response.json();
  return (data.results || []).map((r) => ({
    title: String(r.title || "").slice(0, 300),
    url: String(r.url || ""),
    content: String(r.content || "").slice(0, 1800),
    score: Number(r.score || 0)
  })).filter((r) => /^https?:\/\//i.test(r.url));
}

function searchQueries(product) {
  const identity = [product.brand, product.model, product.product_name]
    .filter(Boolean).join(" ").trim();
  if (!identity) return [];
  return [
    `${identity} giá cũ Việt Nam`,
    `${identity} đã qua sử dụng giá`,
    `${identity} giá bán cũ site:chotot.com OR site:muaban.net OR site:facebook.com`
  ];
}

// Extract only explicit price strings found in search result text.
// Do not let the language model invent prices.
function extractPrices(text) {
  const source = String(text || "");
  const patterns = [
    /(?:₫|đ|vnd)\s*([0-9][0-9.,\s]{2,})/ig,
    /([0-9][0-9.,\s]{2,})\s*(?:₫|đ|vnd)\b/ig,
    /(?:giá|price)\s*[:\-]?\s*([0-9][0-9.,\s]{2,})\s*(?:k|nghìn|triệu|tr)?\b/ig
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

async function selectComparableSources(product, searchResults) {
  if (!searchResults.length) return [];

  // Ask the model to select relevant result indexes only.
  // Prices are separately parsed from source text by our own code.
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

  const model = ai.getGenerativeModel({
    model: MODEL,
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 500 }
  });
  const response = await model.generateContent(prompt);

  let parsed;
  try {
    parsed = parseJsonFromText(response.response.text());
  } catch {
    return [];
  }

  const indexes = Array.isArray(parsed.relevant_indexes)
    ? parsed.relevant_indexes.filter((n) => Number.isInteger(n) && n >= 0 && n < searchResults.length)
    : [];

  return [...new Set(indexes)].map((index) => searchResults[index]);
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
    marketSearchConfigured: Boolean(process.env.TAVILY_API_KEY)
  });
});
app.get("/", (_req, res) => {
  res.send("ReLoop API đang chạy thành công! Hãy thử truy cập /api/health");
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

    const queries = searchQueries(product);
    const searchBatches = await Promise.all(
      queries.map((query) => tavilySearch(query).catch((error) => {
        console.error("Search query failed:", error.message);
        return [];
      }))
    );

    const seen = new Set();
    const searchResults = searchBatches.flat().filter((result) => {
      if (seen.has(result.url)) return false;
      seen.add(result.url);
      return true;
    });

    const comparable = await selectComparableSources(product, searchResults);
    const estimate = buildPriceEstimate(product, comparable, originalPrice);

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
        : noPriceMessage,
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
    res.status(status).json({
      error: status >= 500
        ? (error.status ? error.message : "Đã xảy ra lỗi khi định giá. Vui lòng thử lại.")
        : error.message
    });
  }
});

// In production, serve your built frontend here if you choose to colocate it.
// Example: app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(`ReLoop valuation API listening on http://localhost:${PORT}`);
});
