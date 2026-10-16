# Hướng dẫn đưa ReLoop lên Vercel (từng bước, cho người mới)

Làm xong hướng dẫn này bạn sẽ có một đường link dạng `https://reloop-ai-valuation.vercel.app` mà ai cũng mở được.
Tổng thời gian: khoảng 20–30 phút. Không tốn tiền (dùng gói miễn phí).

> **Quy ước:** ô có chữ `như thế này` là lệnh để gõ hoặc chữ để copy. "Terminal" là cửa sổ dòng lệnh:
> trong VS Code bấm menu **Terminal → New Terminal**.

---

## Phần 0. Chuẩn bị (chỉ làm 1 lần)

| Cần có | Kiểm tra thế nào |
|---|---|
| Node.js 20 trở lên | Gõ `node -v` trong Terminal, phải ra `v20...` hoặc cao hơn. Nếu báo lỗi: tải bản **LTS** tại https://nodejs.org rồi cài |
| Code chạy được trên máy | Gõ `npm install` rồi `npm run dev`, mở http://localhost:3000 thấy trang web là được. Bấm `Ctrl + C` để tắt |
| File `.env` đã điền đủ key | Mở file `.env` ở thư mục dự án, phải có `GEMINI_API_KEY`, `TAVILY_API_KEY`, `AUTH_USERS`, `AUTH_SECRET` |
| Một email hoặc tài khoản GitHub | Để tạo tài khoản Vercel |

> ⚠️ **Không bao giờ** gửi file `.env` cho ai, không chụp màn hình nó, không đưa lên GitHub.
> Dự án đã có `.gitignore` và `.vercelignore` chặn file này, bạn không cần làm gì thêm.

---

## Phần 1. Tạo tài khoản Vercel

1. Mở https://vercel.com/signup
2. Chọn **Hobby** (miễn phí). Ô tên điền tên bạn.
3. Bấm **Continue with GitHub** (khuyên dùng) hoặc **Continue with Email**, làm theo hướng dẫn để xác nhận.
4. Khi thấy trang **Dashboard** (bảng điều khiển) là xong. Nếu Vercel hỏi "Import Git Repository", **bỏ qua**, đóng trang đó lại.

> Gói Hobby chỉ dành cho dự án cá nhân, không thương mại. Nếu sau này dùng để kinh doanh, cần nâng lên gói Pro.

---

## Phần 2. Đưa code lên Vercel lần đầu

Cách này đưa code thẳng từ máy bạn lên Vercel, **không cần GitHub**.

### Bước 2.1 – Mở Terminal ở đúng thư mục dự án

Trong VS Code, mở thư mục `reloop-ai-valuation`, rồi mở Terminal. Gõ:

```
dir
```

Phải thấy các file `server.js`, `package.json`, thư mục `public`. Nếu không thấy, bạn đang ở sai thư mục.

### Bước 2.2 – Đăng nhập Vercel trên máy

```
npx vercel login
```

- Lần đầu máy hỏi `Need to install the following packages: vercel... Ok to proceed? (y)` → gõ `y` rồi Enter.
- Terminal hiện một đường link và/hoặc tự mở trình duyệt. Trên trình duyệt bấm **Confirm / Allow** để cho phép.
- Terminal báo `Congratulations! You are now signed in` là xong.

### Bước 2.3 – Tạo project và deploy thử

```
npx vercel
```

Vercel sẽ hỏi lần lượt. Trả lời như sau (dùng phím mũi tên và Enter):

| Vercel hỏi | Trả lời |
|---|---|
| `Set up and deploy "...reloop-ai-valuation"?` | `Y` (Enter) |
| `Which scope should contain your project?` | Chọn tên tài khoản của bạn |
| `Link to existing project?` | `N` |
| `What's your project's name?` | `reloop-ai-valuation` (Enter). Tên này sẽ thành link web, chỉ dùng chữ thường, số, dấu `-` |
| `In which directory is your code located?` | `./` (Enter) |
| `Want to modify these settings?` | `N` (Vercel tự nhận ra đây là Express) |

Chờ 1–2 phút. Terminal in ra một link **Preview** (bản xem thử). Lúc này web **chưa dùng được**
vì chưa có key. Làm tiếp Phần 3.

> Lệnh này tạo thêm thư mục `.vercel` trong dự án (lưu thông tin project). Đừng xóa nó, đừng sửa nó.

---

## Phần 3. Khai báo biến môi trường (Environment Variables)

Các key trong file `.env` **không** được tải lên (để bảo mật), nên phải khai báo trên trang Vercel.

1. Mở https://vercel.com/dashboard → bấm vào project **reloop-ai-valuation**.
2. Bấm tab **Settings** (trên cùng) → ở cột trái chọn **Environment Variables**.
3. Thêm từng biến theo bảng dưới. Với mỗi biến:
   - Ô **Key**: gõ tên biến (cột 1).
   - Ô **Value**: copy giá trị **sau dấu `=`** trong file `.env` của bạn (không copy dấu `=`, không thêm dấu ngoặc kép).
   - **Environments**: để tick cả **Production**, **Preview**, **Development**.
   - Bấm **Save**.

| Key | Lấy giá trị ở đâu | Bắt buộc |
|---|---|---|
| `GEMINI_API_KEY` | dòng `GEMINI_API_KEY=` trong `.env` | ✅ |
| `GEMINI_MODEL` | gõ `gemini-3.6-flash` | ✅ |
| `TAVILY_API_KEY` | dòng `TAVILY_API_KEY=` trong `.env` (bắt đầu bằng `tvly-`) | ✅ |
| `TAVILY_SEARCH_DEPTH` | gõ `basic` | ✅ |
| `AUTH_USERS` | dòng `AUTH_USERS=` trong `.env`. Copy **nguyên cả dòng sau dấu `=`**, bắt đầu bằng `[` và kết thúc bằng `]` | ✅ |
| `AUTH_SECRET` | dòng `AUTH_SECRET=` trong `.env` | ✅ |
| `DEMO_LOGIN` | gõ `true` để công khai 3 tài khoản: trang đăng nhập hiện nút đăng nhập nhanh admin/user1/user2, không cần mật khẩu (dự án cá nhân nên chấp nhận việc ai cũng vào được admin) | Tùy chọn |

**KHÔNG thêm** các biến sau lên Vercel:

| Không thêm | Lý do |
|---|---|
| `PORT` | Vercel tự quản lý |
| `FRONTEND_ORIGIN` | Chỉ cần khi web và API ở 2 tên miền khác nhau |
| `VERCEL_TOKEN` (nếu có) | Đây là chìa khóa tài khoản Vercel của bạn, không phải cấu hình web |

> 💡 **Cách nhanh:** Vercel cho phép dán cả nội dung `.env` một lần: mở `.env`, `Ctrl + A`, `Ctrl + C`,
> rồi bấm vào ô **Key** đầu tiên trên Vercel và `Ctrl + V`. Vercel tự tách thành nhiều dòng.
> **Sau đó nhớ bấm dấu trừ/thùng rác để xóa** các dòng `PORT`, `FRONTEND_ORIGIN`,
> `UPSTASH_...` đang để trống, rồi mới **Save**.

---

## Phần 4. Gắn Redis để lưu tin đăng (bắt buộc nếu muốn tin đăng không bị mất)

Vercel không giữ file trên máy chủ, nên tin đăng và thống kê phải lưu ở **Upstash Redis** (miễn phí).

1. Trong project trên Vercel, bấm tab **Storage**.
2. Bấm **Create Database** (hoặc **Browse Marketplace**) → chọn **Upstash** → **Upstash for Redis** → **Continue**.
3. Bấm đồng ý điều khoản (**Accept and Create** / **Install**).
4. Cấu hình:
   - **Primary Region**: chọn **Singapore (ap-southeast-1)** (gần Việt Nam nhất, nhanh nhất).
   - **Plan**: chọn **Free**.
   - **Database name**: gõ `reloop-db` → bấm **Create**.
5. Màn hình hỏi kết nối với project nào → chọn **reloop-ai-valuation**, tick cả 3 môi trường → **Connect**.
6. Kiểm tra: quay lại **Settings → Environment Variables**, phải thấy các biến mới tên `KV_REST_API_URL`
   và `KV_REST_API_TOKEN` (hoặc `UPSTASH_REDIS_REST_URL` và `UPSTASH_REDIS_REST_TOKEN`). Có một trong hai cặp là được, code đã hỗ trợ cả hai.

---

## Phần 5. (Khuyên làm) Cho máy chủ chạy ở Singapore

Mặc định máy chủ Vercel chạy ở Mỹ, gọi qua Redis ở Singapore sẽ chậm.

1. **Settings** → cột trái chọn **Functions**.
2. Mục **Function Region** chọn **Singapore, Southeast (sin1)** → **Save**.

---

## Phần 6. Deploy bản chính thức (Production)

Quay lại Terminal (vẫn ở thư mục dự án), gõ:

```
npx vercel --prod
```

Chờ 1–2 phút. Terminal in ra dòng `Production: https://reloop-ai-valuation....vercel.app`
(Vercel cũng có link ngắn `https://reloop-ai-valuation.vercel.app`, xem ở trang project, mục **Domains**).

> ⚠️ **Mỗi lần thêm hoặc sửa Environment Variables trên Vercel, phải deploy lại** (`npx vercel --prod`) thì mới có tác dụng.

---

## Phần 7. Kiểm tra web đã chạy đúng

### 7.1 – Kiểm tra cấu hình

Mở trình duyệt, vào (thay bằng link của bạn):

```
https://reloop-ai-valuation.vercel.app/api/health
```

Phải thấy đủ các giá trị sau:

| Mục | Phải là | Nếu sai |
|---|---|---|
| `geminiConfigured` | `true` | Thiếu `GEMINI_API_KEY` (Phần 3) |
| `marketSearchConfigured` | `true` | Thiếu `TAVILY_API_KEY` (Phần 3) |
| `authConfigured` | `true` | Thiếu `AUTH_USERS` hoặc `AUTH_SECRET` (Phần 3) |
| `storage` | `"redis"` | Chưa gắn Redis (Phần 4). Nếu là `"memory"` thì tin đăng sẽ bị mất |

Sửa xong nhớ chạy lại `npx vercel --prod`.

### 7.2 – Kiểm tra các chức năng

1. Mở link web → bấm **Đăng nhập** (góc trên phải). Nếu đã thêm `DEMO_LOGIN=true` sẽ thấy 3 nút đăng nhập nhanh admin/user1/user2.
2. Bấm nút đăng nhập nhanh `user1` (hoặc gõ `user1` với mật khẩu lấy trong `AUTH_USERS` ở file `.env`, phần `"password":"..."` của user1).
3. Vào **Kênh Người Bán** → đăng thử 1 sản phẩm → thấy thông báo "chờ quản trị viên duyệt".
4. Đăng xuất (bấm tên ở góc trên phải → **Đăng xuất**), đăng nhập `admin` → vào **Quản trị** → bấm **Duyệt**.
5. Đăng xuất, quay về trang chủ → sản phẩm phải hiện ra cho mọi người.
6. Vào **Định giá AI**, tải 1 ảnh thử → phải ra kết quả (chờ khoảng 10–30 giây).

---

## Phần 8. Các việc thường làm sau này

### Sửa code xong, muốn cập nhật web
```
npx vercel --prod
```

### Đổi mật khẩu / thêm tài khoản
1. Sửa dòng `AUTH_USERS` trong `.env` (để chạy trên máy).
2. Trên Vercel: **Settings → Environment Variables** → bấm `...` cạnh `AUTH_USERS` → **Edit** → dán giá trị mới → **Save**.
3. Chạy `npx vercel --prod`.

Mẫu một tài khoản (phải giữ đúng dấu ngoặc và dấu phẩy):
```
{"username":"user3","password":"MatKhauManh123","role":"user","name":"Người dùng 3"}
```
Các tài khoản đặt cách nhau bằng dấu phẩy, tất cả nằm trong cặp `[` `]`. `role` là `admin` hoặc `user`.

### Đăng xuất tất cả mọi người (khi lộ mật khẩu)
Đổi `AUTH_SECRET` thành chuỗi ngẫu nhiên mới (tạo bằng lệnh dưới), cập nhật trên Vercel rồi deploy lại:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Gắn tên miền riêng (vd. reloop.vn)
Project → **Settings → Domains** → **Add** → gõ tên miền → làm theo hướng dẫn trỏ DNS ở nơi bạn mua tên miền.

### Xem lỗi khi web hỏng
Project → tab **Logs** (lỗi khi đang chạy) hoặc tab **Deployments** → bấm vào bản deploy → **Build Logs** (lỗi khi deploy).

---

## Phần 9. Gặp lỗi thì làm gì

| Hiện tượng | Nguyên nhân thường gặp | Cách sửa |
|---|---|---|
| `npx` / `node` báo "not recognized" | Chưa cài Node.js | Cài Node LTS từ https://nodejs.org, **tắt và mở lại** VS Code |
| Deploy báo `Error: No Output Directory` hoặc trang trắng | Vercel nhận nhầm loại dự án | **Settings → Build and Deployment → Framework Preset** chọn **Express** → Save → `npx vercel --prod` |
| Đăng nhập báo "Tên đăng nhập hoặc mật khẩu không đúng" dù gõ đúng | `AUTH_USERS` dán thiếu ký tự / có dấu ngoặc kép thừa ở đầu cuối | Edit lại biến, giá trị phải bắt đầu bằng `[` và kết thúc bằng `]` → deploy lại |
| Đăng nhập xong một lúc lại bị đăng xuất | Thiếu `AUTH_SECRET` | Thêm `AUTH_SECRET` → deploy lại |
| Tin đăng biến mất sau một lúc | Chưa gắn Redis, `storage` đang là `memory` | Làm Phần 4 → deploy lại |
| Định giá báo "Đã hết lượt dùng Gemini" | Hết hạn mức miễn phí trong ngày của Gemini | Chờ tới khoảng 14h–15h hôm sau (giờ VN) hạn mức tự reset |
| Định giá báo "Đã hết lượt tìm giá thị trường (Tavily)" | Hết 1.000 credit/tháng | Chờ sang tháng, hoặc tạo key Tavily mới, xem số đã dùng ở trang **Quản trị** |
| "Bạn đã gửi quá nhiều yêu cầu" | Chống spam: 20 lần định giá / 15 phút / người | Chờ 15 phút |
| Trang báo "Không thể kết nối máy chủ" | API lỗi hoặc đang deploy | Mở `/api/health` xem có trả kết quả không, xem tab **Logs** |

---

## Tóm tắt nhanh (cho lần sau)

1. `npx vercel login` (1 lần)
2. `npx vercel` (1 lần, tạo project)
3. Thêm 6 biến môi trường trên Vercel (+ `DEMO_LOGIN=true` để công khai 3 tài khoản)
4. Storage → Upstash for Redis → Connect
5. (Tùy chọn) Functions → Region Singapore
6. `npx vercel --prod`
7. Mở `/api/health` kiểm tra
