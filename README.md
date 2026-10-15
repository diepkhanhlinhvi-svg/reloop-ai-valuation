# ReLoop AI Valuation

Website chợ đồ cũ ReLoop (`public/index.html`) kèm backend Node.js/Express (`server.js`) cho luồng định giá ảnh:
1. Gemini phân tích ảnh và nhận diện sản phẩm/tình trạng nhìn thấy được.
2. Tavily tìm kiếm web, ưu tiên kết quả tại Việt Nam.
3. Gemini chọn các kết quả có vẻ đúng sản phẩm; Gemini không được phép tự bịa giá.
4. Backend trích xuất các giá hiển thị rõ từ kết quả, loại ngoại lệ và tính trung vị.
5. Hệ số tình trạng được áp dụng bằng code xác định; API trả về URL nguồn để người dùng kiểm tra.

## Yêu cầu
- Node.js 20+
- Gemini API key: https://aistudio.google.com/apikey (gói Free đủ dùng cho nhận diện ảnh)
- Tavily API key: https://app.tavily.com (1.000 credit/tháng miễn phí, không cần thẻ)

## Chạy trên máy
```bash
npm install
cp .env.example .env
```
Điền `GEMINI_API_KEY` và `TAVILY_API_KEY` trong `.env`, sau đó:
```bash
npm run dev
```
Mở http://localhost:3000 để dùng website, hoặc kiểm tra API:
```bash
curl http://localhost:3000/api/health
```

## Triển khai lên Vercel
> Hướng dẫn chi tiết từng bước cho người mới: xem [DEPLOY.md](DEPLOY.md).

Project đã được cấu hình theo chuẩn "Express on Vercel" (không cần `vercel.json`):
- `server.js` export `app` → Vercel chạy thành một Vercel Function.
- `public/` được Vercel CDN phục vụ (trên Vercel, `express.static()` bị bỏ qua).
- Frontend gọi `/api/valuate` cùng domain nên không cần cấu hình CORS.

Các bước:
1. Đẩy code lên GitHub (file `.env` đã nằm trong `.gitignore`, sẽ không bị đẩy lên).
2. Vào https://vercel.com/new → Import repository này. Framework Preset để mặc định (Vercel tự nhận Express).
3. Trước khi bấm Deploy, mở **Environment Variables** và thêm:
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL` = `gemini-3.6-flash`
   - `TAVILY_API_KEY`
   - `TAVILY_SEARCH_DEPTH` = `basic`
   - `AUTH_USERS` và `AUTH_SECRET` (copy y nguyên từ `.env`, xem mục **Tài khoản** bên dưới)
   - `UPSTASH_REDIS_REST_URL` và `UPSTASH_REDIS_REST_TOKEN` (xem mục **Lưu tin đăng trên Vercel**)
4. Deploy. Kiểm tra `https://<tên-project>.vercel.app/api/health` phải trả `geminiConfigured: true` và `marketSearchConfigured: true`.
5. Mỗi lần đổi biến môi trường cần **Redeploy** để có hiệu lực.

Giới hạn cần biết trên Vercel:
- Body request tối đa 4,5 MB: frontend đã nén ảnh về 1024px và chặn khi tổng dung lượng quá lớn.
- Rate limit trong `server.js` (20 lần/15 phút/IP) lưu trong bộ nhớ của từng instance nên chỉ mang tính tương đối. Để chống spam thật sự, bật thêm rate limit trong **Vercel Firewall**.
- Không đặt `FRONTEND_ORIGIN` khi frontend và API cùng domain trên Vercel.

## Tài khoản
Không có đăng ký: tài khoản khai báo sẵn trong biến `AUTH_USERS` (JSON), mỗi tài khoản gồm `username`, `password`, `role` (`admin` | `user`), `name`.
- **user**: đăng tin bán/trao đổi (chờ admin duyệt mới hiện lên chợ), gỡ tin của mình.
- **admin**: tin đăng hiện ngay; trang **Quản trị** để duyệt/từ chối/gỡ mọi tin và xem thống kê (lượt định giá, lượt gọi Gemini/Tavily, đăng nhập, số tin).
- Mua hàng, định giá AI không cần đăng nhập.
- `DEMO_LOGIN=true` hiện nút đăng nhập nhanh từng tài khoản (không cần mật khẩu) ở trang đăng nhập. Chỉ bật khi chạy thử trên máy, **không** thêm biến này lên Vercel vì ai cũng vào được admin.
- Thêm/đổi mật khẩu: sửa `AUTH_USERS` rồi khởi động lại server (trên Vercel: Redeploy). Đổi `AUTH_SECRET` sẽ đăng xuất mọi người.

## Lưu tin đăng trên Vercel
Vercel không giữ file giữa các lần chạy, nên tin đăng và thống kê cần Redis:
1. Vercel → project → **Storage** → **Upstash for Redis** (gói Free), hoặc tạo database tại https://upstash.com.
2. Thêm `UPSTASH_REDIS_REST_URL` và `UPSTASH_REDIS_REST_TOKEN` (tích hợp Vercel tự thêm `KV_REST_API_URL`/`KV_REST_API_TOKEN`, cũng được nhận).
3. Redeploy. `/api/health` phải trả `"storage": "redis"`.

Chạy local không có Redis thì dữ liệu lưu vào `data/db.json` (đã nằm trong `.gitignore`). Trên Vercel mà thiếu Redis, dữ liệu chỉ nằm trong bộ nhớ và sẽ mất; trang Quản trị sẽ hiện cảnh báo.

## Hạn mức và chi phí
Mỗi lần định giá tốn 2 lần gọi Gemini (nhận diện ảnh + lọc kết quả) và 2 truy vấn Tavily.
- Tavily: 1.000 credit/tháng miễn phí. `basic` = 1 credit/truy vấn (~500 lần định giá/tháng), `advanced` = 2 credit (~250 lần). Hết credit thì API vẫn trả kết quả nhận diện, kèm `price: null` và thông báo.
- Gemini gói Free: giới hạn số yêu cầu/phút và /ngày tùy model, xem tại https://aistudio.google.com/rate-limit. Hạn mức ngày reset lúc 0h giờ Thái Bình Dương (khoảng 14h–15h giờ Việt Nam) và tính theo project, không theo API key.
- `gemini-2.5-*` đã đóng với người dùng mới; dùng dòng Gemini 3.x.
- Dữ liệu gửi lên ở gói Free của Gemini có thể được Google dùng để cải thiện sản phẩm.

## API
`POST /api/valuate` nhận `images: [{ base64, mediaType }]` (1–3 ảnh), `note`, `originalPrice`, `usedFor`.
Lỗi luôn trả JSON `{ "error": "..." }` bằng tiếng Việt.

## Quan trọng về chất lượng giá
- Giá trên trang rao bán thường không phải giá giao dịch thành công.
- Search snippet có thể không chứa giá, có giá cũ, hoặc có giá phụ kiện. Backend cố gắng chọn kết quả tương đồng và chỉ lấy giá có mặt trong văn bản, nhưng không thể bảo đảm trích xuất đúng trong mọi trường hợp.
- Hệ số tình trạng trong `getConditionMultiplier()` chỉ là giả định khởi đầu để demo kỹ thuật; cần hiệu chỉnh theo danh mục và dữ liệu giao dịch thật. Đừng trình bày nó như một định luật thị trường.
- Nếu không có đủ ít nhất hai giá trích xuất được, API trả `price: null`, không tự sinh giá.
- Bản này là nền tảng MVP, chưa thay thế kiểm thử bảo mật, giám sát chi phí, cache, cơ sở dữ liệu, chống lạm dụng và đánh giá độ chính xác trước khi đưa vào sản xuất.
- Không bao giờ đưa API key vào HTML/frontend hoặc commit `.env` lên Git.
