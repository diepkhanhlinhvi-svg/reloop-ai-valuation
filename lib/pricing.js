// Trích xuất giá từ văn bản nguồn và tính khoảng giá. Không gọi mạng, không dùng AI, nên test được trực tiếp.

const MIN_PRICE = 10_000;
const MAX_PRICE = 10_000_000_000;

// Số có nhóm hàng nghìn ("8.500.000", "12,500") hoặc số liền ("8500000")
const GROUPED = String.raw`\d{1,3}(?:[.,]\d{3})+`;
// Số đi kèm đơn vị có thể là số thập phân ngắn: "8,5 triệu", "1.5tr", "390k", "12.500k"
const UNIT_NUMBER = String.raw`${GROUPED}|\d{1,4}(?:[.,]\d{1,2})?`;
const PLAIN_NUMBER = String.raw`${GROUPED}|\d{5,11}`;
const NUMBER_START = String.raw`(?<![\p{L}\p{N}.,])`;
const NUMBER_END = String.raw`(?![\p{N}]|[.,]\d)`;

const UNITS = { "triệu": 1_000_000, "tr": 1_000_000, "k": 1_000, "nghìn": 1_000, "ngàn": 1_000 };
const UNIT_PATTERN = new RegExp(
  String.raw`${NUMBER_START}(${UNIT_NUMBER})\s*(triệu|tr|k|nghìn|ngàn)(?![\p{L}\p{N}])`, "giu");
// Dùng (?![\p{L}\p{N}]) thay cho \b: trong regex JS, \b chỉ hiểu ký tự ASCII nên "8.500.000 đ" sẽ không khớp.
const CURRENCY_PATTERNS = [
  new RegExp(String.raw`${NUMBER_START}(${PLAIN_NUMBER})${NUMBER_END}\s*(?:₫|đ|vnđ|vnd)(?![\p{L}\p{N}])`, "giu"),
  new RegExp(String.raw`(?:₫|vnđ|vnd)\s*(${PLAIN_NUMBER})${NUMBER_END}`, "giu"),
  new RegExp(String.raw`(?:giá|price)\s*[:\-]?\s*(${PLAIN_NUMBER})${NUMBER_END}(?![\p{L}])`, "giu")
];

// Giá máy mới / giá gạch ngang / số tiền giảm không phải giá đồ cũ -> bỏ trước khi trích xuất.
const NOT_USED_PRICE = /~~[^~]*~~|(?:giá\s*(?:máy|sản phẩm)\s*mới|(?<!như\s)mới\s*:|niêm yết(?:\s*chính thức)?(?:\s*là)?|giảm(?:\s*thêm)?|tiết kiệm)\s*[:\-]?\s*[0-9][0-9.,]*\s*(?:triệu|tr|k|₫|đ|vnđ|vnd)?/giu;

function parseGrouped(raw) {
  return /^\d{1,3}(?:[.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, "")) : null;
}

function inRange(value) {
  return Number.isFinite(value) && value >= MIN_PRICE && value <= MAX_PRICE;
}

// Chỉ lấy những con số được viết rõ là giá trong văn bản; không để mô hình ngôn ngữ tự tạo giá.
export function extractPrices(text) {
  let source = String(text || "").replace(NOT_USED_PRICE, " ");
  const values = [];

  // Có đơn vị trước: "12.500k" là 12,5 triệu chứ không phải 12.500 đồng. Phần đã khớp được xóa
  // để các mẫu "giá ..." phía dưới không đọc lại cùng con số mà thiếu đơn vị.
  source = source.replace(UNIT_PATTERN, (_match, raw, unit) => {
    const grouped = parseGrouped(raw);
    const number = grouped ?? Number(raw.replace(",", "."));
    const value = Math.round(number * UNITS[unit.toLowerCase()]);
    if (inRange(value)) values.push(value);
    return " ";
  });

  for (const pattern of CURRENCY_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const value = parseGrouped(match[1]) ?? Number(match[1]);
      if (inRange(value)) values.push(value);
    }
  }
  return [...new Set(values)];
}

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
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

export function buildPriceEstimate(product, comparableResults, originalPrice) {
  const listings = comparableResults.map((r) => {
    // Nguồn đã được AI chọn giá thì dùng đúng các giá đó; lọc theo từ khóa thì lấy mọi giá trích được
    const prices = r.prices || extractPrices(`${r.title}\n${r.content}`);
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
  const suggested = Math.round((baseMedian * multiplier) / 1000) * 1000;

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
