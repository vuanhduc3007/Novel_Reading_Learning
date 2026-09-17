# Chinese Reader — Design Specification & Handoff Document

**Bilingual Chinese–Vietnamese Ebook Reader · v1.1 · Design Handoff cho Antigravity**

> **Đổi mới ở v1.1:** (1) Ba điểm trước đây là giả định — cơ chế cuộn chương, IA của Bookmark/Dictionary, nguồn dữ liệu dictionary — nay là **quyết định đã chốt**. (2) Bổ sung yêu cầu **Library Persistence & Book Lifecycle**: sách được upload một lần và tồn tại vĩnh viễn trong thư viện, đọc lại bất cứ lúc nào không cần upload lại — yêu cầu này được phản ánh xuyên suốt IA, Library, Import, Reader, Dictionary, Vocabulary, Bookmarks, Loading/Error/Empty states, và Antigravity handoff, không chỉ gói gọn trong một mục riêng.

> Tài liệu này là bản đặc tả thiết kế đầy đủ, không chứa code, không yêu cầu backend hay deployment. Mục tiêu: một coding agent (Antigravity) có thể đọc tài liệu này và biết chính xác app trông như thế nào, người dùng tương tác ra sao, dữ liệu sống ở đâu qua thời gian, và mỗi component có những state gì.

### Mục lục
0. Cách dùng tài liệu
1. Product Vision
2. UX Principles
3. Information Architecture
4. User Flows
5. Screen Inventory
6. Detailed Screen Specifications
7. Component Hierarchy
8. Design System (Design Tokens)
9. Typography
10. Color System
11. Responsive Design
12. Interaction Design
13. Loading / Error / Empty States
14. Large-Book UX & Performance
15. Accessibility
16. Keyboard Shortcuts
17. Developer Handoff Notes (cho Antigravity)

---

## 0. Cách dùng tài liệu này

- Section 1–5 trả lời câu hỏi "App này là gì và cấu trúc ra sao".
- Section 6 là phần chi tiết nhất — mỗi trong 14 màn hình có frame size, grid, component, interaction, state, responsive behavior riêng. Antigravity nên bắt đầu implement từ đây.
- Section 7–11 là "ngôn ngữ chung" (component + token) mà mọi màn hình ở Section 6 tham chiếu tới.
- Section 12–16 là các quy tắc hành vi xuyên suốt toàn app.
- Section 17 là bản tóm tắt quyết định cho Antigravity: data shape gợi ý, quy ước đặt tên, và 4 quyết định đã chốt (không còn giả định).

Ở những chỗ có nhiều phương án khả thi, tài liệu chọn **một phương án duy nhất** và giải thích lý do — không để lửng.

---

## 1. Product Vision

**Chinese Reader** (tên tạm thời) là một ebook reader song ngữ Trung–Việt, biến việc đọc sách tiếng Trung thật thành phương pháp học từ vựng và ngữ cảnh, thay vì dùng công cụ dịch rời rạc.

**Một câu:** *Đọc sách tiếng Trung như một cuốn sách thật — có bản dịch tiếng Việt và từ điển luôn sẵn sàng, nhưng không bao giờ lấn át trải nghiệm đọc.*

**Vấn đề đang giải quyết:** người học ở trình độ HSK 2–6 muốn đọc truyện/sách tiếng Trung để tăng vốn từ và cảm nhận ngôn ngữ tự nhiên, nhưng quy trình hiện tại (đọc — dừng lại — mở Google Translate/từ điển — quay lại đọc) làm gãy mạch đọc.

**Chinese Reader không phải là:**
- Một công cụ dịch văn bản hàng loạt.
- Một app flashcard độc lập (dù có tính năng vocabulary, trọng tâm vẫn là *đọc*).
- Một dashboard quản lý nội dung kiểu SaaS.

**Người dùng mục tiêu:** đang học tiếng Trung, trình độ khoảng HSK 2–6, muốn đọc truyện/sách tiếng Trung mà không phải liên tục rời khỏi app để tra nghĩa, và muốn tích lũy từ vựng một cách tự nhiên trong lúc đọc.

**Nguyên tắc sở hữu sách (mới, v1.1):** upload là một hành động **một lần**. Sau khi import thành công, cuốn sách — cùng tiến trình đọc, bookmark, từ vựng đã lưu, và trạng thái dịch — thuộc về thư viện của người dùng vĩnh viễn cho đến khi họ chủ động xóa. Mở lại app sau nhiều ngày, đóng/mở lại trình duyệt, hay quay lại một cuốn đọc dở từ tuần trước đều phải cho cảm giác "sách vẫn nằm đó, y như một cuốn sách giấy thật trên kệ" — không có khái niệm "phiên làm việc" (session) làm mất dữ liệu.

**"Thành công" trông như thế nào:** người dùng có thể mở một cuốn sách 300 trang, đọc liên tục 20–30 phút mà không cảm thấy đang "dùng phần mềm"; và một tuần sau quay lại, sách vẫn ở đúng vị trí, từ vựng đã học vẫn còn, không phải nhập lại bất cứ điều gì.

---

## 2. UX Principles

1. **Chinese first, Vietnamese second.** Tiếng Trung luôn là nội dung chính về mặt thị giác. Tiếng Việt là lớp hỗ trợ — nhỏ hơn, nhạt màu hơn — không cạnh tranh vị trí với câu tiếng Trung tương ứng.
2. **Reading over tooling.** Mọi chrome (top bar, sidebar, control) phải có khả năng biến mất, thu gọn lại chỉ còn nội dung sách.
3. **Progressive disclosure.** Ba tầng cho một từ: *hover* (xem nhanh, chỉ dữ liệu rẻ/đã có sẵn) → *click* (tra cứu đầy đủ, có thể tốn chi phí hơn) → *tìm kiếm chủ động* (Dictionary search). Không nhảy thẳng vào tầng tốn kém nhất khi người dùng chỉ đang thăm dò — nguyên tắc này áp dụng trực tiếp vào kiến trúc dictionary ở Section 3.4 & 12.1.
4. **Không bao giờ chặn việc đọc.** Sách phải mở được ngay sau khi tách xong chương, kể cả khi dịch thuật, tra từ điển, hay index tìm kiếm vẫn chạy nền. Không có spinner toàn màn hình chặn cả app.
5. **Thư viện là bền vững (mới, v1.1).** Một khi đã import, sách — và mọi dữ liệu học tập gắn với nó — tồn tại xuyên suốt qua các lần mở app, đóng/mở trình duyệt, và theo thời gian. Người dùng không bao giờ phải tự hỏi "mình có cần lưu lại không?" vì không có hành động "lưu" tách rời — mọi thứ tự động bền vững.
6. **Nhất quán nhưng có bản sắc riêng.** Lấy cảm hứng cấu trúc từ Kindle/Apple Books/Readwise Reader nhưng bảng màu, typography và tương tác dictionary là thiết kế riêng.
7. **Hiệu năng ổn định bất kể kích thước sách hay tuổi thọ thư viện.** Trải nghiệm mở một file 20KB mới import và một file 50MB đã nằm trong thư viện 6 tháng phải giống hệt nhau về độ mượt.

---

## 3. Information Architecture

### 3.1 Global navigation (ngoài Reader)

```
┌────────────────────────────────────────────────────┐
│  [Logo] Chinese Reader     Library   Vocabulary  ⚙  │
└────────────────────────────────────────────────────┘
```
Chỉ 3 mục điều hướng chính + logo bên trái, settings icon bên phải. Global nav **không xuất hiện** trong Reader — Reader có top bar riêng (Section 6.7).

### 3.2 Sitemap

```
Chinese Reader
├── Library (trang chủ sau khi có ≥1 sách — nguồn "sự thật" cho toàn bộ thư viện bền vững)
│   ├── Book Grid
│   ├── Import Modal → Import Processing
│   └── Book Detail (mở từ menu trên Book Card)
│       ├── Translation progress & lifecycle actions (Continue / Replace / Delete)
│       └── Bookmarks của riêng cuốn sách đó
├── Reader (full-screen mode, tách biệt khỏi global nav)
│   ├── Contents (chapter list) — infinite-scroll giữa các chương (CHỐT, xem 3.3 & 4.1)
│   ├── Reading pane
│   ├── Dictionary Panel (overlay, contextual — CHỐT, xem 3.4)
│   ├── Reader Settings Panel (overlay)
│   └── In-book Search
├── Vocabulary (toàn bộ từ đã lưu, bền vững xuyên suốt mọi cuốn sách, kể cả sách đã bị xóa)
└── Settings (app-wide: theme, dung lượng lưu trữ, giới thiệu)
```

### 3.3 QUYẾT ĐỊNH CHỐT #1 — Cơ chế cuộn chương

**Xác nhận: Infinite scroll giữa các chương**, không phân trang cứng.

- Lý do: giữ cảm giác "đang đọc một cuốn sách liền mạch" thay vì cảm giác điều hướng qua các trang rời rạc kiểu app.
- Bắt buộc đi kèm **lazy loading + virtualization ở cấp chương**: không bao giờ load toàn bộ sách vào DOM cùng lúc (chi tiết cơ chế ở Section 14.5).
- Chỉ chương đang đọc + chương liền kề trước/sau được giữ render tích cực; các chương xa hơn được giải phóng khỏi DOM nhưng vẫn còn trong dữ liệu đã lưu (không mất dữ liệu, chỉ là không render).
- **Vị trí đọc phải được giữ nguyên (persist) bất kể chương nào đang được render hay giải phóng** — vị trí đọc (`lastReadSentenceId`) được lưu độc lập với việc DOM có đang giữ chương đó hay không, và được ghi liên tục xuống local persistent storage (không chỉ khi rời trang) — xem 3.5 & 6.7.

### 3.4 QUYẾT ĐỊNH CHỐT #2 — Bookmark & Dictionary IA

**Xác nhận: Bookmark và Dictionary là panel ngữ cảnh, không phải mục nav cấp 1.**

- Giữ IA tối giản, ưu tiên đọc (đúng UX Principle #2).
- **Dictionary:**
  - *Hover từ* → **Quick Dictionary Tooltip** (xem nhanh, chỉ dùng dữ liệu rẻ — Local + Cache, không bao giờ gọi External/LLM khi chỉ hover — xem Section 3.5 & 12.1).
  - *Click từ* → **Full Dictionary Side Panel** (tra cứu đầy đủ, có thể chạm tới External Provider / LLM fallback nếu cần).
- **Bookmark:** luôn thao tác được trực tiếp từ Reader (icon + phím tắt `B`) mà không rời khỏi trải nghiệm đọc — không có luồng nào bắt người dùng thoát Reader để đánh dấu.
- Toàn bộ state và transition của 2 khu vực này được đặc tả tường minh ở Section 6.8 (Reader+Dictionary), Section 6.11 (Bookmarks), và Section 12.1–12.2.

### 3.5 QUYẾT ĐỊNH CHỐT #3 — Kiến trúc nguồn dữ liệu Dictionary

**Xác nhận: Kiến trúc Dictionary provider-agnostic** — thiết kế UI không gắn cứng với một dictionary API cụ thể nào.

**Thứ tự tra cứu (lookup priority), áp dụng cho mọi lần tra một từ:**

```
1. Local Dictionary   (dữ liệu offline đóng gói sẵn trong app — nhanh nhất, miễn phí)
        ↓ (nếu không có / không đủ)
2. Cache              (kết quả đã tra trước đó, lưu persistent — tái sử dụng, không tra lại)
        ↓ (nếu không có)
3. External Dictionary Provider   (API từ điển bên thứ ba)
        ↓ (nếu vẫn không có)
4. Optional LLM Fallback          (chỉ dùng khi 3 tầng trên đều trống — có gắn nhãn minh bạch)
```

**Yêu cầu ràng buộc thiết kế:**
- **Hover không bao giờ được kích hoạt gọi External Provider hoặc LLM.** Hover chỉ đọc từ Local + Cache — nếu miss ở cả hai, tooltip hiện gợi ý "Nhấn để tra cứu đầy đủ" thay vì tự động gọi API tốn phí ở một cử chỉ nhẹ như di chuột.
- **Kết quả đã cache phải được tái sử dụng** — một từ đã tra một lần (dù ở sách nào, phiên nào) không nên phải gọi External/LLM lại lần hai; cache là persistent, sống lâu hơn một phiên đọc.
- **UI phải xử lý mượt cả 5 loại kết quả:** *loading*, *partial* (có một phần dữ liệu, phần còn lại đang chờ tầng tiếp theo), *complete*, *unavailable* (không tầng nào có), *error* (lỗi kỹ thuật, khác với "không có nghĩa"). Chi tiết bảng trạng thái ở Section 13.4.
- **Kết quả từ LLM fallback phải được gắn nhãn minh bạch** (badge nhỏ "Định nghĩa AI") để người học hiệu chỉnh mức độ tin tưởng — không trộn lẫn âm thầm với kết quả từ điển chính thống.
- Thiết kế này giữ nguyên bất kể Antigravity chọn nhà cung cấp External Provider nào — panel/tooltip chỉ quan tâm tới shape dữ liệu trả về (Section 17.1), không quan tâm nguồn.

### 3.6 Phạm vi lưu trữ & phiên làm việc (persistence scope)

**Xác nhận cho v1.0/v1.1: local-first, một thiết bị, không yêu cầu đăng nhập.** Thư viện, tiến trình đọc, bookmark, từ vựng, và cache dictionary được lưu bền vững trên trình duyệt/thiết bị đang dùng (persistent storage — không phải session storage), và tồn tại qua mọi lần đóng/mở trình duyệt hay khởi động lại app. Vì v1.0 không có hệ thống tài khoản, khái niệm "đăng xuất/đăng nhập lại" không áp dụng; đồng bộ đa thiết bị (multi-device sync) **nằm ngoài phạm vi bản thiết kế này** và được ghi nhận như một hướng mở rộng tương lai ở Section 17.4. Quyết định này được đưa ra để giữ phạm vi v1.1 nhất quán với phần còn lại của app (vốn chưa từng thiết kế màn hình đăng nhập) trong khi vẫn đáp ứng đầy đủ yêu cầu "upload một lần, đọc lại bất cứ lúc nào" trong phạm vi một trình duyệt.

---

## 4. User Flows

### 4.1 First-time user
```
Mở app → Empty Library → [Import your first book] → Import Modal
→ Chọn/kéo file EPUB → Import Processing (Uploading → Parsing →
Extracting chapters) → sách được ghi vào thư viện bền vững, Book card
xuất hiện trong Library với trạng thái "Ready to read"
→ Click "Continue reading" → Reader mở, Chapter 1 (infinite-scroll,
chỉ Chapter 1 + phần đầu Chapter 2 được render)
→ (nền: Background Translation bắt đầu) → câu đầu tiên hiện
"Đang dịch…" → vài giây sau Vietnamese xuất hiện → user đọc tiếp
→ Hover từ lạ → nếu có trong Local/Cache: Tooltip preview ngay
→ Click từ → Dictionary Panel (tra cứu đầy đủ theo chuỗi ưu tiên
Section 3.5) → [+ Add to vocabulary] → Toast xác nhận → tiếp tục đọc
```

### 4.2 Returning user (nhấn mạnh tính bền vững, v1.1)
```
Đóng trình duyệt, quay lại sau vài ngày → mở app → Library đọc từ
local persistent storage, hiển thị đầy đủ 100% sách đã import trước
đó, không cần đăng nhập hay import lại → sách đang đọc dở nằm ở đầu
row "Continue Reading", đúng % tiến trình và đúng "last opened" như
lần cuối → Click cover hoặc "Continue reading" → Reader mở đúng câu
cuối cùng đã đọc (scroll tự động, fade-in) → nếu translation background
job trước đó chưa chạy xong 100% lúc user rời đi, nó tiếp tục từ đúng
vị trí đã dừng (không dịch lại từ đầu) → bookmark và từ vựng đã lưu
của sách này vẫn nguyên vẹn
```

### 4.3 Import một cuốn sách lớn (50MB+)
```
Kéo file vào Library → Import Modal nhận diện file → Import Processing:
Uploading (%) → Parsing → Extracting chapters (hiện số chương đã tách)
→ ngay khi bước này xong: sách chuyển trạng thái "Ready to read", nút
"Open now" khả dụng dù Background Translation chưa chạy xong
→ user mở sách đọc ngay, phần còn lại tiếp tục dịch ở nền và được ưu
tiên theo vị trí đọc thực tế (Section 14.4)
```

### 4.4 Học một từ (word-hover flow, cập nhật theo kiến trúc dictionary v1.1)
```
Đang đọc → di chuột qua từ → 150ms delay → tra Local + Cache (KHÔNG
gọi External/LLM) → nếu có: gạch chân dotted + Tooltip preview hiện
ngay (nghĩa ngắn, pinyin, loại từ) → nếu KHÔNG có ở cả 2 tầng rẻ:
tooltip hiện "Nhấn để tra cứu đầy đủ" thay vì gọi API ngầm
→ user click từ: Dictionary Panel trượt vào, chạy chuỗi tra cứu đầy
đủ Local → Cache → External → LLM fallback, hiện state loading/partial
theo dữ liệu về tới đâu (Section 13.4) → kết quả cuối được ghi vào
Cache để lần tra sau (bất kỳ sách nào, bất kỳ phiên nào) tức thời
→ [+ Add to vocabulary] → badge "✓ Đã lưu" → user đọc tiếp
```

### 4.5 Tìm kiếm trong sách
```
Reader → bấm icon Search hoặc phím "S" → thanh search trượt xuống từ
top bar → gõ từ khóa → danh sách kết quả theo chương với đoạn trích
highlight → click 1 kết quả → Reader scroll mượt đến đúng câu, highlight
nhạt 2 giây rồi tắt dần
```

### 4.6 Bookmark và quay lại
```
Đang đọc → bấm icon Bookmark hoặc phím "B" → toast "Đã đánh dấu" →
mở Bookmarks (từ Reader top bar hoặc Book Detail) → danh sách theo
thứ tự chương, mỗi mục có preview text + ngày → click → jump vào
Reader tại đúng câu (bookmark tồn tại bền vững cho tới khi user xóa
bookmark đó hoặc xóa cả cuốn sách — xem 4.8)
```

### 4.7 Đổi reading mode / cỡ chữ
```
Reader → bấm "Aa" → Reader Settings Panel trượt vào từ phải → kéo
slider / chọn reading mode → nội dung reader cập nhật ngay lập tức
→ lựa chọn được lưu bền vững làm mặc định cho lần đọc tiếp theo
```

### 4.8 Xóa / Thay thế sách (mới, v1.1)

**Xóa sách:**
```
Library (hoặc Book Detail) → mở kebab menu trên Book Card → "Xóa sách"
→ Confirmation dialog: "Xóa '<tên sách>'? Bookmark và tiến trình đọc
của sách này sẽ bị xóa. Từ vựng đã lưu từ sách này vẫn được giữ lại
trong Vocabulary." → [Hủy] [Xóa]
→ xác nhận → Book Card fade-out khỏi Library, danh sách reflow, toast
"Đã xóa '<tên sách>'" — hành động không thể hoàn tác (không có Undo,
vì đây là xóa dữ liệu cục bộ vĩnh viễn — cảnh báo đã nêu rõ ở dialog)
```

**Thay thế / Nhập lại sách:**
```
Library (hoặc Book Detail) → kebab menu → "Thay thế / Nhập lại"
→ Import Modal mở ở chế độ Replace (tiêu đề đổi thành "Thay thế
sách") → chọn file mới → cảnh báo trước khi xử lý: "Thay thế sẽ đặt
lại tiến trình đọc, bookmark, và trạng thái dịch của phiên bản cũ. Từ
vựng đã lưu vẫn được giữ lại." → [Hủy] [Tiếp tục]
→ Import Processing chạy như import mới, gắn vào cùng vị trí Book
Card sau khi hoàn tất
```

---

## 5. Screen Inventory

| # | Màn hình | Mục đích chính | Ưu tiên thiết bị |
|---|---|---|---|
| 1 | Library (có sách) | Duyệt, tìm, tiếp tục đọc — nguồn hiển thị của thư viện bền vững | Desktop, Tablet, Mobile |
| 2 | Book Detail *(mới, v1.1)* | Xem chi tiết 1 sách + toàn bộ hành động vòng đời (Continue/Replace/Delete/Translation progress) | Tất cả |
| 3 | Empty Library | Onboarding, mời import sách đầu tiên | Tất cả |
| 4 | Import Modal | Nhận file (drag-drop / browse), có chế độ Import mới & chế độ Replace | Desktop, Tablet |
| 5 | Import Processing | Hiển thị tiến trình xử lý sách | Tất cả |
| 6 | Reader (mặc định) | Đọc song ngữ, infinite-scroll giữa chương | Tất cả |
| 7 | Reader + Dictionary Panel | Tra từ chi tiết theo chuỗi ưu tiên Local→Cache→External→LLM | Tất cả |
| 8 | Reader Settings Panel | Tùy chỉnh typography, reading mode, theme | Tất cả |
| 9 | Search Results (in-book) | Tìm câu/từ trong sách đang mở | Tất cả |
| 10 | Vocabulary | Quản lý từ đã lưu, bền vững kể cả khi sách nguồn bị xóa | Desktop, Tablet, Mobile |
| 11 | Bookmarks | Danh sách vị trí đã đánh dấu | Tất cả |
| 12 | Settings (app-wide) | Theme, dung lượng lưu trữ, giới thiệu | Tất cả |
| 13 | Error states (bộ 7) | Import/dịch/mạng/sách hỏng | Tất cả |
| 14 | Empty states (bộ 4) | Library/Vocabulary/Bookmarks/Search rỗng | Tất cả |

*Delete Confirmation và Replace Flow là **dialog/modal state** trong Library & Book Detail, không phải màn hình cấp 1 riêng — xem 6.1 và 6.2.*

---

## 6. Detailed Screen Specifications

> Quy ước frame: Desktop 1440×900, Tablet 834×1194, Mobile 390×844. Grid desktop 12-column, gutter 24px, margin 64px trừ khi ghi chú khác.

### 6.1 Library (có sách)

**Mục đích:** điểm khởi đầu của app; duyệt, tìm, tiếp tục đọc; là "mặt hiển thị" của thư viện bền vững.

**Layout (Desktop 1440):**
- Global nav sticky top, 64px.
- Header: "Library" (text-2xl) + SearchBar (320px) + Sort dropdown ("Gần đây nhất" mặc định, thêm tùy chọn "Mới thêm gần đây" và "Mở gần đây nhất" — tận dụng field `lastOpenedAt`).
- Row "Continue Reading": scroll ngang, card lớn (280×180px), tối đa 4 hiển thị.
- Grid "All Books": 5 cột desktop, 3 tablet, 2 mobile.

**Book Card — nội dung (cập nhật v1.1):**
- Cover (tỉ lệ 3:4, `--radius-md`).
- Title (text-md, ellipsis), author (text-sm, text-secondary).
- Progress bar mảnh 4px + % text-xs.
- Dòng metadata: "Chapter 12 · Mở lần cuối 2 ngày trước" (text-xs, text-tertiary) — kết hợp `lastReadSentenceId`/chapter và `lastOpenedAt`.
- Badge trạng thái xử lý (góc trên cover, chỉ hiện khi khác "hoàn toàn sẵn sàng"): "Đang dịch 76%" / "Nhập thất bại" / "Không khả dụng" (xem 13.5).
- Menu kebab (⋮): **Mở Book Detail · Tiếp tục đọc · Thay thế/Nhập lại · Xóa sách** — 2 hành động cuối kích hoạt flow ở 4.8.

**Interactions:** click cover/"Continue reading" → Reader tại vị trí đọc dở; click title/author → Book Detail (6.2); kéo file vào trang → overlay "Drop to import" toàn trang → thả → Import Processing (import mới, không phải replace, trừ khi thả đúng vào một Book Card cụ thể — thả vào 1 Book Card cụ thể sẽ prompt "Thay thế sách này?" trước khi tiến hành, tránh nhầm lẫn giữa import mới và replace).

**States:** default; searching/sorting; drag-over toàn trang (import mới) vs drag-over trên 1 Book Card (gợi ý replace); loading skeleton khi đọc dữ liệu thư viện lúc khởi động app; **book unavailable/corrupted** — card hiển thị cover mờ + icon cảnh báo + text "Không khả dụng" + action duy nhất "Nhập lại" (trường hợp dữ liệu đã xử lý của sách bị hỏng/mất giữa các phiên — xem 13.5).

**Responsive:** Tablet — grid 3 cột. Mobile — grid 2 cột, SearchBar thu gọn thành icon, kebab menu luôn hiện (không cần hover).

---

### 6.2 Book Detail *(mới, v1.1)*

**Mục đích:** trung tâm quản lý vòng đời của **một** cuốn sách cụ thể — nơi các hành động "nặng" (xóa, thay thế, xem tiến trình dịch chi tiết) sống, tách khỏi thao tác đọc nhanh hằng ngày trên Book Card.

**Layout (Desktop):** Modal lớn hoặc trang riêng full-width (khuyến nghị: trang riêng, vì nội dung khá nhiều — cover lớn bên trái (240px) + thông tin bên phải).

**Nội dung:**
- Cover lớn, title (text-xl), author, định dạng gốc (EPUB/TXT/HTML/MD), dung lượng file (hỗ trợ nhận biết sách nào đáng xóa khi cần dọn dẹp — liên kết với Settings 6.12).
- Reading progress: thanh progress lớn + "Chapter 12/28 · 68%" + "Mở lần cuối: hôm qua lúc 21:40".
- **Translation progress** (chi tiết hơn Book Card): thanh riêng + %, cùng 2 nút hành động: "Dịch chương đang đọc ngay" / "Dịch toàn bộ phần còn lại" (đúng như Section 14.3, nay đặt cố định tại đây thay vì chỉ ở tooltip).
- Số bookmark đã lưu trong sách này (link → Bookmarks lọc theo sách).
- Số từ vựng đã lưu từ sách này (link → Vocabulary lọc theo sách).
- Vùng hành động cuối trang (tách biệt bằng divider, dùng màu trung tính để không trông như CTA chính): **"Thay thế / Nhập lại"** (secondary button) và **"Xóa sách"** (nút màu error, style ít nổi bật hơn để tránh bấm nhầm — text-only hoặc outline, không phải solid).
- Nút "Tiếp tục đọc" (primary, nổi bật nhất trang) luôn ở vị trí dễ thấy nhất — Book Detail vẫn ưu tiên "đọc" hơn "quản lý".

**Components:** BookDetailHeader, ProgressBar (labeled) ×2 (reading + translation), StatLink (bookmarks/vocabulary count), SecondaryButton, DestructiveTextButton (Xóa sách).

**Interactions:** "Xóa sách" → mở Delete Confirmation dialog (4.8); "Thay thế/Nhập lại" → mở Import Modal chế độ Replace (4.8); click số bookmark/từ vựng → điều hướng có filter sẵn theo sách.

**States:** default; sách đang trong quá trình dịch nền (progress cập nhật real-time nếu đang mở trang này); sách unavailable/corrupted (ẩn hết action trừ "Nhập lại" và "Xóa"); vừa xóa xong (trang tự động điều hướng về Library kèm toast, không hiển thị "Book Detail rỗng").

**Responsive:** Tablet/Mobile — layout 1 cột, cover thu nhỏ lên đầu, các action cuối trang giữ nguyên thứ tự nhưng full-width.

---

### 6.3 Empty Library

**Mục đích:** trạng thái onboarding — chưa có sách nào (kể cả trường hợp thư viện từng có sách nhưng user đã xóa hết).

**Layout:** căn giữa, illustration line-art tối giản, heading "Chưa có cuốn sách nào" (text-lg), sub-text ngắn, nút primary "Nhập cuốn sách đầu tiên".

**Components:** EmptyState.

**Interactions:** click nút → mở Import Modal (chế độ import mới).

---

### 6.4 Import Modal

**Mục đích:** nhận file sách — có 2 chế độ: **Import mới** (mặc định) và **Replace** (khi mở từ kebab menu "Thay thế/Nhập lại", tiêu đề modal đổi thành "Thay thế sách", có dòng cảnh báo về việc reset tiến trình đọc/bookmark/dịch như mô tả ở 4.8).

**Layout:** Modal căn giữa, width 560px desktop. Dropzone: border dashed 2px, `--radius-lg`, padding 48px, icon upload, text "Kéo sách vào đây", sub-text "EPUB · TXT · HTML · MD", nút secondary "Chọn file". Ở chế độ Replace: thêm 1 khối cảnh báo (nền `--color-warning` nhạt) phía trên dropzone.

**Interactions:** kéo file hợp lệ → border/background đổi sang accent; thả → đóng modal, chuyển Import Processing (đúng chế độ new/replace đã chọn); file sai định dạng → dropzone rung nhẹ + border error + text lỗi tại chỗ (13.2).

**States:** idle; drag-over valid/invalid; chế độ New vs Replace (khác nhau ở tiêu đề + khối cảnh báo, giữ nguyên phần dropzone).

---

### 6.5 Import Processing

**Mục đích:** trấn an người dùng trong lúc sách được xử lý.

**Layout:** thay nội dung Import Modal tại chỗ: cover placeholder + tên file, progress bar ngang, label trạng thái + %.

**Chuỗi trạng thái (Import pipeline, tuần tự):**
1. Uploading… (0–20%)
2. Parsing… (20–40%)
3. Extracting chapters… (40–70%) — hiện "Đã tách N chương"
4. Processing text… (70–100%)
5. **Ready to read** — trạng thái chính thức được ghi vào thư viện bền vững; nút "Open book" active.

**Lưu ý cốt lõi (không đổi từ v1.0, nay là quyết định chốt cấp sản phẩm):** Translation KHÔNG nằm trong chuỗi này. Ngay khi bước 4 xong, sách "Ready to read" — Background Translation là tiến trình nền độc lập, khởi động ngay sau đó và có thể tiếp diễn xuyên suốt nhiều phiên sử dụng sau này (Section 14).

Ở chế độ **Replace**, khi hoàn tất, Book Card ở đúng vị trí cũ được cập nhật nội dung mới; `readingProgress`, `translationStatus` của sách được reset về đầu; bookmark trỏ tới sentence ID cũ bị vô hiệu và xóa (kèm toast thông báo số lượng bị mất); vocabulary items liên quan tới sách vẫn giữ nguyên trong Vocabulary nhưng liên kết "Xem trong sách" chuyển sang trỏ tới bản mới (nếu tìm thấy từ tương ứng) hoặc bị vô hiệu nhẹ nhàng (không xóa từ, chỉ ẩn nút "Xem trong sách" nếu không khớp được).

**Components:** ProgressBar (labeled), StepIcon, Toast.

**States:** 5 bước trên; error tại bất kỳ bước nào → Error state tương ứng (13.2) kèm "Thử lại"/"Hủy".

---

### 6.6 Reader (màn hình mặc định)

**Mục đích:** đọc song ngữ — infinite-scroll giữa các chương (quyết định chốt, Section 3.3).

**Layout (Desktop ≥1280px, 3 cột):**
- ReaderTopBar (56px, auto-hide): `← Library` — tên sách + chương — cụm icon: Search, Aa, Bookmark, kebab.
- Cột trái "Contents" (260px, có thể thu gọn icon-rail 56px): danh sách chương, chương đang đọc có nền accent-soft.
- Cột giữa "Reading pane": max-width 680px, căn giữa.
- Cột phải "Dictionary": ẩn mặc định, overlay 380px khi có từ được click (không đẩy layout — xem 3.4 & 6.7).
- Progress bar mảnh 3px sát đáy, thể hiện % tiến trình đọc toàn sách.

**Sentence unit:**
```
他慢慢地走进了房间。
Anh ấy từ từ bước vào căn phòng.
```
Mỗi cặp câu là một khối duy nhất; khoảng cách trong cặp nhỏ hơn khoảng cách giữa các cặp câu (chi tiết Section 9.2).

**Cơ chế infinite-scroll & giữ vị trí đọc (chi tiết hóa quyết định chốt #1):**
- Cuộn xuống hết chương hiện tại → tự động preload + render nối tiếp chương kế tiếp, không có ranh giới "trang" cứng; ChapterHeader mới xuất hiện liền mạch giữa dòng chảy nội dung.
- Chỉ chương hiện tại ± 1 được giữ trong DOM tại một thời điểm (Section 14.5); các chương xa hơn được unmount nhưng dữ liệu (bản dịch, trạng thái) vẫn còn trong storage bền vững, sẵn sàng render lại khi cuộn tới.
- Vị trí đọc (`lastReadSentenceId` + `chapterIndex`) được ghi xuống persistent storage theo debounce ngắn (không chờ đến khi rời trang) — đảm bảo đóng tab đột ngột, mất mạng, hay crash trình duyệt cũng không làm mất quá vài câu tiến trình.
- Người dùng vẫn có thể **nhảy chương trực tiếp** qua Contents mà không cần cuộn tuần tự — khi đó DOM window "current ± 1" dịch chuyển ngay tới vị trí mới.

**Components:** ReaderTopBar, ChapterList/IconRail, ReaderProgressBar, Paragraph → ChineseSentence (→ WordToken) → Translation, ChapterHeader, DictionaryPanel, ReaderSettingsPanel.

**States:** đang tải chương (skeleton, 13.1); chương đã tải, câu chưa dịch xong (14.2); lỗi tải chương (banner nhỏ trong reading pane); **book unavailable giữa phiên đọc** — nếu dữ liệu sách bị mất/hỏng ngay khi đang đọc (hiếm, nhưng cần xử lý) → banner toàn Reader "Không thể tải tiếp nội dung sách này" + nút "Quay lại Library" (không cố render phần hỏng).

**Responsive:** như v1.0 — Laptop: Contents mặc định icon-rail; Tablet: Contents qua Drawer, Dictionary side-sheet 70%; Mobile: full-screen, Contents Drawer full-height, Dictionary bottom sheet.

---

### 6.7 Reader + Dictionary Panel

**Mục đích:** tra cứu đầy đủ một từ mà không rời ngữ cảnh câu đang đọc, theo chuỗi ưu tiên Local → Cache → External → LLM fallback (quyết định chốt #3, Section 3.5).

**Layout:** panel 380px trượt từ phải, `--shadow-lg`, backdrop mờ 4%.

**Nội dung panel:** Header "Dictionary" + ×; từ tiêu điểm (Chinese lớn + pinyin); nghĩa tiếng Việt; PosBadge; divider; "Ví dụ" (1–3 câu); "Từ liên quan" (chip); footer sticky "+ Add to vocabulary" (toggle sang "✓ Đã thêm").

**Mới v1.1 — Badge nguồn dữ liệu:** khi kết quả đến từ LLM fallback (không có ở Local/Cache/External), hiện badge nhỏ cạnh pinyin: `AI` (text-tertiary, viền mảnh) — hover/tap vào badge hiện tooltip "Định nghĩa do AI tạo, có thể chưa hoàn toàn chính xác". Kết quả từ Local/Cache/External **không** có badge (đây là mặc định "đáng tin", không cần đánh dấu thêm).

**States (mở rộng chi tiết, xem bảng đầy đủ ở 13.4):**
| State | Hiển thị |
|---|---|
| Loading | Skeleton toàn bộ nội dung (giữ đúng chiều cao ước lượng) |
| Partial | Phần đã có (vd pinyin từ Local) hiện ngay; phần đang chờ tầng tiếp theo (vd nghĩa từ External) vẫn skeleton, fade-in khi về — không reload cả panel |
| Complete (Dictionary) | Đầy đủ, không badge |
| Complete (AI fallback) | Đầy đủ + badge `AI` |
| Unavailable | "Không tìm thấy nghĩa cho từ này" + "Báo lỗi từ này" |
| Error | Lỗi kỹ thuật (mất kết nối tới External/LLM) — khác Unavailable — "Thử lại" |

**Responsive:** Tablet — side-sheet 70%. Mobile — bottom sheet kéo giãn, nút Add sticky đáy.

---

### 6.8 Reader Settings Panel

Không đổi so với v1.0: Reading Mode (segmented 3 lựa chọn), cỡ chữ (slider 5 nấc), line height, content width (ẩn mobile), font Hán/Việt, theme. Mọi thay đổi áp dụng ngay và **được lưu bền vững** làm mặc định cho lần mở app tiếp theo (không phải chỉ trong phiên hiện tại) — bổ sung nhỏ theo tinh thần persistence v1.1.

---

### 6.9 Search Results (in-book)

Không đổi cấu trúc so với v1.0. Bổ sung v1.1: index tìm kiếm của một cuốn sách được xây dựng **một lần sau import** và lưu bền vững cùng sách — lần mở sách sau (kể cả sau khi đóng trình duyệt) không cần build lại index từ đầu, chỉ build lại phần chênh lệch nếu sách được Replace (4.8).

---

### 6.10 Vocabulary

**Mục đích:** quản lý toàn bộ từ đã lưu, bền vững xuyên suốt mọi cuốn sách — **kể cả sau khi sách nguồn đã bị xóa** (quyết định thiết kế mới, v1.1: từ vựng là tài sản học tập của người dùng, độc lập vòng đời với cuốn sách sinh ra nó).

**Layout:** Header "Vocabulary" + đếm tổng số từ + SearchBar + Filter theo sách. Table 4 cột: Word | Pinyin | Meaning | Nguồn.

**Cột "Nguồn" (cập nhật v1.1):** hiện tên sách dạng chip; nếu sách nguồn đã bị xóa, chip đổi thành style nhạt hơn (text-tertiary, không phải link) với label "Đã xóa" thay vì tên sách — từ vựng và nghĩa vẫn hiển thị đầy đủ bình thường, chỉ mất khả năng "Xem trong sách".

**Interactions:** click hàng → popover full info (như trước); "Mark known" → mờ đi, rơi xuống cuối sort mặc định; nếu sách nguồn còn tồn tại, có nút "Xem trong sách" trong popover; nếu đã xóa, nút này ẩn.

**States:** default; filtering; empty (13.3); loading skeleton.

---

### 6.11 Bookmarks

**Mục đích:** xem và nhảy nhanh tới vị trí đã đánh dấu.

**Cập nhật v1.1 — vòng đời bookmark:** bookmark gắn chặt với một `sentenceId` cụ thể của một phiên bản sách cụ thể. Khi sách bị **xóa**, toàn bộ bookmark của sách đó bị xóa theo (đã cảnh báo rõ ở dialog xóa, 4.8) — khác với Vocabulary, bookmark không có ý nghĩa nếu tách khỏi cuốn sách nó trỏ tới. Khi sách bị **thay thế/nhập lại**, bookmark cũ bị vô hiệu vì cấu trúc câu có thể đã thay đổi hoàn toàn sau khi parse lại (đã cảnh báo ở 4.8).

**Layout/Interactions:** không đổi so với v1.0 — danh sách theo sách/chương, click → jump vào Reader với highlight tạm thời.

**States:** default; empty (13.3).

---

### 6.12 Settings (app-wide)

**Cập nhật v1.1:** nhóm "Dung lượng" mở rộng thành **"Thư viện & Dung lượng"** — hiện tổng dung lượng tất cả sách đã import, danh sách rút gọn top sách chiếm nhiều dung lượng nhất kèm link nhanh tới Book Detail để cân nhắc xóa. Thêm 1 dòng thông tin nhỏ, không phải cảnh báo: "Dữ liệu được lưu trên trình duyệt này" — đặt kỳ vọng đúng về phạm vi lưu trữ local-first (Section 3.6), tránh hiểu lầm rằng có backup đám mây.

Các nhóm khác (Giao diện, Về ứng dụng) giữ nguyên như v1.0. Mục "Tài khoản" được **loại bỏ** khỏi v1.1 (thay vì để "nếu có" như v1.0) — nhất quán với quyết định local-first, không tài khoản ở Section 3.6.

---

### 6.13 Error States (bộ 7 — bổ sung 1 so với v1.0)

Xem ma trận đầy đủ ở Section 13.2. Bổ sung v1.1: **Book unavailable/corrupted** (dữ liệu sách đã xử lý bị mất/hỏng giữa các phiên) là trạng thái lỗi thứ 7, được xử lý ở cả Library (Book Card) và Reader (banner toàn trang nếu xảy ra giữa lúc đang đọc).

### 6.14 Empty States (bộ 4)

Không đổi so với v1.0 — Section 13.3.

---

## 7. Component Hierarchy

```
AppShell
├── GlobalNav                      (ẩn trong Reader)
├── LibraryPage
│    ├── LibraryHeader (SearchBar, SortDropdown)
│    ├── BookRow (Continue Reading)
│    ├── BookGrid → BookCard
│    │    ├── CoverImage
│    │    ├── ProgressBar (thin)
│    │    ├── StatusBadge (translating / failed / unavailable)
│    │    └── IconButton (kebab: Detail / Continue / Replace / Delete)
│    ├── ImportModal (mode: new | replace)
│    │    └── Dropzone
│    ├── ImportProcessing
│    │    ├── ProgressBar (labeled)
│    │    └── StepIcon
│    └── DeleteConfirmDialog
├── BookDetailPage                 (mới, v1.1)
│    ├── BookDetailHeader
│    ├── ProgressBar (labeled) × reading, translation
│    ├── StatLink (bookmarks count, vocabulary count)
│    ├── SecondaryButton (Replace)
│    └── DestructiveTextButton (Delete)
├── ReaderPage
│    ├── ReaderTopBar (auto-hide)
│    ├── ChapterList (Contents) / IconRail
│    ├── ReaderContent
│    │    ├── ChapterHeader
│    │    └── Paragraph
│    │         ├── ChineseSentence → WordToken (interactive)
│    │         └── Translation
│    ├── ReaderProgressBar
│    ├── SearchBar (inline overlay) → SearchResultList → SearchResultItem
│    ├── DictionaryPanel
│    │    ├── WordHeader, PosBadge, SourceBadge (AI, chỉ khi LLM fallback)
│    │    ├── ExampleSentence, RelatedWordChip
│    │    └── PrimaryButton (Add/Added toggle)
│    └── ReaderSettingsPanel
├── VocabularyPage
│    ├── VocabularyHeader
│    ├── VocabularyTable → VocabularyRow → SourceChip (active | deleted)
│    └── VocabularyDetailPopover
├── BookmarksPage
│    └── BookmarkList → BookmarkItem
├── SettingsPage
│    └── SettingsSection → SettingsRow (bao gồm StorageBreakdown)
└── Shared / Primitives
     ├── Modal, ConfirmDialog, Toast, Tooltip
     ├── Skeleton, EmptyState
     ├── ErrorBanner (inline) / ErrorState (full-block)
     ├── Button (Primary / Secondary / Destructive-text / Icon)
     ├── Input, Badge / Chip, ProgressBar (thin / labeled)
```

**Component glossary (state quan trọng, cập nhật v1.1):**

| Component | Trạng thái cần hỗ trợ |
|---|---|
| `WordToken` | default, hover, active, known |
| `DictionaryPanel` | closed, loading, partial, complete, complete-ai, unavailable, error |
| `BookCard` | default, hover, translating, import-failed, unavailable/corrupted |
| `DeleteConfirmDialog` | default (mở), confirming (đang xử lý xóa), error (xóa thất bại — hiếm, nhưng cần state) |
| `ImportModal` | mode: new / replace |
| `SourceChip` (Vocabulary) | active (link được), deleted (nhạt, không link) |
| `ProgressBar (labeled)` | Uploading/Parsing/Extracting/Processing/Ready/Error (import) — độc lập với Translating/Partially/Fully (translation) |

---

## 8. Design System (Design Tokens)

*(Không đổi so với v1.0.)*

### 8.1 Spacing
```
--space-1: 4px    --space-2: 8px    --space-3: 12px
--space-4: 16px   --space-5: 24px   --space-6: 32px
--space-7: 48px   --space-8: 64px   --space-9: 96px
```

### 8.2 Radius
```
--radius-sm: 6px     --radius-md: 10px    --radius-lg: 16px    --radius-full: 999px
```

### 8.3 Shadow
```
--shadow-sm: 0 2px 8px rgba(0,0,0,0.08)
--shadow-md: 0 8px 24px rgba(0,0,0,0.10)
--shadow-lg: 0 16px 40px rgba(0,0,0,0.16)
```
Dark mode: kết hợp thêm `border: 1px solid var(--color-border)` cùng shadow opacity cao hơn (~0.4–0.5).

### 8.4 Border
```
--border-width-thin: 1px
--border-width-thick: 2px
```

### 8.5 Animation
```
--duration-fast: 120ms   --duration-base: 200ms   --duration-slow: 320ms
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1)
--ease-out: cubic-bezier(0, 0, 0.2, 1)
--ease-in: cubic-bezier(0.4, 0, 1, 1)
```

### 8.6 Breakpoints
```
--bp-mobile: max-width 767px
--bp-tablet: 768px – 1023px
--bp-laptop: 1024px – 1279px
--bp-desktop: min-width 1280px
```

---

## 9. Typography

*(Không đổi so với v1.0.)*

### 9.1 Font stacks

| Vai trò | Font stack | Lý do |
|---|---|---|
| Chinese reading text | `"Noto Serif SC", "Source Han Serif SC", serif` | Cảm giác "sách in", phù hợp đọc dài hơi |
| Chinese (alt, Sans) | `"Noto Sans SC", sans-serif` | Tùy chọn trong Reader Settings |
| Vietnamese reading text | `"Be Vietnam Pro", "Inter", system-ui, sans-serif` | Full dấu tiếng Việt, x-height tốt ở cỡ nhỏ |
| UI chrome | `"Inter", system-ui, sans-serif` | Tách biệt "công cụ" khỏi "nội dung sách" |

### 9.2 Reading type scale (5 nấc, lưu bền vững theo lựa chọn người dùng)

| Nấc | Chinese size | Chinese line-height | Vietnamese size | Vietnamese line-height |
|---|---|---|---|---|
| S | 17px | 1.9 | 13px | 1.6 |
| M | 19px | 1.9 | 14px | 1.6 |
| **L (mặc định)** | **21px** | **1.9** | **15px** | **1.6** |
| XL | 24px | 1.85 | 17px | 1.55 |
| XXL | 28px | 1.8 | 19px | 1.5 |

Khoảng cách trong 1 cặp câu: `--space-1` (4px). Khoảng cách giữa các cặp câu: `--space-5` (24px).

### 9.3 UI type scale
```
--text-xs: 12px  --text-sm: 13px  --text-base: 14px
--text-md: 16px  --text-lg: 20px  --text-xl: 24px  --text-2xl: 32px
```

---

## 10. Color System

*(Không đổi so với v1.0 — bổ sung 1 semantic mapping mới cho badge AI.)*

### 10.1 Light mode

| Token | Hex | Dùng cho |
|---|---|---|
| `--color-bg` | `#FAF7F1` | Nền toàn app |
| `--color-surface` | `#FFFFFF` | Card, panel, modal |
| `--color-surface-sunken` | `#F1ECE2` | Input, hover bg, skeleton |
| `--color-border` | `#E6E0D3` | Viền, divider |
| `--color-text-primary` | `#211D17` | Chinese text, heading |
| `--color-text-secondary` | `#6E6656` | Vietnamese, caption |
| `--color-text-tertiary` | `#A69C89` | Metadata, placeholder, badge AI |
| `--color-accent` | `#2F6F5E` | Primary action, link, progress |
| `--color-accent-hover` | `#26594B` | Hover của accent |
| `--color-accent-soft` | `#E4EFEA` | Hover từ, tab active, badge |
| `--color-success` | `#3F8F5F` | Xác nhận, "Ready to read" |
| `--color-warning` | `#B9822E` | Cảnh báo (file lớn, khối cảnh báo Replace) |
| `--color-error` | `#C24B3F` | Lỗi, nút "Xóa sách" (text-only) |

### 10.2 Dark mode

| Token | Hex |
|---|---|
| `--color-bg` | `#14171A` |
| `--color-surface` | `#1C2024` |
| `--color-surface-sunken` | `#23282D` |
| `--color-border` | `#2C3237` |
| `--color-text-primary` | `#ECE8DF` |
| `--color-text-secondary` | `#A6A198` |
| `--color-text-tertiary` | `#706C63` |
| `--color-accent` | `#5FB393` |
| `--color-accent-hover` | `#74C1A3` |
| `--color-accent-soft` | `#1E332C` |
| `--color-success` | `#5FB393` |
| `--color-warning` | `#D9A24B` |
| `--color-error` | `#E0685A` |

### 10.3 Semantic mapping bổ sung

| Ngữ cảnh | Token |
|---|---|
| Gạch chân dotted khi hover từ | `--color-text-tertiary` |
| Background khi hover/xem trong tooltip | `--color-accent-soft` |
| Vùng câu vừa jump tới (Search/Bookmark) | `--color-accent-soft`, fade `--duration-slow` |
| Focus ring | accent 40% opacity, 2px, offset 2px |
| Text selection | `--color-accent-soft` nền |
| **Badge "AI" (dictionary LLM fallback)** | viền `--color-border`, chữ `--color-text-tertiary` — cố tình trung tính, không dùng accent, để không trông như một tính năng được quảng bá mà là một ghi chú minh bạch |
| **Nút "Xóa sách"** | `--color-error`, style text-only/outline (không solid) để tránh nổi bật quá mức so với hành động chính "Tiếp tục đọc" |

---

## 11. Responsive Design

| Breakpoint | Contents (Reader) | Dictionary Panel | Reading pane width |
|---|---|---|---|
| Desktop ≥1280px | Cột cố định 260px, thu icon-rail được | Overlay 380px từ phải | max-width 680px |
| Laptop 1024–1279px | Mặc định icon-rail 56px | Overlay 380px, đè lên reading pane | max-width 680px |
| Tablet 768–1023px | Drawer từ trái | Side-sheet 70% width | full width − padding 24px |
| Mobile <768px | Drawer full-height | Bottom sheet (60→100%) | full width − padding 16px |

Book Detail (mới): Desktop 2 cột (cover trái, info phải); Tablet/Mobile 1 cột, cover thu nhỏ lên đầu, action cuối trang full-width.

Nguyên tắc chung không đổi: Dictionary/Contents luôn là overlay/drawer nổi trên, không đẩy layout Reading pane.

---

## 12. Interaction Design

### 12.1 Word hover (tooltip preview) — cập nhật theo kiến trúc dictionary v1.1
- Delay: 150ms.
- **Chỉ tra Local + Cache** (không bao giờ gọi External/LLM ở bước hover — Section 3.5).
- Hit → gạch chân dotted (`--color-text-tertiary`) + tooltip fade+translateY, `--duration-fast`, `--shadow-md`.
- Miss ở cả 2 tầng rẻ → tooltip vẫn hiện nhưng nội dung là gợi ý nhẹ "Nhấn để tra cứu đầy đủ" thay vì gọi API/LLM ngầm hay hiện spinner cho một cử chỉ chỉ là "lướt qua".
- Vị trí thông minh: tự lật trên/dưới, tự căn lề theo mép viewport, không bao giờ bị cắt.

### 12.2 Click từ → mở Dictionary Panel
- Tooltip đóng ngay; panel trượt vào từ phải (`--duration-slow`, `--ease-out`); chạy chuỗi tra cứu đầy đủ Local→Cache→External→LLM, hiện state loading/partial/complete/complete-ai/unavailable/error tương ứng (13.4).
- Đóng: Esc, click backdrop, hoặc ×.

### 12.3 Reader chrome auto-hide
Không đổi: 3 giây không tương tác → fade out top bar + progress; bất kỳ tương tác nào → hiện lại ngay.

### 12.4 Reading mode "Dịch khi cần"
Không đổi: `[Xem bản dịch]` → click → height auto-expand + fade, giữ trạng thái mở tới khi rời trang/đổi mode.

### 12.5 Drag & drop import — cập nhật v1.1 (phân biệt New vs Replace)
- Thả vào **vùng trống** của Library → luôn là import mới.
- Thả **đúng lên một Book Card cụ thể** → hệ thống hiểu là ý định thay thế, hiện prompt xác nhận "Thay thế sách này bằng file mới?" trước khi vào Import Processing — tránh người dùng vô tình ghi đè một cuốn sách đang đọc dở.

### 12.6 Search → jump to sentence
Không đổi: scroll mượt, highlight `--color-accent-soft` 2s rồi fade.

### 12.7 Xóa / Thay thế sách (mới, v1.1)
- Click "Xóa sách" → `ConfirmDialog` xuất hiện (modal nhỏ, căn giữa, `--shadow-lg`) — nội dung cảnh báo cụ thể những gì sẽ mất (bookmark, tiến trình) và những gì được giữ (từ vựng) — không dùng dialog xác nhận chung chung "Bạn có chắc chắn?".
- Nút "Xóa" trong dialog dùng `--color-error` solid (đây là nơi duy nhất hành động xóa dùng solid — bên ngoài dialog nó luôn ở dạng text/outline nhẹ hơn để tránh bấm nhầm).
- Sau khi xác nhận: dialog đóng, Book Card fade-out (`--duration-base`) khỏi grid, các card còn lại reflow mượt, Toast xác nhận cuối cùng.

---

## 13. Loading / Error / Empty States

### 13.1 Loading states (giữ nguyên từ v1.0)

| Vị trí | Trigger | Hiển thị |
|---|---|---|
| Book Card đang tải danh sách | Library vừa mở, đọc từ persistent storage | Skeleton shimmer |
| Câu đang dịch trong Reader | Sentence `translating` | "Đang dịch…" chữ nghiêng, không dùng skeleton bar |
| Search index | Ngay sau import, chưa build xong | 3 dot cạnh input, vẫn gõ được |

### 13.2 Error states (bộ 7, +1 so với v1.0)

| Trường hợp | Thông điệp | Hành động |
|---|---|---|
| File không được hỗ trợ | "Định dạng file này chưa được hỗ trợ" | "Chọn file khác" |
| EPUB lỗi/hỏng | "Không đọc được file này" | "Thử file khác" |
| Import thất bại giữa chừng | "Import không thành công" (nêu rõ bước lỗi) | "Thử lại" + "Hủy" |
| Dịch một câu thất bại | icon ⟳ nhỏ cạnh câu | Click để dịch lại câu đó |
| Dictionary lookup lỗi kỹ thuật | "Không thể tải từ điển lúc này" | "Thử lại" trong panel |
| Mất kết nối mạng (chung) | Banner mảnh trên Reader | Tự ẩn khi có mạng lại |
| **Book unavailable/corrupted** *(mới)* | Trên Library: badge "Không khả dụng" trên card; trên Reader: banner toàn trang "Không thể tải tiếp nội dung sách này" | "Nhập lại" (Library) / "Quay lại Library" (Reader) |

### 13.3 Empty states (bộ 4, không đổi)

| Ngữ cảnh | Heading | Action |
|---|---|---|
| Search trong sách không ra kết quả | "Không tìm thấy" | — |
| Vocabulary chưa có từ nào | "Bạn chưa lưu từ nào" | "Bắt đầu đọc" |
| Bookmarks chưa có mục nào | "Chưa có bookmark nào" | — |
| Library search không ra sách nào | "Không tìm thấy sách phù hợp" | — |

### 13.4 Dictionary lookup states (mới, chi tiết hóa quyết định chốt #3)

| State | Điều kiện | Hiển thị (Tooltip) | Hiển thị (Panel) |
|---|---|---|---|
| Hit (rẻ) | Có ở Local hoặc Cache | Hiện ngay, đầy đủ nghĩa ngắn | — |
| Miss (rẻ) | Không có ở Local/Cache | "Nhấn để tra cứu đầy đủ" | — |
| Loading | Panel vừa mở, chưa có dữ liệu từ tầng nào | — | Skeleton toàn bộ |
| Partial | Có 1 phần (vd pinyin), phần còn lại đang chờ External | — | Phần có hiện ngay, phần thiếu skeleton, fade-in khi về |
| Complete (Dictionary) | Local/Cache/External có đủ | — | Đầy đủ, không badge |
| Complete (AI fallback) | Chỉ LLM fallback có kết quả | — | Đầy đủ + badge `AI` |
| Unavailable | Cả 4 tầng đều trống | — | "Không tìm thấy nghĩa" + "Báo lỗi từ này" |
| Error | Lỗi kỹ thuật khi gọi External/LLM | — | Thông điệp lỗi + "Thử lại" |

### 13.5 Library & Book Lifecycle states (mới)

| State | Ý nghĩa | Nơi hiển thị |
|---|---|---|
| Empty Library | Chưa từng import hoặc đã xóa hết | 6.3 |
| Uploading | Đang tải file lên | 6.5 |
| Importing/Parsing | Đang tách chương/xử lý text | 6.5 |
| Ready to read | Import xong, mở được, dịch có thể chưa xong | Book Card, Book Detail |
| Translation in progress | Background translation đang chạy | Badge "Đang dịch N%" |
| Partially translated | Một phần chương đã dịch xong | Progress bar trong Book Detail |
| Fully translated | 100% đã dịch | Không badge đặc biệt (trạng thái "im lặng" là mặc định mong muốn) |
| Import failed | Lỗi trong pipeline import | Badge "Nhập thất bại" + "Thử lại" trong Book Detail |
| Translation failed (cấp câu) | 1+ câu dịch lỗi | icon ⟳ tại câu, không ảnh hưởng badge cấp sách trừ khi lỗi hàng loạt |
| Unavailable/corrupted | Dữ liệu đã xử lý bị mất/hỏng | Badge "Không khả dụng" + "Nhập lại" |
| Delete confirmation | User bấm "Xóa sách" | ConfirmDialog (12.7) |
| Replace/re-import flow | User bấm "Thay thế/Nhập lại" | Import Modal mode=replace (6.4) |

---

## 14. Large-Book UX & Performance

### 14.1 Pipeline xử lý sách

```
[Import pipeline — chặn "Ready to read", diễn ra 1 lần mỗi khi import/replace]
Uploading → Parsing → Extracting chapters → Processing text → Ready to read
                                                                  │
                                                                  ▼
                                                     Ghi vào thư viện bền vững
                                                     "Open book" khả dụng
                                                                  │
[Background Translation — KHÔNG chặn, có thể chạy xuyên nhiều phiên]  ▼
Not translated → Translating (theo câu/đoạn) → Partially translated
                → Fully translated  (hoặc → Failed cho câu cụ thể)
```

Nguyên tắc cốt lõi không đổi: **"Ready to read" của import ≠ "Ready" của translation.**

### 14.2 Trạng thái dịch cấp câu

| Status | Hiển thị trong reading pane |
|---|---|
| `not_translated` | Chỉ có Chinese |
| `translating` | "Đang dịch…" (nghiêng, text-tertiary) |
| `ready` | Bản dịch hiển thị bình thường |
| `failed` | Icon ⟳ + "Không dịch được câu này" |

### 14.3 Translation progress (cấp sách)
Hiển thị ở cả Book Card (rút gọn) và Book Detail (đầy đủ): thanh progress + % + 2 hành động "Dịch chương đang đọc ngay" / "Dịch toàn bộ phần còn lại".

### 14.4 Ưu tiên dịch theo vị trí đọc
Ưu tiên: (1) chương đang mở, (2) chương kế tiếp, (3) phần còn lại theo thứ tự — không dịch tuần tự cứng từ đầu sách.

### 14.5 Virtualization / lazy loading (chi tiết hóa quyết định chốt #1)
- Render theo **cấp chương**: chỉ chương đang đọc + 1 chương liền kề giữ trong DOM; chương xa hơn unmount nhưng **dữ liệu vẫn còn trong persistent storage**, không cần fetch lại từ file gốc.
- Trong 1 chương dài: windowing ở cấp đoạn văn, placeholder giữ chiều cao ước lượng cho phần chưa render.
- Contents, Vocabulary, Bookmarks cũng cần virtualization nếu số lượng mục lớn.

### 14.6 Persistent storage & caching (mới, v1.1)
- Nội dung sách đã xử lý (chương, câu, bản dịch) được lưu vào persistent storage của trình duyệt **ngay sau bước Processing text** — không cần giữ file gốc trong bộ nhớ để đọc lại sau này; việc mở lại một sách đã có trong thư viện không lặp lại bước "Parsing" từ đầu.
- Kết quả dictionary lookup (đặc biệt từ External Provider và LLM fallback, vốn có chi phí/độ trễ) được ghi vào **Dictionary Cache** bền vững, độc lập với từng cuốn sách — một từ tra ở sách A có thể được tái sử dụng tức thời khi gặp lại ở sách B.
- Vì storage có giới hạn, Settings (6.12) cung cấp cái nhìn tổng quan dung lượng theo từng sách để người dùng chủ động dọn dẹp — bản thân app không tự động xóa sách của người dùng dưới bất kỳ hình thức nào.

---

## 15. Accessibility

- Keyboard navigation đầy đủ cho mọi tương tác chính (Section 16).
- Focus ring: outer glow accent 40%, 2px, offset 2px.
- Tương tác từ không phụ thuộc hover: tap = mở tooltip preview ngay (đọc Local/Cache); tap lần 2 hoặc nút trong tooltip = mở Dictionary Panel đầy đủ.
- **ConfirmDialog (Delete)**: focus trap trong dialog khi mở, focus quay lại đúng phần tử đã trigger khi đóng, `role="alertdialog"` (vì đây là hành động phá hủy dữ liệu, mức độ cảnh báo cao hơn dialog thường).
- ARIA roles:

| Component | Role/thuộc tính |
|---|---|
| Tooltip preview | `role="tooltip"`, `aria-describedby` |
| Dictionary Panel | `role="dialog"`, `aria-modal="false"` |
| WordToken | `role="button"`, `tabindex="0"`, `aria-label` = Hán tự + pinyin |
| Delete Confirm Dialog | `role="alertdialog"`, `aria-modal="true"` |
| Badge "AI" | `aria-label="Định nghĩa do AI tạo"` để screen reader đọc được ý nghĩa badge, không chỉ chữ "AI" |

- Tương phản màu: mọi cặp text/bg đạt WCAG AA tối thiểu ở cả 2 theme.
- `aria-live="polite"` cho Toast (thêm từ vựng, bookmark, xóa sách thành công).

---

## 16. Keyboard Shortcuts

*(Không đổi so với v1.0.)*

| Phím | Hành động | Phạm vi |
|---|---|---|
| `↑` `↓` / cuộn | Di chuyển trong trang đọc | Reader |
| `←` `→` | Chương trước/sau | Reader |
| `Space` | Toggle ReaderTopBar & Progress | Reader |
| `B` | Bookmark vị trí hiện tại | Reader |
| `S` | Mở/đóng Search | Reader |
| `D` | Mở Dictionary (từ đang focus) | Reader |
| `Esc` | Đóng popup/panel/dialog đang mở | Toàn app |
| `?` | Hiện danh sách phím tắt | Toàn app |

---

## 17. Developer Handoff Notes (cho Antigravity)

### 17.1 Data shapes gợi ý (cập nhật v1.1 — mô tả field, không phải code)

**Book**
| Field | Kiểu | Ghi chú |
|---|---|---|
| id, title, author | string | |
| coverUrl | string \| null | |
| sourceFormat | enum: epub / txt / html / md | |
| fileSizeBytes | number | dùng cho Settings storage breakdown |
| importStatus | enum: uploading / parsing / extracting / processing / ready_to_read / failed / unavailable | *(bổ sung `unavailable` so với v1.0)* |
| translationProgress | number (0–100) | độc lập với importStatus |
| readingProgress | number (0–100) + `lastReadSentenceId` + `lastReadChapterIndex` | ghi liên tục, debounce ngắn — Section 6.6 |
| lastOpenedAt | timestamp | *(mới)* dùng cho sort "Mở gần đây nhất" & Book Card metadata |
| chapters | list<Chapter> | lazy-load theo chương |

**Chapter / Sentence** — không đổi so với v1.0 (id, index, chineseText, vietnameseText, translationStatus).

**DictionaryLookupResult** *(mới, v1.1 — thay thế mô tả chung chung trước đây)*
| Field | Kiểu | Ghi chú |
|---|---|---|
| word, pinyin, meaning, partOfSpeech | string \| null | có thể null từng phần ở state `partial` |
| examples | list<{chinese, vietnamese}> | |
| source | enum: local / cache / external / llm | quyết định có hiện badge `AI` hay không (`llm` → hiện) |
| completeness | enum: complete / partial | điều khiển state Panel ở 13.4 |
| fetchedAt | timestamp | dùng để cân nhắc làm mới cache theo thời gian nếu cần (chính sách TTL do Antigravity quyết định, không nằm trong phạm vi thiết kế này) |

**DictionaryCacheEntry** *(mới)*: `word`, `result` (DictionaryLookupResult), `cachedAt` — lưu persistent, độc lập theo sách, tra cứu trước Local/External mỗi lần cần tầng 2 (Section 3.5).

**VocabularyItem** — thêm field `sourceBookAvailable: boolean` *(mới)* để UI Vocabulary (6.10) quyết định hiện chip "active" hay "deleted" mà không cần join trực tiếp với bảng Book mỗi lần render.

**Bookmark** — không đổi field, nhưng vòng đời gắn chặt với Book: xóa Book → cascade xóa toàn bộ Bookmark của Book đó (Section 6.11).

### 17.2 Quy ước đặt tên design token
Không đổi — tiền tố `--color-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--text-*`, `--duration-*`, `--ease-*`, `--bp-*`, map 1-1 sang CSS custom properties/Tailwind theme.

### 17.3 Bốn quyết định đã CHỐT (không còn là giả định)

1. **Cơ chế cuộn chương:** Infinite scroll giữa các chương, kèm lazy loading/virtualization cấp chương (chỉ chương hiện tại ± 1 giữ trong DOM), không bao giờ load toàn bộ sách vào DOM. Vị trí đọc (`lastReadSentenceId`) được persist độc lập với việc DOM có giữ chương đó hay không, ghi liên tục xuống storage bền vững — không phụ thuộc việc chương có đang được render hay đã unmount. Chi tiết: Section 3.3, 6.6, 14.5.

2. **Bookmark & Dictionary IA:** Giữ nguyên là panel/overlay ngữ cảnh, không lên global nav. Dictionary có 2 tầng tương tác rõ rệt — hover → Quick Tooltip (chỉ Local/Cache), click → Full Side Panel (toàn bộ chuỗi tra cứu). Bookmark luôn thao tác được trực tiếp từ Reader qua icon/phím `B`, không có luồng nào buộc rời Reader. Toàn bộ state/transition đã liệt kê tường minh ở Section 6.7, 6.11, 12.1–12.2, 12.7. Chi tiết quyết định: Section 3.4.

3. **Nguồn dữ liệu Dictionary:** Kiến trúc provider-agnostic, chuỗi ưu tiên **Local → Cache → External → LLM fallback** (optional). Hover chỉ đọc 2 tầng đầu (không gọi API/LLM tốn phí cho một cử chỉ nhẹ). Cache là bền vững, dùng lại xuyên sách/phiên. UI xử lý đầy đủ 5 state: loading/partial/complete/unavailable/error, cộng thêm badge minh bạch khi dùng LLM fallback. Chi tiết: Section 3.5, 6.7, 12.1–12.2, 13.4, 17.1 (DictionaryLookupResult/DictionaryCacheEntry).

4. **Library Persistence & Book Lifecycle:** Upload một lần → sách + toàn bộ dữ liệu học tập (tiến trình đọc, bookmark, từ vựng, trạng thái dịch, cache dictionary) tồn tại bền vững qua mọi phiên, cho tới khi user chủ động xóa. Vòng đời đầy đủ: `Upload → Importing → Ready to read → Background Translation (song song, không chặn) → Continue Reading (bất kỳ lúc nào từ Ready to read trở đi) → [tùy chọn] Replace/Re-import → Delete`. Xóa sách cascade xóa Bookmark + reading progress + translation cache của sách đó, nhưng **giữ lại Vocabulary** (đánh dấu nguồn "Đã xóa"). Thay thế/nhập lại reset tiến trình đọc + bookmark, giữ vocabulary. **Phạm vi v1.0/v1.1 là local-first, một thiết bị, không tài khoản** — đồng bộ đa thiết bị nằm ngoài phạm vi (xem 17.4). Chi tiết đầy đủ: Section 1, 2 (#5), 3.6, 4.2, 4.8, 6.1, 6.2, 6.4, 6.5, 6.10, 6.11, 6.12, 6.13, 12.5, 12.7, 13.5, 14.6.

### 17.4 Gợi ý mở rộng tương lai (ngoài phạm vi v1.1, chỉ để tham khảo)

- **Đồng bộ đa thiết bị / tài khoản:** nếu về sau cần mở rộng ngoài phạm vi local-first hiện tại, cần thiết kế lại Section 3.6, thêm màn hình đăng nhập, và định nghĩa chiến lược merge dữ liệu (đặc biệt là reading progress và vocabulary) khi cùng một sách được đọc trên 2 thiết bị — không nằm trong phạm vi bản thiết kế này.
- **Export/backup thư viện:** vì dữ liệu là local-first, một tính năng export (ví dụ ra file) có thể giúp người dùng an tâm trước rủi ro mất dữ liệu trình duyệt — ý tưởng cho roadmap, chưa đặc tả chi tiết.
- **Liên kết với app flashcard SM-2/SRS hiện có của Duc:** cho phép xuất từ vựng đã lưu trong Chinese Reader sang định dạng tương thích để ôn tập bằng SRS — vẫn là ý tưởng ngoài phạm vi v1.1, không nên chặn việc implement các phần đã đặc tả ở trên.

---

*Hết tài liệu v1.1. Cả 14 màn hình, component system, design tokens, và toàn bộ quy tắc hành vi — bao gồm 4 quyết định đã chốt và yêu cầu Library Persistence & Book Lifecycle — đã được phản ánh nhất quán xuyên suốt tài liệu, sẵn sàng để Antigravity implement.*
