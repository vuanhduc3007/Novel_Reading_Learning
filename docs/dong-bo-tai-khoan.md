# Tài khoản & đồng bộ giữa các máy (Supabase)

## Cái gì được đồng bộ
| Dữ liệu | Cách đồng bộ |
|---|---|
| Sách | File gốc (epub/txt) và file bản dịch người được lưu trong kho file riêng của tài khoản. Máy mới tự tải về rồi tự nhập/ghép lại, mất 2–4 phút cho lần đầu. Sách giữ cùng mã trên mọi máy. |
| Vị trí đang đọc | Lưu theo (chương, câu). Khi mở sách, app chờ tối đa 4 giây để lấy vị trí mới nhất từ máy khác. Sách đang mở không bao giờ bị nhảy vị trí giữa chừng. |
| Từ đang học / đã thuộc (chế độ Việt + Hán) | Từng từ. |
| Sổ từ vựng, dấu trang | Thêm/xoá đều đồng bộ. Dấu trang được gắn lại đúng câu trên máy kia. |
| Cài đặt đọc | Chế độ, cỡ chữ, khoảng dòng, chiều rộng, font, giao diện, số từ học cùng lúc. |
| Bản máy dịch | Không đồng bộ: máy mới tự dịch lại khi cần. Với sách có bản dịch người, 99% câu đã có sẵn bản dịch. |

**Quy tắc khi hai máy cùng sửa một thứ:** bản sửa sau thắng. Cơ sở dữ liệu cũng tự bỏ qua mọi bản ghi cũ hơn bản đang lưu. Thay đổi ở máy chưa kịp gửi lên được ưu tiên hơn dữ liệu cũ kéo về: ví dụ vừa xoá sách thì không bị tải ngược lại.

**Khi nào đồng bộ:**
- Khi mở app.
- Khi đăng nhập.
- 5 giây sau mỗi thay đổi.
- Khi rời tab hoặc quay lại tab.
- Định kỳ mỗi 2 phút.

Không có mạng vẫn đọc bình thường; thay đổi được xếp hàng và tự gửi khi có mạng.

## Cài đặt (làm một lần)
1. Tạo tài khoản và một project miễn phí tại https://supabase.com.
2. **SQL Editor → New query**: dán toàn bộ [`supabase/schema.sql`](../supabase/schema.sql) rồi bấm **Run**. Script này tạo:
   - các bảng dữ liệu,
   - quyền truy cập: mỗi người chỉ đọc/ghi được dữ liệu của mình,
   - kho file riêng tư `books`.

   Chạy lại nhiều lần cũng không sao.
3. **Authentication → Sign In / Providers → Email**:
   - Muốn đăng ký xong dùng được ngay thì tắt *Confirm email*.
   - Nếu để bật, mỗi tài khoản mới phải bấm link trong thư xác nhận. Bản miễn phí chỉ gửi được vài thư mỗi giờ.
4. **Authentication → URL Configuration**: đặt *Site URL* là địa chỉ trang Netlify của app (link trong thư xác nhận sẽ trỏ về đó).
5. **Project Settings → API**: lấy **Project URL** và **anon public key** (hoặc *publishable key*). Cả hai được phép công khai trên web. **Không** dùng `service_role` / secret key trong app.
6. Đặt hai biến môi trường cho bản build: trong `netlify.toml` (`[build.environment]`) hoặc trong Netlify → Site configuration → Environment variables.
   ```
   VITE_SUPABASE_URL = "https://<project>.supabase.co"
   VITE_SUPABASE_ANON_KEY = "<anon key>"
   ```
   Chạy local thì thêm vào `.env.local`. Sau đó deploy lại.

Nếu không có hai biến này, app chạy như cũ: mọi thứ chỉ lưu trên máy, phần tài khoản ghi "chưa cấu hình".

## Dùng
- **Máy đang có sách:** vào **Cài đặt → Tài khoản & đồng bộ**, tạo tài khoản hoặc đăng nhập. Mọi dữ liệu trên máy được đưa lên.
  - Sách nhập *trước khi* có tính năng này không còn file gốc. Vào trang chi tiết của sách, bấm **Chọn file gốc để đồng bộ** và chọn đúng file đã dùng để nhập; app kiểm tra kích thước file.
  - Tiến độ và bản dịch đã ghép vẫn giữ nguyên.
  - Bản dịch người được đưa lên khi bạn ghép (hoặc ghép lại) bản dịch.
- **Máy mới:** mở app, đăng nhập. Thư viện hiện thanh tiến độ trong lúc tải và dựng lại từng cuốn.

## Giới hạn gói miễn phí của Supabase
- 1 GB kho file: mỗi bộ truyện cỡ 蛊真人 (sách + bản dịch) khoảng 37 MB, tức khoảng 25 bộ.
- Mỗi file tối đa 50 MB.
- Project không có truy cập trong 7 ngày sẽ bị tạm dừng. Vào dashboard bấm *Restore* là chạy lại, dữ liệu không mất.

## Kỹ thuật
- `src/features/sync/localChanges.ts`: mọi thay đổi ghi (loại, khoá) vào bảng `syncDirty` trong IndexedDB. Khi gửi, app đọc trạng thái *hiện tại*, nên nhiều thay đổi liên tiếp gộp thành một lần gửi.
- `src/features/sync/syncEngine.ts`: kéo về (theo `server_at`, đồng hồ của server), rồi đẩy lên, đối chiếu những bản bị server từ chối vì cũ hơn, cuối cùng tải và dựng lại sách còn thiếu.
- File được lưu theo đường dẫn có phiên bản (`<user>/<book>/source-<thời điểm>`), nên máy khác nhận ra khi file bị thay. Bản cũ bị xoá sau khi tải lên bản mới.
- `tests/sync.test.mjs`: giả lập hai máy (IndexedDB và localStorage riêng) dùng chung một cloud trong bộ nhớ, kiểm tra toàn bộ luồng ở trên.
