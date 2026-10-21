// Định giá AI: nhận diện sản phẩm từ ảnh, tìm giá thị trường, ước tính khoảng giá.
import { httpError } from "./http-error.js";
import { callGemini, parseJsonFromText } from "./gemini.js";
import { searchMarketListings } from "./market.js";
import { buildNewPriceEstimate, buildPriceEstimate } from "./pricing.js";
import { trackStat } from "./stats.js";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
// Khớp với giới hạn ở frontend: tổng base64 các ảnh phải nằm trong body 4 MB của máy chủ
export const MAX_TOTAL_IMAGE_CHARS = 3.8 * 1024 * 1024;

// Dưới mức này coi như AI không nhận ra sản phẩm, phải hỏi lại người dùng
const MIN_IDENTIFICATION_CONFIDENCE = 0.3;
// Từ mức này model được coi là chắc chắn; thấp hơn thì vẫn định giá theo model AI đoán nhưng ghi rõ để người dùng sửa
const CONFIDENT_MODEL = 0.7;
// Tổng thời gian cho một lần định giá; dừng sớm thay vì để hosting cắt ngang yêu cầu
const VALUATION_BUDGET_MS = 55_000;

export function validateImages(images) {
  if (!Array.isArray(images) || images.length < 1 || images.length > MAX_IMAGES) {
    throw httpError(400, `Cần gửi từ 1 đến ${MAX_IMAGES} ảnh sản phẩm.`);
  }

  let totalChars = 0;
  const valid = images.map((image, index) => {
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
    totalChars += base64.length;

    return { base64, mediaType };
  });

  if (totalChars > MAX_TOTAL_IMAGE_CHARS) {
    throw httpError(413, "Tổng dung lượng ảnh quá lớn, vui lòng bớt ảnh.");
  }
  return valid;
}

async function identifyProduct(images, note, usedFor, deadline) {
  const prompt = `Bạn là chuyên gia nhận diện sản phẩm đồ đã qua sử dụng tại Việt Nam. Người dùng thường chỉ chụp ảnh, không ghi gì:
hãy tự nhận diện tối đa từ ảnh (hình dáng, logo, chữ in trên sản phẩm/bao bì, màu sắc, chi tiết đặc trưng).
Nếu ghi chú của người dùng nêu rõ thương hiệu/model và không mâu thuẫn với ảnh, ưu tiên dùng đúng thông tin đó.

Xác định "model_matters": true nếu giá phụ thuộc mạnh vào đời/model cụ thể (điện thoại, máy tính bảng, laptop, đồng hồ thông minh,
tai nghe, máy ảnh, máy chơi game, xe...); false với đồ thông dụng mà giá chủ yếu theo loại, thương hiệu, kích cỡ
(bút, văn phòng phẩm, quần áo, giày dép, đồ gia dụng thông thường, sách, đồ chơi...).
- model_matters = false: không cần model; "model" để null nếu sản phẩm không có model, KHÔNG hỏi người dùng về model.
- model_matters = true: luôn đưa ra model có khả năng cao nhất vào "model" (không để null nếu ảnh đủ để đoán dòng sản phẩm)
  và các khả năng khác vào "model_candidates". Phân biệt các phiên bản gần giống bằng chi tiết nhìn thấy
  (số lượng/bố cục camera, kích thước, màu đặc trưng, chữ trên máy), ví dụ iPhone 17 / 17 Pro / 17 Pro Max / iPhone Air.
  Dung lượng/RAM không nhìn thấy được: không đoán, chỉ nêu trong "questions".
"identification_confidence" (0-1) là mức chắc chắn về đúng sản phẩm cần định giá: với model_matters = true là về đúng model;
với model_matters = false là về đúng loại sản phẩm.
"search_name": tên ngắn gọn nhất để tìm giá trên mạng Việt Nam (vd "iPhone 17 Pro Max", "Bút lông dầu Thiên Long PM-09",
"Nồi chiên không dầu Philips HD9252"), không thêm chữ "cũ".
"questions": chỉ những câu hỏi thật sự làm thay đổi giá (tối đa 2), không hỏi lại điều đã thấy rõ trong ảnh.
Đánh giá ngoại hình nhìn thấy được; không được khẳng định chức năng bên trong hoạt động nếu ảnh không chứng minh được.
Không đoán năm sản xuất hay giá.
Trả về JSON thuần theo cấu trúc:
{
 "is_product": boolean,
 "product_name": string,
 "search_name": string,
 "brand": string|null,
 "model": string|null,
 "model_candidates": string[],
 "model_matters": boolean,
 "category": string,
 "identification_confidence": number,
 "visible_condition": {"grade":"Như mới|Tốt|Khá|Kém|Chưa xác định","score":number,"defects":string[]},
 "known_facts": string[],
 "unknowns": string[],
 "questions": string[]
}
score là điểm ngoại hình 0-100, không phải xác suất sản phẩm hoạt động.
Ghi chú của người dùng: ${String(note || "Không có").slice(0, 1500)}
Mục đích sử dụng/thông tin tuổi đời: ${String(usedFor || "Chưa cung cấp").slice(0, 500)}`;

  const response = await callGemini({
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
      maxOutputTokens: 2048
    }
  }, { deadline });

  return parseJsonFromText(response.text);
}

function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

// Quyết định định giá luôn hay hỏi lại người dùng. Chỉ hỏi khi thật sự không thể tìm giá đúng:
// - đồ thông dụng (bút, nồi, áo...) không cần model;
// - đồ có model mà AI chưa chắc thì vẫn định giá theo model AI đoán (modelAssumed) để người dùng sửa nhanh.
export function identificationGate(product) {
  const identificationConfidence = clamp01(product.identification_confidence);
  // Mặc định coi là cần model nếu AI không trả trường này (an toàn hơn cho đồ điện tử)
  const modelMatters = product.model_matters !== false;
  if (modelMatters && !product.model) {
    return {
      action: "ask",
      identificationConfidence,
      reasoning: "Chưa nhận ra đời máy/model từ ảnh nên chưa thể tìm giá tương đương (các phiên bản khác nhau có giá rất khác nhau). Hãy chụp rõ mặt sau/tem máy hoặc ghi model vào ô Ghi chú.",
      question: "Model chính xác của sản phẩm là gì?"
    };
  }
  if (identificationConfidence < MIN_IDENTIFICATION_CONFIDENCE) {
    return {
      action: "ask",
      identificationConfidence,
      reasoning: "AI chưa nhận ra được sản phẩm trong ảnh. Hãy chụp rõ hơn (đủ sáng, thấy logo/chữ trên sản phẩm) hoặc ghi tên sản phẩm vào ô Ghi chú.",
      question: "Đây là sản phẩm gì, của hãng nào?"
    };
  }
  return {
    action: "price",
    identificationConfidence,
    modelAssumed: modelMatters && identificationConfidence < CONFIDENT_MODEL
  };
}

function defaultCondition(product) {
  return product.visible_condition || { grade: "Chưa xác định", score: 50, defects: [] };
}

// Kết quả khi chưa đủ căn cứ để định giá: trả lại những gì đã nhận diện được kèm câu hỏi cần bổ sung
function needMoreInfo(product, identificationConfidence, reasoning, fallbackQuestion) {
  const questions = Array.isArray(product.questions) && product.questions.length
    ? product.questions
    : [fallbackQuestion];
  return {
    is_product: true,
    product_name: product.product_name,
    brand: product.brand || null,
    model: product.model || null,
    model_candidates: Array.isArray(product.model_candidates) ? product.model_candidates.slice(0, 4) : [],
    category: product.category || "khac",
    condition: defaultCondition(product),
    identification_confidence: identificationConfidence,
    price: null,
    confidence: 0,
    reasoning,
    questions,
    selling_tips: [],
    sources: [],
    price_unavailable_reason: "missing_model",
    requires_more_info: true
  };
}

export async function valuate(body) {
  const deadline = Date.now() + VALUATION_BUDGET_MS;
  const images = validateImages(body?.images);
  const note = String(body?.note || "").slice(0, 1500);
  const usedFor = String(body?.usedFor || "").slice(0, 500);
  const originalPrice = body?.originalPrice;

  trackStat("valuations");
  const product = await identifyProduct(images, note, usedFor, deadline);

  if (!product.is_product) {
    throw httpError(422, "Ảnh chưa cho thấy một sản phẩm có thể định giá. Vui lòng tải ảnh khác.");
  }

  if (!product.product_name || !String(product.product_name).trim()) {
    throw httpError(422, "AI chưa nhận diện được sản phẩm. Hãy thêm tên/model hoặc chụp rõ tem sản phẩm.");
  }

  const gate = identificationGate(product);
  const identificationConfidence = gate.identificationConfidence;
  if (gate.action === "ask") {
    return needMoreInfo(product, identificationConfidence, gate.reasoning, gate.question);
  }
  const { modelAssumed } = gate;

  // Nếu tìm giá thất bại (hết credit Tavily, Gemini quá tải...), vẫn trả kết quả nhận diện
  // kèm price: null thay vì làm hỏng cả lần định giá.
  let market = { listings: [] };
  let marketError = null;
  try {
    market = await searchMarketListings(product, { deadline });
  } catch (error) {
    console.error("Market search failed:", error.status || "", error.message);
    marketError = error.status
      ? error.message
      : "Chưa tìm được giá thị trường lúc này. Vui lòng thử lại sau ít phút.";
  }
  const usedEstimate = buildPriceEstimate(product, market.listings, originalPrice);
  // Không có tin rao đồ cũ (hay gặp với đồ rẻ): ước tính từ giá bán mới × tỷ lệ khấu hao
  const newEstimate = usedEstimate.price ? null : buildNewPriceEstimate(product, market.listings, originalPrice);
  const fromNewPrice = Boolean(newEstimate?.price);
  const estimate = fromNewPrice ? newEstimate : usedEstimate;

  const sources = estimate.listings.map((listing) => ({
    title: listing.title,
    url: listing.url,
    prices_vnd: listing.prices,
    snippet: listing.snippet.slice(0, 500)
  }));

  const keywordNote = market.filterMethod === "keyword"
    ? " Lưu ý: AI lọc nguồn đang tạm hết lượt nên nguồn được lọc theo từ khóa tên/model, hãy kiểm tra lại các nguồn bên dưới."
    : "";
  const assumedNote = modelAssumed
    ? ` Model "${product.model}" là AI đoán từ ảnh; nếu sai, hãy sửa model để định giá lại.`
    : "";
  // [SỬA LỖI] Giá đồ cũ gợi ý cao hơn giá người dùng đã mua -> gần như chắc chắn AI nhận nhầm model/dung lượng: cảnh báo rõ
  const original = Number(originalPrice);
  const aboveOriginalNote = estimate.price && Number.isFinite(original) && original > 0 && estimate.price.suggested > original
    ? ` Cảnh báo: giá gợi ý cao hơn giá mua ban đầu bạn nhập (${original.toLocaleString("vi-VN")} VND). Có thể AI nhận nhầm model/dung lượng; hãy kiểm tra lại các nguồn bên dưới hoặc ghi rõ model.`
    : "";
  const noPriceMessage = "Không đủ dữ liệu giá thị trường có thể kiểm chứng để đưa ra giá. ReLoop không tự tạo giá thay thế; hãy thử lại hoặc ghi rõ tên sản phẩm.";
  const reasoning = !estimate.price
    ? (marketError || noPriceMessage)
    : fromNewPrice
      ? `Không tìm thấy tin rao bán đồ cũ cho sản phẩm này, nên giá được ước tính từ giá bán mới hiện tại trong ${estimate.stats.source_count} nguồn (trung vị ${estimate.stats.new_price_median.toLocaleString("vi-VN")} VND) nhân tỷ lệ ${estimate.stats.used_to_new_ratio} theo tình trạng. Đây là ước tính tham khảo.${assumedNote}`
      : `Giá được ước tính từ các mức giá trích xuất được trong ${estimate.stats.source_count} nguồn tham khảo phù hợp. Giá trung vị tham khảo trước điều chỉnh tình trạng: ${estimate.stats.market_median_before_condition.toLocaleString("vi-VN")} VND. Hệ số tình trạng áp dụng: ${estimate.stats.condition_multiplier}. Đây là giá rao bán tham khảo, không phải dữ liệu giao dịch đã xác minh.${keywordNote}${assumedNote}`;
  // Độ tin cậy giảm theo cả độ chắc chắn về sản phẩm và theo loại dữ liệu giá (giá mới quy đổi kém chắc hơn tin rao đồ cũ)
  const marketConfidence = !estimate.price
    ? 0.15
    : fromNewPrice
      ? Math.min(0.6, 0.3 + 0.05 * estimate.stats.new_price_count)
      : Math.min(0.95, 0.35 + 0.1 * estimate.stats.source_count + 0.05 * estimate.stats.comparable_price_count);

  return {
    is_product: true,
    product_name: product.product_name,
    brand: product.brand || null,
    model: product.model || null,
    model_assumed: modelAssumed,
    model_candidates: Array.isArray(product.model_candidates) ? product.model_candidates.slice(0, 4) : [],
    category: product.category || "khac",
    condition: defaultCondition(product),
    identification_confidence: identificationConfidence,
    price: estimate.price,
    price_basis: estimate.price ? (fromNewPrice ? "new_price_depreciated" : "used_listings") : null,
    confidence: Math.round(marketConfidence * identificationConfidence * 100) / 100,
    reasoning: reasoning + aboveOriginalNote,
    price_above_original: Boolean(aboveOriginalNote),
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
    // "service": lỗi tạm thời của dịch vụ tìm giá, người dùng chỉ cần thử lại, không cần bổ sung thông tin
    price_unavailable_reason: estimate.price ? null : (marketError ? "service" : "insufficient_data"),
    requires_more_info: !estimate.price && !marketError
  };
}
