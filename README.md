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
   - `DATABASE_URL` và `BLOB_READ_WRITE_TOKEN`: không cần gõ tay, Vercel tự thêm khi gắn Neon và Blob (xem mục **Database**)
4. Deploy. Kiểm tra `https://<tên-project>.vercel.app/api/health` phải trả `geminiConfigured`, `marketSearchConfigured`, `databaseConfigured`, `imageStorageConfigured` đều là `true`.
5. Mỗi lần đổi biến môi trường cần **Redeploy** để có hiệu lực.

Giới hạn cần biết trên Vercel:
- Body request tối đa 4,5 MB: frontend đã nén ảnh về 1024px và chặn khi tổng dung lượng quá lớn.
- Rate limit (định giá 20 lần, đăng nhập 10 lần, thao tác ghi 60 lần / 15 phút / IP) lưu trong database nên dùng chung cho mọi instance. Database lỗi thì rate limit tạm cho qua thay vì chặn cả trang.
- Mỗi lần định giá có tối đa 55 giây; quá thời gian thì báo lỗi rõ ràng thay vì để Vercel cắt ngang.
- Không đặt `FRONTEND_ORIGIN` khi frontend và API cùng domain trên Vercel.

## Tài khoản
Có 2 loại tài khoản:
1. **Tự đăng ký** (nút **Đăng ký** màu vàng trên thanh trên cùng → trang Đăng ký riêng, code giao diện ở `public/register.js`): người mới tạo tài khoản bằng họ tên, tên đăng nhập, mật khẩu, tạo xong là đăng nhập luôn để mua hàng, đăng tin, trao đổi.
   - Lưu trong bảng `accounts` của Neon Postgres (`lib/accounts.js`), bảng tự tạo ở lần dùng đầu tiên. Mật khẩu chỉ lưu dạng băm scrypt.
   - Luôn có vai trò `user`; không ai tự đăng ký thành admin được. Đăng nhập nhanh (`DEMO_LOGIN`) không vào được tài khoản tự đăng ký.
   - Tên đăng nhập 3–30 ký tự (chữ không dấu, số, `.`, `_`), không trùng tài khoản trong `AUTH_USERS` và một số tên dành riêng (admin, root, quantri...). Mật khẩu tối thiểu 6 ký tự.
   - Giới hạn 20 lần đăng ký / giờ / IP để chặn tạo tài khoản hàng loạt.
2. **Khai báo sẵn** trong biến `AUTH_USERS` (JSON), mỗi tài khoản gồm `username`, `password`, `role` (`admin` | `user`), `name`. Dùng cho admin và tài khoản demo.

Quyền:
- **user**: đăng tin bán/trao đổi (hiện ngay trên chợ), mua hàng, gỡ tin của mình; không tự mua được tin của chính mình.
- **admin**: chỉ kiểm tra và gỡ tin vi phạm trên trang **Quản trị**, xem thống kê. Không đăng, mua, trao đổi hay xử lý đơn.
- Định giá AI và xem chợ không cần đăng nhập; đặt hàng và gửi đề nghị đổi cần đăng nhập.
- `DEMO_LOGIN=true` hiện nút đăng nhập nhanh các tài khoản trong `AUTH_USERS` (không cần mật khẩu) ở trang đăng nhập.
- Thêm/đổi mật khẩu tài khoản `AUTH_USERS`: sửa biến rồi khởi động lại server (trên Vercel: Redeploy). Phiên đăng nhập cũ của tài khoản bị đổi mật khẩu tự hết hiệu lực. Đổi `AUTH_SECRET` sẽ đăng xuất mọi người.
- **Bắt buộc đặt `AUTH_SECRET`** trên Vercel: thiếu biến này thì mọi người bị đăng xuất mỗi khi server khởi động lại.

## Database
- **Neon Postgres** (Vercel → Storage → Neon, gói Free) lưu tin đăng, đơn hàng, đề nghị trao đổi, thống kê và bộ đếm rate limit. Biến `DATABASE_URL`.
  Bảng được tạo tự động ở lần truy vấn đầu tiên (`lib/schema.js`); muốn thêm cột thì thêm câu `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` vào cuối danh sách.
- **Vercel Blob** (Vercel → Storage → Blob) lưu ảnh tin đăng; database chỉ giữ URL ảnh. Biến `BLOB_READ_WRITE_TOKEN`.
- Chạy local cũng cần hai biến này: `npx vercel env pull .env.development.local` rồi chép sang `.env` (xem DEPLOY.md, Phần 4.3).

Mua bán và trao đổi (mỗi tin là **một món** đồ cũ):
- Đặt hàng giữ chỗ món đồ ngay trong một transaction có khóa dòng: hai người không thể mua trùng một món. Giá lấy từ database, không tin giá trình duyệt gửi lên.
- Quy trình escrow: `pending` (chờ người bán xác nhận) → `confirmed` (đang giao) → `completed` (người mua bấm "Đã nhận hàng", món đồ thành "đã bán"). Trước khi hoàn tất, người mua, người bán hoặc admin đều hủy được; hủy thì món đồ quay lại chợ.
- Đổi ngang giá: người đề nghị chọn một món do chính họ đăng (đang để trao đổi), giá chênh tối đa 10% (`TRADE_TOLERANCE_PERCENT`). Chủ món chấp nhận thì cả hai món thành "đã đổi", các đề nghị khác liên quan tự bị từ chối, hai bên thấy SĐT của nhau. Không chấp nhận được khi một trong hai món đang có đơn mua.
- Không gỡ được tin đang có đơn chờ xử lý.

## Test
```bash
npm test
```
Test chạy trên Postgres trong bộ nhớ (PGlite) và Blob giả, không cần mạng hay database thật.

## Hạn mức và chi phí
Mỗi lần định giá tốn 2 lần gọi Gemini (nhận diện ảnh + lọc kết quả) và 2 truy vấn Tavily.
- Tavily: 1.000 credit/tháng miễn phí. `basic` = 1 credit/truy vấn (~500 lần định giá/tháng), `advanced` = 2 credit (~250 lần). Hết credit thì API vẫn trả kết quả nhận diện, kèm `price: null` và thông báo.
- Gemini gói Free: giới hạn số yêu cầu/phút và /ngày tùy model, xem tại https://aistudio.google.com/rate-limit. Hạn mức ngày reset lúc 0h giờ Thái Bình Dương (khoảng 14h–15h giờ Việt Nam) và tính theo project, không theo API key.
- `gemini-2.5-*` đã đóng với người dùng mới; dùng dòng Gemini 3.x.
- Dữ liệu gửi lên ở gói Free của Gemini có thể được Google dùng để cải thiện sản phẩm.

## API
`POST /api/valuate` nhận `images: [{ base64, mediaType }]` (1–3 ảnh), `note`, `originalPrice`, `usedFor`.
Chỉ định giá khi AI xác định được model với `identification_confidence` ≥ 0,6; nếu chưa chắc, API trả `price: null`,
`price_unavailable_reason: "missing_model"` kèm câu hỏi để người dùng ghi rõ model/dung lượng.

| API | Ai dùng | Việc |
|---|---|---|
| `POST /api/auth/register` | mọi người | `{ name, username, password }` → tạo tài khoản và đăng nhập luôn; 409 nếu trùng tên |
| `POST /api/auth/login` | mọi người | `{ username, password }` |
| `GET /api/listings` | mọi người | Tin còn bán (+ tin của mình; admin thấy hết để kiểm tra) |
| `POST /api/listings` | đăng nhập | Đăng tin (`image` là data URL, được tải lên Blob) |
| `DELETE /api/listings/:id` | chủ tin, admin | Gỡ tin |
| `POST /api/orders` | đăng nhập | `{ items: [{ listingId, variant }], phone, address, note }`; 409 kèm `unavailable` nếu có món không còn |
| `GET /api/orders` | đăng nhập | `{ purchases, sales }` |
| `PATCH /api/orders/:id` | người trong đơn, admin | `{ action: "confirm" \| "complete" \| "cancel" }` |
| `POST /api/listings/:id/offers` | đăng nhập | `{ offeredListingId, phone, message }` |
| `GET /api/offers` | đăng nhập | `{ received, sent }` |
| `PATCH /api/offers/:id` | chủ tin / người gửi | `{ action: "accept" | "reject" | "withdraw", phone }` (`phone` bắt buộc khi accept) |

Lỗi luôn trả JSON `{ "error": "..." }` bằng tiếng Việt.

## Quan trọng về chất lượng giá
- Giá trên trang rao bán thường không phải giá giao dịch thành công.
- Search snippet có thể không chứa giá, có giá cũ, hoặc có giá phụ kiện. Backend cố gắng chọn kết quả tương đồng và chỉ lấy giá có mặt trong văn bản, nhưng không thể bảo đảm trích xuất đúng trong mọi trường hợp.
- Hệ số tình trạng trong `getConditionMultiplier()` chỉ là giả định khởi đầu để demo kỹ thuật; cần hiệu chỉnh theo danh mục và dữ liệu giao dịch thật. Đừng trình bày nó như một định luật thị trường.
- Nếu không có đủ ít nhất hai giá trích xuất được, API trả `price: null`, không tự sinh giá.
- Bản này là nền tảng MVP, chưa thay thế kiểm thử bảo mật, giám sát chi phí, cache, cơ sở dữ liệu, chống lạm dụng và đánh giá độ chính xác trước khi đưa vào sản xuất.
- Không bao giờ đưa API key vào HTML/frontend hoặc commit `.env` lên Git.
