// Định giá AI: nhận diện sản phẩm từ ảnh, tìm giá thị trường, ước tính khoảng giá.
import { httpError } from "./http-error.js";
import { callGemini, parseJsonFromText } from "./gemini.js";
import { searchMarketListings } from "./market.js";
import { buildPriceEstimate } from "./pricing.js";
import { trackStat } from "./stats.js";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
// Khớp với giới hạn ở frontend: tổng base64 các ảnh phải nằm trong body 4 MB của máy chủ
export const MAX_TOTAL_IMAGE_CHARS = 3.8 * 1024 * 1024;

// Chưa chắc chắn model thì không định giá: tìm "Apple iPhone" sẽ trộn giá iPhone 11 tới 17 Pro Max
const MIN_IDENTIFICATION_CONFIDENCE = 0.6;
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
  const prompt = `Bạn là chuyên gia nhận diện sản phẩm đồ đã qua sử dụng tại Việt Nam.
Phân tích CHỈ những gì có căn cứ từ ảnh và thông tin người dùng. Không tự đoán model, năm sản xuất hay giá.
Nếu ghi chú của người dùng nêu rõ thương hiệu/model và không mâu thuẫn với ảnh, hãy dùng đúng thương hiệu/model đó
(điền vào "brand", "model" và đưa vào "product_name", ví dụ "Tai nghe Sony WH-1000XM4").
Nếu cả ảnh lẫn ghi chú đều chưa đủ căn cứ xác định model, hãy ghi null và nêu câu hỏi cần hỏi người dùng.
Phân biệt kỹ các phiên bản trông gần giống nhau dựa trên chi tiết nhìn thấy (số lượng/bố cục camera, kích thước, màu đặc trưng, chữ trên máy),
ví dụ iPhone 17 / 17 Pro / 17 Pro Max / iPhone Air. Dung lượng, RAM thường không nhìn thấy từ ảnh: không đoán, hãy hỏi người dùng.
identification_confidence là mức chắc chắn về ĐÚNG model (không phải về loại sản phẩm): chỉ đặt từ 0.6 trở lên khi
phân biệt được model với các phiên bản gần giống, nhờ chi tiết nhìn thấy rõ hoặc ghi chú của người dùng.
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

  const identificationConfidence = clamp01(product.identification_confidence);
  if (!product.model) {
    return needMoreInfo(product, identificationConfidence,
      "Chưa xác định được model chính xác nên chưa thể tìm giá tương đương (các phiên bản khác nhau có giá rất khác nhau). Vui lòng ghi rõ model, dung lượng vào ô Ghi chú.",
      "Model và dung lượng chính xác của sản phẩm là gì?");
  }
  if (identificationConfidence < MIN_IDENTIFICATION_CONFIDENCE) {
    return needMoreInfo(product, identificationConfidence,
      `AI đoán đây là ${product.model} nhưng chưa chắc chắn (độ tin cậy ${Math.round(identificationConfidence * 100)}%). Hãy xác nhận model và dung lượng trong ô Ghi chú để giá không bị lẫn với phiên bản khác.`,
      `Sản phẩm có đúng là ${product.model} không? Dung lượng bao nhiêu?`);
  }

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
  const estimate = buildPriceEstimate(product, market.listings, originalPrice);

  const sources = estimate.listings.map((listing) => ({
    title: listing.title,
    url: listing.url,
    prices_vnd: listing.prices,
    snippet: listing.snippet.slice(0, 500)
  }));

  const keywordNote = market.filterMethod === "keyword"
    ? " Lưu ý: AI lọc nguồn đang tạm hết lượt nên nguồn được lọc theo từ khóa tên/model, hãy kiểm tra lại các nguồn bên dưới."
    : "";
  const noPriceMessage = "Không đủ dữ liệu giá thị trường có thể kiểm chứng để đưa ra giá. ReLoop không tự tạo giá thay thế; hãy thử lại hoặc bổ sung model chính xác.";
  // Độ tin cậy giảm theo cả độ chắc chắn về model, không chỉ theo số nguồn giá
  const marketConfidence = estimate.price
    ? Math.min(0.95, 0.35 + 0.1 * estimate.stats.source_count + 0.05 * estimate.stats.comparable_price_count)
    : 0.15;

  return {
    is_product: true,
    product_name: product.product_name,
    brand: product.brand || null,
    model: product.model || null,
    category: product.category || "khac",
    condition: defaultCondition(product),
    identification_confidence: identificationConfidence,
    price: estimate.price,
    confidence: Math.round(marketConfidence * identificationConfidence * 100) / 100,
    reasoning: estimate.price
      ? `Giá được ước tính từ các mức giá trích xuất được trong ${estimate.stats.source_count} nguồn tham khảo phù hợp. Giá trung vị tham khảo trước điều chỉnh tình trạng: ${estimate.stats.market_median_before_condition.toLocaleString("vi-VN")} VND. Hệ số tình trạng áp dụng: ${estimate.stats.condition_multiplier}. Đây là giá rao bán tham khảo, không phải dữ liệu giao dịch đã xác minh.${keywordNote}`
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
    // "service": lỗi tạm thời của dịch vụ tìm giá, người dùng chỉ cần thử lại, không cần bổ sung thông tin
    price_unavailable_reason: estimate.price ? null : (marketError ? "service" : "insufficient_data"),
    requires_more_info: !estimate.price && !marketError
  };
}
