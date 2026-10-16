// Tìm giá thị trường bằng Tavily rồi để Gemini chọn đúng các giá thuộc sản phẩm.
import { httpError } from "./http-error.js";
import { callGemini, parseJsonFromText } from "./gemini.js";
import { extractPrices, normalizeText } from "./pricing.js";
import { trackStat } from "./stats.js";

// Gói miễn phí 1.000 credit/tháng, không cần thẻ.
// "basic" = 1 credit/truy vấn, "advanced" = 2 credit/truy vấn (nội dung trích dẫn dài hơn).
const TAVILY_SEARCH_DEPTH = process.env.TAVILY_SEARCH_DEPTH === "advanced" ? "advanced" : "basic";
const TAVILY_TIMEOUT_MS = 20000;
const MIN_SEARCH_MS = 3000;

export function productIdentity(product) {
  return [product.brand, product.model, product.product_name]
    .filter(Boolean)
    .filter((part, index, parts) => !parts.slice(0, index).some((prev) =>
      normalizeText(prev).includes(normalizeText(part)) || normalizeText(part).includes(normalizeText(prev))))
    .join(" ")
    .trim();
}

async function tavilySearch(query, deadline) {
  const remaining = deadline - Date.now();
  if (remaining < MIN_SEARCH_MS) throw httpError(504, "Hết thời gian tìm giá thị trường. Vui lòng thử lại.");
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
    signal: AbortSignal.timeout(Math.min(TAVILY_TIMEOUT_MS, remaining))
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
// Tavily không hiểu cú pháp "site:a OR site:b" (trả 0 kết quả) nên nhắc tên chợ ngay trong câu truy vấn.
export function searchQueries(product) {
  const identity = productIdentity(product);
  if (!identity) return [];
  return [
    `${identity} cũ giá`,
    `${identity} cũ giá chợ tốt`
  ];
}

// Giá được trích xuất bằng code từ nội dung nguồn; Gemini chỉ CHỌN trong các giá đó những giá thuộc đúng sản phẩm
// (một trang thường liệt kê nhiều model/phiên bản, giá máy mới, phụ kiện... nên không thể lấy mọi giá trên trang).
async function selectComparableSources(product, searchResults, deadline) {
  if (!searchResults.length) return { sources: [], method: "ai" };

  const compactResults = searchResults.map((r, index) => ({
    index,
    title: r.title,
    url: r.url,
    snippet: r.content,
    visible_prices: extractPrices(`${r.title} ${r.content}`)
  }));

  const prompt = `Bạn lọc giá tham khảo đồ cũ tại Việt Nam cho đúng một sản phẩm.
Mỗi kết quả tìm kiếm có "visible_prices" là các con số đã được trích từ snippet. Với từng kết quả, đọc ngữ cảnh trong snippet và CHỈ giữ những giá trong visible_prices là giá bán máy CŨ/đã qua sử dụng của ĐÚNG model sản phẩm.
Quy tắc:
- Đúng dòng máy: các phiên bản khác nhau là sản phẩm khác (vd iPhone 17 khác iPhone 17 Pro, 17 Pro Max, iPhone Air, iPhone 16; Galaxy S24 khác S24 Ultra).
- Nếu sản phẩm đã rõ dung lượng/cấu hình thì chỉ lấy giá đúng dung lượng đó; nếu chưa rõ thì chấp nhận mọi dung lượng của đúng model.
- Loại: giá máy mới/niêm yết, số tiền giảm, giá trả góp theo tháng, giá thu mua lại, giá phụ kiện, giá của model khác, khoảng giá chung cho cả dòng sản phẩm, con số không rõ thuộc sản phẩm nào.
- Không tự tạo hay làm tròn giá: mọi số trả về phải chép nguyên từ visible_prices của chính kết quả đó. Kết quả không có giá phù hợp thì bỏ qua.
Chỉ trả JSON {"matches":[{"index":số nguyên,"prices":[số,...]}]}.
Sản phẩm nhận diện: ${JSON.stringify({
    product_name: product.product_name,
    brand: product.brand,
    model: product.model,
    category: product.category
  })}
Kết quả tìm kiếm: ${JSON.stringify(compactResults)}`;

  let parsed;
  try {
    const response = await callGemini({
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 2048
      }
    }, { timeoutMs: 25000, preferLite: true, deadline });
    parsed = parseJsonFromText(response.text);
  } catch (error) {
    // AI lọc nguồn hết lượt/quá tải: vẫn tính được giá bằng cách lọc theo từ khóa thay vì bỏ trống giá
    console.warn("AI source filter unavailable, using keyword filter:", error.message);
    return { sources: keywordComparableSources(product, searchResults), method: "keyword" };
  }

  // Chỉ nhận giá có thật trong visible_prices của đúng kết quả đó (chặn AI bịa hoặc gán nhầm giá)
  const byIndex = new Map();
  for (const match of Array.isArray(parsed.matches) ? parsed.matches : []) {
    const index = match?.index;
    if (!Number.isInteger(index) || index < 0 || index >= searchResults.length) continue;
    const allowed = new Set(compactResults[index].visible_prices);
    const prices = (Array.isArray(match.prices) ? match.prices : []).map(Number).filter((p) => allowed.has(p));
    if (prices.length) byIndex.set(index, [...new Set([...(byIndex.get(index) || []), ...prices])]);
  }

  return {
    sources: [...byIndex].map(([index, prices]) => ({ ...searchResults[index], prices })),
    method: "ai"
  };
}

// Lọc dự phòng không dùng AI: giữ kết quả có nhắc đúng model (hoặc đủ các từ khóa của tên sản phẩm)
// và loại các trang phụ kiện. Kém chính xác hơn AI nên chỉ dùng khi AI không khả dụng.
const ACCESSORY_WORDS = /\b(op lung|bao da|cuong luc|mieng dan|cu sac|cap sac|day deo|tui dung|case|cover|charger|cable|strap|phu kien)\b/;

function keywordComparableSources(product, searchResults) {
  const modelText = normalizeText(product.model);
  const modelTokens = modelText.split(" ").filter((t) => t.length >= 2);
  const nameTokens = normalizeText([product.brand, product.product_name].filter(Boolean).join(" "))
    .split(" ").filter((t) => t.length >= 2);
  const productIsAccessory = ACCESSORY_WORDS.test(normalizeText(product.product_name));

  return searchResults.filter((r) => {
    const text = normalizeText(`${r.title} ${r.content}`);
    const title = normalizeText(r.title);
    if (!productIsAccessory && ACCESSORY_WORDS.test(title)) return false;
    if (modelTokens.length) return modelTokens.every((t) => text.includes(t));
    const hits = nameTokens.filter((t) => text.includes(t)).length;
    return nameTokens.length > 0 && hits / nameTokens.length >= 0.75;
  });
}

export async function searchMarketListings(product, { deadline = Infinity } = {}) {
  if (!process.env.TAVILY_API_KEY) {
    throw httpError(503, "Chưa cấu hình TAVILY_API_KEY để tìm giá thị trường.");
  }

  const queries = searchQueries(product);
  const batches = await Promise.allSettled(queries.map((query) => tavilySearch(query, deadline)));
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

  const { sources, method } = await selectComparableSources(product, searchResults, deadline);
  return { listings: sources, filterMethod: method };
}
