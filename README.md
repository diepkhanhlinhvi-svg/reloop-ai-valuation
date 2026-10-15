# ReLoop AI Valuation API

Backend mẫu Node.js/Express cho luồng định giá ảnh:
1. Gemini phân tích ảnh và nhận diện sản phẩm/tình trạng nhìn thấy được.
2. Tavily tìm kiếm web, ưu tiên kết quả tại Việt Nam.
3. Gemini chọn các kết quả có vẻ đúng sản phẩm; Gemini không được phép tự bịa giá.
4. Backend trích xuất các giá hiển thị rõ từ kết quả, loại ngoại lệ và tính trung vị.
5. Hệ số tình trạng được áp dụng bằng code xác định; API trả về URL nguồn để người dùng kiểm tra.

## Yêu cầu
- Node.js 20+ (khuyến nghị)
- Gemini API key
- Tavily API key
- Tài khoản/credit có thể phát sinh chi phí theo mức sử dụng của nhà cung cấp.

## Cài đặt
```bash
npm install
cp .env.example .env
```
Điền `GEMINI_API_KEY` và `TAVILY_API_KEY` trong `.env`, sau đó:
```bash
npm run dev
```
Kiểm tra:
```bash
curl http://localhost:3000/api/health
```

## Tích hợp với website hiện tại
Frontend hiện gọi:
```js
fetch("/api/valuate", { ... })
```
Đường dẫn này phù hợp nếu frontend và backend được phục vụ cùng origin. Nếu frontend nằm ở domain khác:
- đặt `FRONTEND_ORIGIN` bằng origin chính xác của frontend;
- dùng URL backend đầy đủ trong `fetch`, ví dụ `https://api.example.com/api/valuate`;
- cấu hình HTTPS và CORS theo domain triển khai.

Frontend đang gửi `images: [{ base64, mediaType }]`, `note`, `originalPrice`, `usedFor`.
Định dạng này tương thích với backend này.

## Sửa frontend cần thiết
1. Đổi nút `onclick="runAIDemo()"` thành `onclick="runAIValuation()"`.
2. Thêm hàm `runAIValuation()` như trong `frontend-patch.js`.
3. Xóa nút demo và không gọi `runAIDemo()` khi API lỗi. Lỗi API phải hiển thị lỗi thật.
4. `renderAIResult()` hiện truy cập `r.price.suggested`, `r.price.min`, `r.price.max`. Khi backend trả `price: null`, cần thêm nhánh hiển thị yêu cầu bổ sung thông tin hoặc thiếu dữ liệu thị trường. Xem `frontend-patch.js`.

## Quan trọng về chất lượng giá
- Giá trên trang rao bán thường không phải giá giao dịch thành công.
- Search snippet có thể không chứa giá, có giá cũ, hoặc có giá phụ kiện. Backend cố gắng chọn kết quả tương đồng và chỉ lấy giá có mặt trong văn bản, nhưng không thể bảo đảm trích xuất đúng trong mọi trường hợp.
- Hệ số tình trạng trong `getConditionMultiplier()` chỉ là giả định khởi đầu để demo kỹ thuật; cần hiệu chỉnh theo danh mục và dữ liệu giao dịch thật. Đừng trình bày nó như một định luật thị trường.
- Nếu không có đủ ít nhất hai giá trích xuất được, API trả `price: null`, không tự sinh giá.
- Bản này là nền tảng MVP, chưa thay thế kiểm thử bảo mật, giám sát chi phí, cache, cơ sở dữ liệu, chống lạm dụng và đánh giá độ chính xác trước khi đưa vào sản xuất.
- Không bao giờ đưa API key vào HTML/frontend hoặc commit `.env` lên Git.
