# Dựng video hướng dẫn với OpenScreen

Đối chiếu ngày 02/10/2026, theo mã nguồn hiện tại và video mẫu [3D for Stack](https://www.youtube.com/watch?v=rRF4LRuFk1o). Mẫu sử dụng slide tiêu đề và các bước, đoạn quay thao tác phần mềm, vùng nổi bật trên nền tối và dấu nhấn con trỏ. “3D” trong mẫu là nội dung được quay từ phần mềm thiết kế; editor không cần tự dựng mô hình 3D đó.

OpenScreen phù hợp với video hướng dẫn và demo phần mềm. Chưa thể coi là bộ dựng tổng quát đầy đủ như CapCut. Microsoft mô tả cắt, tách và sắp xếp clip trong [hướng dẫn Clipchamp](https://support.microsoft.com/en-au/clipchamp/how-to-edit-a-video-in-clipchamp); CapCut có [trộn nhiều lớp âm thanh, cắt và chỉnh âm lượng từng lớp](https://www.capcut.com/tools/audio-mixing). Đây là những thao tác cơ bản cần ưu tiên bổ sung vào OpenScreen.

| Nhu cầu | OpenScreen trước lần bổ sung này | Hiện tại |
|---|---|---|
| Quay màn hình và nhấn con trỏ | Đã có màn hình/cửa sổ/vùng, mic, tiếng hệ thống, webcam và dấu nhấn con trỏ | Giữ nguyên |
| Zoom và làm nổi vùng cần chú ý | Đã có zoom, nhiều rectangle cùng sáng trên nền tối, chữ phía trên vùng focus | Giữ nguyên; đủ các công cụ chính cho kiểu hướng dẫn trong mẫu |
| Slide tiêu đề, các bước, chữ và logo | Đã có slide trống, nền, chữ/ảnh, hiệu ứng chữ và chuyển slide; clip vẫn chạy bên dưới | Slide có thời lượng riêng: tạm dừng video, webcam và audio; hết slide tiếp tục từ đúng vị trí nguồn |
| Clip video chèn trên timeline | Chèn và kéo trên canvas; chưa có hàng timeline để cắt/di chuyển thời gian | Mỗi clip có hàng riêng, chọn, kéo vị trí thời gian và cắt hai mép |
| Cắt và tách video/nhạc | Audio cắt mép trái chưa giữ đúng vị trí nguồn; video chèn chưa có điều khiển này | Có điểm bắt đầu trong file nguồn, thời lượng và tách tại đầu phát; đoạn bên phải tiếp tục đúng nội dung |
| Nhạc nền, lời thuyết minh từ file | Có nhập file audio, chưa có panel chỉnh riêng | Panel âm lượng, tắt/bật tiếng, tăng/giảm âm lượng dần; các file có thể chồng nhau trên hàng riêng |
| Âm thanh của video chèn | Video chèn luôn im lặng | Có thể bật và chỉnh âm lượng/fade riêng; mặc định im lặng để giữ tương thích |
| Đặt video thành cảnh toàn khung | Kéo/resize bằng tay | Thêm nút “Phủ video lên toàn canvas” |
| Lưu project và xuất MP4/GIF | Đã có | Lưu cả điểm cắt, âm lượng và fade; xuất dùng đúng điểm nguồn. GIF giữ định dạng không có âm thanh |

Clipchamp cũng có [fade cho video, ảnh, âm thanh và chuyển cảnh giữa các asset](https://support.microsoft.com/en-us/clipchamp/how-to-add-transitions-and-fades-to-videos). OpenScreen hiện có chuyển cảnh cho slide; fade vừa bổ sung ở panel clip là **fade âm thanh**, không phải bộ chuyển cảnh cho mọi cặp video.

## Cách dựng theo mẫu

1. Quay hoặc mở đoạn thao tác phần mềm làm video chính; cắt đoạn dư và chỉnh tốc độ trên timeline.
2. Đặt slide tiêu đề và slide các bước ở những khoảng cần giải thích. Thêm chữ/ảnh/logo và chọn chuyển slide. Trong toàn bộ khoảng slide, cả hình và tiếng của clip dừng lại; hết slide mới chạy tiếp. Ví dụ clip gốc 10 giây có slide dài 3 giây sẽ thành timeline 13 giây. Slide chồng nhau chỉ tính thời lượng hợp của các khoảng. Quy tắc này áp dụng khi xem trước và xuất MP4/GIF.
3. Thêm các rectangle vào các khoảng cần làm nổi phần mềm. Cho khoảng thời gian chồng nhau nếu muốn nhiều vùng cùng sáng; chỉnh mức phóng đại và đặt chữ phía trên.
4. Nếu cần thêm đoạn quay khác, chọn “Thêm video” tại đầu phát. Chọn clip trên hàng timeline, cắt hai mép hoặc nhập “Bắt đầu trong file gốc” và “Thời lượng”. Dùng “Tách tại đầu phát” để chỉnh từng đoạn độc lập. Dùng “Phủ video lên toàn canvas” cho cảnh toàn khung; dùng “Vừa khung” nếu muốn giữ đầy đủ hình nguồn.
5. Thêm file nhạc/lời thuyết minh, chọn clip audio và chỉnh âm lượng cùng khoảng tăng/giảm dần. Bật tiếng video chèn khi cần. Lưu project và xem lại trước khi xuất MP4.

## Giới hạn còn lại

- Timeline vẫn dựa vào video chính. Đây chưa phải bộ dựng nhiều clip độc lập có tự dồn toàn bộ cảnh và kéo dài dự án tùy ý như một NLE tổng quát.
- Keyframe vị trí/kích thước đã có cho video chính; chưa có bộ keyframe tùy ý cho mọi thuộc tính của mọi chữ/ảnh/video chèn.
- Chưa có đầy đủ chọn nhóm, khóa/ẩn layer, chỉnh màu chuyên sâu, chroma key và chuyển cảnh tùy ý giữa các video chèn. CapCut có các nhóm công cụ rộng hơn, ví dụ [keyframe, chroma key và chỉnh màu](https://www.capcut.com/tools/keyframe-animation).
- Những phần này không cần thiết để tái tạo bố cục chính của mẫu. Chưa có phép kiểm chứng một project OpenScreen tái dựng trọn vẹn từng khung hình của video mẫu; không nên hiểu việc đối chiếu là cam kết tái tạo chính xác toàn bộ video bằng một nút.
