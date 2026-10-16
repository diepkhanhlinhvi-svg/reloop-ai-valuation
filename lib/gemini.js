import { GoogleGenAI } from "@google/genai";
import { httpError } from "./http-error.js";
import { trackStat } from "./stats.js";

// gemini-2.5-* đã đóng với người dùng mới; dùng dòng Gemini 3.x
export const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// Gói Free giới hạn số lượt/ngày RIÊNG cho từng model (vd. gemini-3.6-flash chỉ 20 lượt/ngày),
// nên khi model chính hết lượt hoặc quá tải thì chuyển lần lượt sang các model dự phòng.
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ||
  "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-3.7-flash")
  .split(",").map((m) => m.trim()).filter(Boolean);
const MODEL_CHAIN = [...new Set([MODEL, ...FALLBACK_MODELS])];

// Còn ít hơn chừng này thời gian thì không bắt đầu gọi model mới (sẽ bị cắt giữa chừng)
const MIN_CALL_MS = 4000;

// Tắt cơ chế tự thử lại của SDK (mặc định 5 lần, chờ tới 60 giây/lần) để chuyển model ngay thay vì treo.
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { retryOptions: { attempts: 1 } } })
  : null;

export const geminiConfigured = Boolean(ai);

export function parseJsonFromText(text) {
  if (!text) throw new Error("AI không trả về nội dung.");
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI không trả về JSON hợp lệ.");
    return JSON.parse(match[0]);
  }
}

// Model tạm bỏ qua: hết lượt trong ngày (429), không tồn tại (404) hoặc vừa quá tải (503).
// Lưu trong bộ nhớ của từng instance; mất khi khởi động lại thì chỉ tốn thêm một lần gọi thử.
const modelCooldownUntil = new Map();

function retryDelayMs(error) {
  const match = String(error?.message || "").match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
  return match ? Number(match[1]) * 1000 : null;
}

function cooldownMs(status, error) {
  if (status === 429) return Math.min(retryDelayMs(error) ?? 60 * 60 * 1000, 24 * 60 * 60 * 1000);
  if (status === 404) return 24 * 60 * 60 * 1000;
  return 60 * 1000; // quá tải / hết thời gian chờ: thử lại model này sau 1 phút
}

// Tắt "suy nghĩ" để trả lời nhanh và JSON không bị cắt cụt. Mỗi đời model nhận một kiểu tùy chọn khác nhau
// (một số model 3.x lite báo lỗi 400 với thinkingBudget), nên gặp 400 thì thử kiểu còn lại.
const THINKING_VARIANTS = [{ thinkingBudget: 0 }, { thinkingLevel: "minimal" }];

function timeoutError() {
  return httpError(504, "AI phản hồi quá lâu. Vui lòng thử lại sau ít phút.");
}

// Gọi Gemini, tự chuyển sang model dự phòng khi model hiện tại hết lượt hoặc quá tải.
// preferLite: ưu tiên model "lite" (đủ cho việc đơn giản như lọc kết quả) để dành lượt model mạnh cho nhận diện ảnh.
// deadline: mốc thời gian (ms) phải xong cả yêu cầu; không thử thêm model khi không còn đủ thời gian.
// Chỉ báo lỗi khi mọi model đều không dùng được.
export async function callGemini(request, { timeoutMs = 30000, preferLite = false, deadline = Infinity } = {}) {
  if (!ai) throw httpError(503, "Chưa cấu hình GEMINI_API_KEY.");
  const now = Date.now();
  const chain = preferLite
    ? [...MODEL_CHAIN.filter((m) => m.includes("lite")), ...MODEL_CHAIN.filter((m) => !m.includes("lite"))]
    : MODEL_CHAIN;
  const available = chain.filter((m) => (modelCooldownUntil.get(m) || 0) <= now);
  // Mọi model đều đang tạm nghỉ thì vẫn thử lại toàn bộ, thay vì báo lỗi ngay
  const models = available.length ? available : chain;
  const statuses = [];

  for (const model of models) {
    for (const thinkingConfig of THINKING_VARIANTS) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_CALL_MS) throw timeoutError();
      trackStat("gemini_calls");
      try {
        const response = await ai.models.generateContent({
          ...request,
          model,
          config: { ...request.config, thinkingConfig, httpOptions: { timeout: Math.min(timeoutMs, remaining) } }
        });
        modelCooldownUntil.delete(model);
        return response;
      } catch (error) {
        const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError" || /timed? ?out|aborted/i.test(String(error?.message));
        const status = timedOut ? 504 : Number(error?.status) || 0;
        if (status === 401 || status === 403) {
          console.error("Gemini request rejected:", error?.message);
          throw httpError(502, "Gemini từ chối yêu cầu. Kiểm tra lại GEMINI_API_KEY.");
        }
        if (![400, 404, 429, 500, 503, 504].includes(status)) throw error;
        if (status === 400 && thinkingConfig !== THINKING_VARIANTS.at(-1)) continue;
        console.warn(`Gemini ${model} lỗi ${status}, chuyển model khác:`, String(error?.message).slice(0, 200));
        // 400 có thể do chính yêu cầu (ảnh hỏng), không phải do model, nên không cho model tạm nghỉ
        if (status !== 400) modelCooldownUntil.set(model, Date.now() + cooldownMs(status, error));
        statuses.push(status);
        break;
      }
    }
  }

  if (statuses.length && statuses.every((s) => s === 400)) {
    throw httpError(422, "AI không xử lý được ảnh/yêu cầu này. Hãy thử ảnh khác.");
  }
  if (statuses.includes(429)) {
    throw httpError(429, "Đã hết lượt dùng AI miễn phí trong hôm nay. Hạn mức tự làm mới vào khoảng 14h–15h (giờ Việt Nam).");
  }
  throw httpError(503, "Dịch vụ AI đang quá tải. Vui lòng thử lại sau ít phút.");
}
