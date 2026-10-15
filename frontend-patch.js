// Frontend integration patch for demo.html.
// Copy these functions into the existing <script> section.
// 1) Change the valuation button to onclick="runAIValuation()".
// 2) In renderAIResult(), after `const r = ai.result;`, add:
//      if (r && !r.price) return renderAIMissingPrice(r);
// 3) In the normal result template, insert ${renderAISources(r)} where you want sources displayed.
// 4) Replace the demo button in the error template with a retry button calling runAIValuation().

async function runAIValuation() {
    const ai = state.ai;

    if (!ai.images || ai.images.length === 0) {
        showToast("Vui lòng tải ảnh sản phẩm trước", "error");
        return;
    }

    ai.loading = true;
    ai.error = null;
    ai.result = null;
    renderPage();

    try {
        const response = await fetch("https://api.reloopai.id.vn/api/valuate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                images: ai.images.map(img => ({
                    base64: img.base64,
                    mediaType: img.mediaType
                })),
                note: ai.note || "",
                originalPrice: ai.originalPrice || null,
                usedFor: ai.usedFor || ""
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Không thể định giá sản phẩm");
        }
        ai.result = data;
    } catch (error) {
        ai.error = error.message || "Không thể kết nối máy chủ";
    } finally {
        ai.loading = false;
        renderPage();
    }
}

function renderAIMissingPrice(r) {
    const sources = Array.isArray(r.sources) ? r.sources : [];
    const questions = Array.isArray(r.questions) ? r.questions : [];

    return `
      <div class="bg-white rounded-xl shadow-sm p-5 space-y-4">
        <h3 class="font-bold text-gray-800">${escapeHtml(r.product_name || "Sản phẩm")}</h3>
        <p class="text-sm text-gray-700">${escapeHtml(r.reasoning || "Chưa đủ dữ liệu giá thị trường.")}</p>
        <p class="text-xs text-gray-500">Tình trạng: ${escapeHtml(r.condition?.grade || "Chưa xác định")}</p>
        ${questions.length
          ? `<div><p class="font-semibold text-sm mb-1">Cần bổ sung</p><ul class="list-disc pl-5 text-sm">${questions.map(q => `<li>${escapeHtml(q)}</li>`).join("")}</ul></div>`
          : ""}
        ${sources.length
          ? `<div><p class="font-semibold text-sm mb-1">Nguồn đã kiểm tra</p><ul class="list-disc pl-5 text-xs">${sources.map(s => `<li><a class="text-blue-700 underline" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.url)}</a></li>`).join("")}</ul></div>`
          : ""}
      </div>`;
}

function renderAISources(r) {
    const sources = Array.isArray(r.sources) ? r.sources : [];
    if (!sources.length) {
        return `<p class="text-xs text-gray-500">Không có nguồn giá được trích xuất trong lần tìm kiếm này.</p>`;
    }

    return `
      <div class="pt-3 border-t">
        <p class="font-semibold text-xs mb-2">Nguồn giá tham khảo</p>
        <ul class="space-y-2 text-xs">
          ${sources.map(s => `
            <li>
              <a class="text-blue-700 underline" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.url)}</a>
              ${Array.isArray(s.prices_vnd) && s.prices_vnd.length
                ? `<span class="text-gray-600"> — ${s.prices_vnd.map(p => formatMoney(p)).join(", ")}</span>`
                : ""}
            </li>`).join("")}
        </ul>
        <p class="text-[11px] text-gray-500 mt-2">${escapeHtml(r.market_data_note || "")}</p>
      </div>`;
}
