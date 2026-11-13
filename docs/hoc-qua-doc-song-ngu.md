# Học tiếng Trung bằng đọc sách song ngữ — phân tích & thiết kế lại

## 1. Vì sao app dịch chậm hoặc không dịch

| Nguyên nhân | Hậu quả | Đã sửa |
|---|---|---|
| Server gọi `translate.googleapis.com/translate_a/single`. Endpoint này đang trả **429 cho cả dải IP** (thử từ máy local và từ Render đều bị). | Gần như mọi câu → `failed`. | Chuyển sang `translate_a/t`: một POST gửi nhiều câu `q=…&q=…`, kết quả trả về là mảng **đúng thứ tự**. Có endpoint dự phòng `clients5…dict-chrome-ex`, endpoint bị 429 thì nghỉ 60 giây, và cache 5000 câu trên server. |
| Batch được ghép bằng marker `__CR0__` chèn vào văn bản rồi tách lại bằng regex. Google hay làm hỏng marker. | Câu bị `MALFORMED_PROVIDER_RESPONSE` và **không bao giờ tự thử lại**. | Bỏ marker, vì endpoint mới trả sẵn mảng. |
| Batch tối đa 10 câu / 500 ký tự (giới hạn độ dài URL của GET). | Một chương ~100 câu cần 10+ request. | Tăng lên 25 câu / 2500 ký tự (gửi bằng POST). Thử thật: 25 câu dịch xong trong ~1,2 giây. |
| Backend chạy Render free, ngủ khi không có truy cập, mất ~50 giây để khởi động lại. Client chỉ chờ 10 giây × 3 lần. | Lần mở đầu tiên trong ngày: cả chương báo lỗi. | Gọi `/api/health` để đánh thức server ngay khi mở reader. Request đầu chờ tối đa 60 giây, các request sau 20 giây. Thử tối đa 4 lần. |
| Câu đã `failed` được lưu trong IndexedDB và không bao giờ được xếp hàng lại. | Đã lỗi một lần là mất bản dịch vĩnh viễn. | Câu lỗi tự được thử lại một lần mỗi phiên khi lướt tới. |
| Chế độ "Khi cần" không dịch trước. | Bấm xong phải chờ mạng. | Dịch trước ở cả chế độ "Tự đọc trước"; bản dịch có sẵn nhưng bị làm mờ. |
| Endpoint `/api/translate/batch` **chưa được deploy** lên Render (gọi thì trả 404). | Bản production đang chạy không dịch được. | Cần deploy lại server (xem mục 5). |

## 2. Vì sao "hai cột song song" học kém hiệu quả

1. **Mắt luôn chọn đường dễ.** Khi câu tiếng Việt nằm ngay dưới câu tiếng Trung, người đọc sẽ đọc tiếng Việt để hiểu truyện, còn tiếng Trung chỉ được liếc qua. Các nghiên cứu eye-tracking về phụ đề song ngữ cho thấy cùng hiện tượng: phần lớn thời gian nhìn rơi vào dòng tiếng mẹ đẻ. Kết quả là đọc rất nhiều chương mà khả năng đọc tiếng Trung tăng rất ít.
2. **Không có bước tự nhớ lại (retrieval).** Ghi nhớ mạnh nhất khi người học *tự cố hiểu trước rồi mới kiểm tra* (testing effect — Roediger & Karpicke 2006; generation effect). Nếu đáp án luôn hiện sẵn thì bước này bị bỏ qua.
3. **Dịch theo câu không giải quyết đúng chỗ khó.** Theo Hu & Nation (2000) và Laufer & Ravenhorst-Kalovski (2010), muốn đọc hiểu mà không cần trợ giúp thì phải biết khoảng 95–98% số từ. Với 蛊真人 (tiên hiệp, nhiều thuật ngữ), người học trung cấp thường chỉ biết ít hơn nhiều. Chỗ khó nằm ở **từ**, nên cách hỗ trợ nên là chú giải từng từ (gloss — Hulstijn và cộng sự 1996). Một câu dịch nguyên văn không cho biết chữ nào nghĩa là gì.
4. **Máy dịch sai thuật ngữ và tên riêng.** Ví dụ thật từ server: Google dịch "方老魔" thành "Mạc Phương" / "Phương Lão Mộ", trong khi bản dịch người ghi đúng "Phương lão ma". Học từ bản dịch sai thì nhớ sai.

## 3. Những gì đã làm trong lần này

### 3.1 Chế độ **"Tự đọc trước"** (mặc định cho người dùng mới)
- Bản dịch được dịch sẵn nhưng **bị làm mờ**. Người học đọc câu tiếng Trung, tự đoán nghĩa, rồi bấm vào dòng mờ để đối chiếu. Bấm lần nữa để ẩn lại.
- Tra từ (hover / click) vẫn hoạt động như cũ, nên khi bí ở một từ thì tra từ trước, chưa cần mở cả câu.
- Ba chế độ trong phần cài đặt đều có dòng giải thích để người học biết nên dùng chế độ nào.

### 3.2 Bản dịch tham khảo do người dịch (căn chỉnh tự động)
Trang chi tiết sách → **"Nhập bản dịch tham khảo"** (EPUB/TXT).
- Bản dịch người được ưu tiên hiển thị thay máy dịch: chính xác, tên riêng nhất quán (Phương Nguyên, Xuân Thu Thiền, Cổ Nguyệt…), không tốn request, dùng được khi offline.
- Bản dịch chỉ lưu trong IndexedDB của trình duyệt, không gửi lên server.
- **Thuật toán** (`src/features/reference/aligner.ts`):
  - Khung chính là Gale–Church: căn chỉnh dựa trên độ dài, cho phép các kiểu ghép 1-1, 1-2, 2-1, 2-2, 1-0, 0-1, 1-3, 3-1. Có thêm tín hiệu "đoạn mở bằng dấu ngoặc kép" để nhận ra hội thoại.
  - Hai bản không cùng cách chia chương (bản Trung 2334 chương, bản Việt 3811 chương). Vì vậy bản Việt được coi là **một dòng đoạn văn liên tục**. Mỗi chương tiếng Trung được căn với cửa sổ tiếp theo của dòng đó, và thuật toán tự quyết chương kết thúc ở đâu ("free end").
  - Nếu một chương không khớp chắc chắn (lời tựa, ghi chú tác giả, chương bị thiếu hoặc xáo trộn trong bản Việt), app **tìm lại vị trí** bằng hồ sơ độ dài các đoạn đầu chương trên toàn bộ dòng. Nếu vẫn không thấy thì bỏ qua chương đó (chương ấy dùng máy dịch) mà không làm lệch các chương sau.
  - Sau khi khớp theo đoạn, app khớp tiếp tới cấp câu. Khi người dịch gộp nhiều câu Trung thành một câu Việt, bản dịch được gắn vào câu cuối của nhóm.
- **Kiểm chứng trên 蛊真人 + "Cổ Chân Nhân – Bản Chuẩn"**: 2334/2334 chương nội dung được khớp. Chỉ bỏ qua lời tựa, trang bản quyền, tiêu đề quyển và 3 chương. Khoảng 200 nghìn cặp đoạn khớp 1-1. Sau bước khớp cấp câu, **316.354 / 319.207 câu (99,1%) có bản dịch người**. Kiểm tra ngẫu nhiên ở đầu, giữa và cuối sách đều đúng nghĩa. Cả cuốn chạy khoảng 18 giây.
- Sách nhập trước bản này không có thông tin đoạn văn, nên app phải ghép theo câu và kém chính xác hơn. Nên vào **"Thay thế / Nhập lại"** sách tiếng Trung rồi ghép lại bản dịch.

### 3.3 Sửa bộ tách câu
- Xuống dòng (hết đoạn) luôn là ranh giới câu. Trước đây tiêu đề chương bị dính vào câu đầu tiên.
- Dấu đóng ngoặc `”` đi cùng câu của nó. Trước đây `“…痛快！` và `”“方老魔…` bị cắt sai, làm hỏng cả máy dịch lẫn việc ghép bản dịch.
- Mỗi câu lưu thêm `paragraphIndex` để ghép bản dịch theo đoạn và để sau này hiển thị theo đoạn.

### 3.4 Chế độ **"Việt + chữ Hán"** (mặc định mới, dành cho người mới học)
Người mới học chưa đọc được câu tiếng Trung, nên "Tự đọc trước" quá sức. Chế độ này đảo ngược vai trò: **bản dịch tiếng Việt là văn bản chính**, và tiếng Trung được "cấy" dần vào nó (kỹ thuật *diglot weave*: đọc ngôn ngữ mẹ đẻ, các từ của ngôn ngữ mới thay vào dần dần).

- **Từ nào được cấy:** app tìm trong từng cặp câu (gốc ↔ bản dịch) xem từ Trung nào tương ứng với cụm Việt nào:
  - **Từ Hán-Việt** (chính xác nhất): mỗi chữ Hán phải khớp đúng âm Hán-Việt của âm tiết Việt ở cùng vị trí. Ví dụ 方源 ↔ "Phương Nguyên", 春秋蝉 ↔ "Xuân Thu Thiền", 天罗地网 ↔ "thiên la địa võng", 蛊师 ↔ "cổ sư". Người Việt học nhóm từ này dễ nhất: nghe đã quen, chỉ cần nhận mặt chữ.
  - **Từ thuần Việt hay gặp:** 你 ↔ "ngươi", 他 ↔ "hắn", 杀 ↔ "giết"… lấy từ một danh sách nhỏ. Mỗi mục đã được kiểm chứng trên cả bộ truyện.
- **Thứ tự học:** theo độ phổ biến trong chính cuốn sách. Từ gặp nhiều nhất học trước (方源, 他, 这, 是, 我, 蛊师…), nên mỗi từ được gặp lại hàng trăm lần một cách tự nhiên.
- **Mỗi lần chỉ học vài từ** (5/10/20/40, mặc định 10). Khi thuộc một từ, từ tiếp theo xuất hiện. Văn bản cứ thế "Trung hoá" dần theo tốc độ của người đọc.
- **Từ có ba mức hiển thị:**
  1. Từ mới: chữ Hán, nghĩa tiếng Việt nhỏ ở trên.
  2. Sau 8 lần gặp: chỉ còn chữ Hán, người đọc phải tự nhớ nghĩa (luyện nhớ lại). Nếu phải bấm xem nghĩa thì từ lùi lại vài bước, nghĩa sẽ hiện thêm một thời gian.
  3. Đã thuộc (người đọc bấm "Đã nhớ", hoặc tự động sau 40 lần gặp): luôn hiện chữ Hán.
- **Bấm vào chữ Hán** mở thẻ từ: pinyin, nghe phát âm (giọng đọc của trình duyệt), âm Hán-Việt từng chữ, nghĩa trong câu, các nút Đã nhớ / Từ điển / Bỏ qua.
- **Bấm vào một câu** để xem câu gốc tiếng Trung ngay bên dưới, với các từ đang học được tô màu. Mỗi từ trong câu gốc vẫn tra được bằng từ điển.
- **Dữ liệu Hán-Việt** (`src/data/hanviet.json`, khoảng 140 KB, chỉ tải khi cần) được dựng bằng `scripts/build-hanviet.mjs`:
  - Nguồn chính: trường `kVietnamese` của Unicode Unihan, có chuyển âm từ chữ phồn thể sang chữ giản thể.
  - Unihan thiếu nhiều âm, ví dụ 源 chỉ có "nguồn", 春 không có âm nào. Script học thêm từ các cặp câu đã căn chỉnh: nếu các chữ còn lại của một từ đã khớp âm, âm tiết ở vị trí còn lại là âm của chữ đó. Âm chỉ được nhận khi xuất hiện trong ít nhất hai từ khác nhau. Kết quả học thêm được 393 âm.
- **Sách nhập bằng phiên bản cũ** không có thông tin đoạn văn. Khi ghép bản dịch, app ghép theo câu (vẫn đạt 2333/2344 chương), rồi **chia đoạn theo bản Việt**, nên không cần nhập lại sách.
- Nếu sách chưa có bản dịch người, đầu trang đọc có banner "Chọn file bản dịch" để ghép ngay tại đó.

## 4. Lộ trình đề xuất (chưa làm), xếp theo hiệu quả / công sức

1. *(Đã làm một phần ở mục 3.4: âm Hán-Việt trong thẻ từ.)* **Âm Hán-Việt cho từng chữ/từ** (dạng ruby hoặc tooltip). Đây là lợi thế lớn nhất của người Việt: rất nhiều từ văn chương và tiên hiệp có âm Hán-Việt quen thuộc, ví dụ 天罗地网 → *thiên la địa võng*, 春秋蝉 → *Xuân Thu Thiền*, 魔头 → *ma đầu*. Nguồn dữ liệu: trường `kVietnamese` của Unicode Unihan (giấy phép mở) cùng một từ điển Hán-Việt. Từ điển trong tooltip nên hiện cả âm Hán-Việt bên cạnh pinyin.
2. **Theo dõi từ đã biết** (đánh dấu "đã biết" ngay trong tooltip; mặc định coi các từ HSK 1–3 là đã biết). Tô nhẹ những từ chưa biết, và hiển thị "chương này bạn biết 93% số từ" để người học chọn đoạn vừa sức (mục tiêu 95–98%).
3. **Gloss chọn lọc**: chỉ chú nghĩa trên những từ hiếm hoặc chưa biết, không dịch cả câu. Đọc càng nhiều thì gloss càng ít đi.
4. **Ôn tập ngắt quãng (SRS)** cho trang Từ vựng, mỗi thẻ kèm câu ngữ cảnh lấy từ sách. Nếu có bản dịch người thì dùng câu đó làm mặt sau của thẻ.
5. **Bảng thuật ngữ tự trích** từ các cặp câu đã căn chỉnh (方源 ↔ Phương Nguyên, 蛊师 ↔ cổ sư). Dùng để thay tên riêng trong kết quả máy dịch ở những chương chưa có bản người, và làm bộ thẻ "thuật ngữ của truyện".
6. **Đọc theo đoạn**: gom câu theo `paragraphIndex`, đọc hết cả đoạn tiếng Trung rồi mới mở bản dịch đoạn. Cách này gần với đọc thật hơn là ngắt từng câu.
7. **Nghe**: TTS tiếng Trung (Web Speech API `zh-CN`) cho câu hoặc đoạn đang đọc, để luyện song song nghe và đọc.
8. **Đo tiến bộ**: thống kê tỉ lệ câu phải mở bản dịch theo thời gian. Tỉ lệ này giảm dần là dấu hiệu khả năng đọc đang tăng thật.

## 5. Vận hành
- **Phải deploy lại backend** (Render) để có `/api/translate/batch` và endpoint dịch mới. Bản đang chạy trả 404 cho batch và 429 cho dịch đơn.
- Endpoint Google không chính thức nên có thể bị chặn bất cứ lúc nào. Muốn ổn định lâu dài thì nên có một provider trả phí (Google Cloud Translation, hoặc một LLM có kèm bảng thuật ngữ) đặt sau cùng interface `translateMany`.
- Render free vẫn ngủ khi không ai dùng. Warm-up chỉ che bớt thời gian chờ, không loại bỏ được. Nếu cần nhanh ngay từ request đầu thì nâng gói hoặc dùng một dịch vụ ping định kỳ.
