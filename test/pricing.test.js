import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNewPriceEstimate, buildPriceEstimate, extractPrices, normalizeText } from "../lib/pricing.js";
import { identificationGate } from "../lib/valuation.js";

test("đồ thông dụng không có model vẫn được định giá, không hỏi lại", () => {
  const gate = identificationGate({ model_matters: false, model: null, identification_confidence: 0.8 });
  assert.equal(gate.action, "price");
  assert.equal(gate.modelAssumed, false);
});

test("đồ có model mà AI chưa chắc: vẫn định giá theo model AI đoán, đánh dấu để người dùng sửa", () => {
  const gate = identificationGate({ model_matters: true, model: "iPhone 17 Pro", identification_confidence: 0.5 });
  assert.equal(gate.action, "price");
  assert.equal(gate.modelAssumed, true);
  assert.equal(identificationGate({ model_matters: true, model: "iPhone 17 Pro", identification_confidence: 0.9 }).modelAssumed, false);
});

test("chỉ hỏi lại khi không đoán được model hoặc không nhận ra sản phẩm", () => {
  assert.equal(identificationGate({ model_matters: true, model: null, identification_confidence: 0.9 }).action, "ask");
  assert.equal(identificationGate({ model_matters: false, identification_confidence: 0.1 }).action, "ask");
});

test("extractPrices nhận giá đồ rẻ vài nghìn đồng", () => {
  assert.deepEqual(extractPrices("Bút lông dầu Thiên Long giá 8.000đ"), [8_000]);
  assert.deepEqual(extractPrices("chỉ 5k một cây"), [5_000]);
});

test("không có tin rao đồ cũ thì ước tính từ giá bán mới theo tình trạng", () => {
  const sources = [
    { title: "A", url: "https://a", content: "", prices: [], newPrices: [8_000] },
    { title: "B", url: "https://b", content: "", prices: [], newPrices: [9_000, 10_000] }
  ];
  assert.equal(buildPriceEstimate({}, sources, null).price, null, "không có giá đồ cũ");
  const estimate = buildNewPriceEstimate({ visible_condition: { grade: "Tốt" } }, sources, null);
  assert.equal(estimate.stats.new_price_median, 9_000);
  assert.equal(estimate.price.suggested, 6_000); // 9.000 × 0,65 = 5.850 → làm tròn 500đ
  assert.ok(estimate.price.min <= estimate.price.suggested && estimate.price.suggested <= estimate.price.max);
});

test("extractPrices đọc đúng các cách viết giá phổ biến", () => {
  const cases = [
    ["iPhone 17 256GB giá 20.990.000đ", [20_990_000]],
    ["Bán 8,5 triệu", [8_500_000]],
    ["còn 11 tr fix nhẹ", [11_000_000]],
    ["1.5tr", [1_500_000]],
    ["Tai nghe 390k", [390_000]],
    ["Giá: 15500000", [15_500_000]],
    ["VND 4.200.000", [4_200_000]],
    ["pin 85%, 128GB 7.500.000đ", [7_500_000]],
    ["8.500.000 ₫", [8_500_000]]
  ];
  for (const [text, expected] of cases) {
    assert.deepEqual(extractPrices(text), expected, text);
  }
});

test("extractPrices nhân đúng đơn vị khi số có dấu chấm hàng nghìn", () => {
  // Trước đây đọc thành 12.500 đồng
  assert.deepEqual(extractPrices("giá 12.500k"), [12_500_000]);
});

test("extractPrices không gộp hai số đứng cạnh nhau", () => {
  // Trước đây thành "8.500.0009.000.000" và mất cả hai giá
  assert.deepEqual(extractPrices("8.500.000đ 9.000.000đ"), [8_500_000, 9_000_000]);
});

test("extractPrices bỏ giá máy mới, giá gạch ngang và số tiền giảm", () => {
  assert.deepEqual(extractPrices("giá máy mới: 25.000.000đ, cũ 18.000.000đ"), [18_000_000]);
  assert.deepEqual(extractPrices("~~22.000.000đ~~ 19.500.000đ"), [19_500_000]);
  assert.deepEqual(extractPrices("giảm 500.000đ còn 7.990.000 ₫"), [7_990_000]);
  assert.deepEqual(extractPrices("giảm 2 triệu, còn 9 triệu"), [9_000_000]);
});

test("extractPrices bỏ qua số không phải giá", () => {
  assert.deepEqual(extractPrices("giá 2024"), []);
  assert.deepEqual(extractPrices("iPhone 17 Pro Max 256GB"), []);
  assert.deepEqual(extractPrices(""), []);
});

test("normalizeText bỏ dấu và giữ chữ đ", () => {
  assert.equal(normalizeText("Điện thoại Ốp lưng"), "dien thoai op lung");
});

test("buildPriceEstimate tính trung vị, loại giá lệch và áp hệ số tình trạng", () => {
  const product = { visible_condition: { grade: "Khá" } };
  const sources = [
    { title: "A", url: "https://a", content: "", prices: [10_000_000, 10_500_000] },
    { title: "B", url: "https://b", content: "", prices: [11_000_000, 95_000_000] }
  ];
  const estimate = buildPriceEstimate(product, sources, null);
  assert.equal(estimate.stats.comparable_price_count, 3, "giá 95 triệu bị loại");
  assert.equal(estimate.stats.market_median_before_condition, 10_500_000);
  assert.equal(estimate.price.suggested, Math.round(10_500_000 * 0.88 / 1000) * 1000);
  assert.ok(estimate.price.min <= estimate.price.suggested && estimate.price.suggested <= estimate.price.max);
});

test("buildPriceEstimate không tự tạo giá khi thiếu dữ liệu", () => {
  const estimate = buildPriceEstimate({}, [{ title: "A", url: "https://a", content: "", prices: [5_000_000] }], null);
  assert.equal(estimate.price, null);
});
