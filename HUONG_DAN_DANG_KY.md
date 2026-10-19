# Hướng dẫn cập nhật chức năng ĐĂNG KÝ TÀI KHOẢN cho ReLoop

Bản này đã có sẵn chức năng đăng ký. Người mới bấm nút **Đăng ký** (màu vàng, góc trên phải),
tạo tài khoản, rồi đăng nhập và mua hàng được ngay.

## Các file liên quan đến đăng ký

| File | Vai trò |
|---|---|
| `public/register.js` | **Mới.** Trang Đăng ký (form họ tên, tên đăng nhập, mật khẩu, nhập lại mật khẩu) |
| `lib/accounts.js` | **Mới.** Lưu tài khoản vào database Neon (bảng `accounts` tự tạo), mã hóa mật khẩu |
| `routes/auth.js` | Thêm API `POST /api/auth/register` |
| `auth.js` | Cho phép đăng nhập bằng tài khoản vừa đăng ký |
| `public/app.js` | Thêm nút Đăng ký trên thanh trên cùng, ở trang Thanh toán và Kênh Người Bán |
| `public/index.html` | Nạp thêm file `register.js` |
| `test/register.test.js` | **Mới.** Kiểm thử tự động cho phần đăng ký |

## Các bước cập nhật lên web

1. Đổi tên thư mục dự án cũ thành `reloop-ai-valuation-main_cu` (để dự phòng). Giữ lại file `.env`
   và thư mục `.vercel` ở trong đó, bước 3 cần chép lại hai thứ này.
2. Giải nén bản mới, được thư mục `reloop-ai-valuation-main`.
3. Chép **file `.env`** và **thư mục `.vercel`** từ thư mục cũ sang thư mục mới
   (đây là file ẩn: trong VS Code vẫn thấy; trên Windows bật View → Hidden items).
4. Mở thư mục mới trong VS Code → Terminal → chạy lần lượt:
   ```
   npm install
   npm test
   ```
   Kết quả phải có `# fail 0`.
5. Chạy thử trên máy: `npm run dev` → mở http://localhost:3000 → thấy nút **Đăng ký** màu vàng là đúng.
   Tắt bằng Ctrl+C.
6. Đưa lên web: `npx vercel --prod`.
7. Mở link web → nhấn **Ctrl+F5** → làm theo DEPLOY.md, Phần 7.2, bước 10–11 để thử đăng ký và mua hàng.

Không cần thêm biến môi trường mới. Chỉ cần `DATABASE_URL` (đã có từ khi gắn Neon) và `AUTH_SECRET` (đã có).
