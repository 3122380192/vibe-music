# 🎧 LAN Music Office & Game Zone Pro Realtime

Hệ thống chia sẻ âm nhạc đồng bộ thời gian thực (Time-Sync) và Đấu trường Trò chơi Trực tuyến (LAN & Online) xây dựng trên nền tảng **Node.js**, **Express**, **Socket.io** và **Web Audio API**.

---

## 🚀 Cách Khởi Chạy Nhanh

### 1. Chạy trong Mạng LAN Nội Bộ (WiFi văn phòng / nhà riêng)
- **Cách nhanh nhất**: Nhấp đúp vào file **`start.bat`**.
- Hoặc chạy bằng lệnh:
  ```bash
  npm start
  ```
- Mở trình duyệt tại: `http://localhost:3000` hoặc địa chỉ IP mạng LAN hiển thị trên màn hình (ví dụ `http://192.168.0.101:3000`).

---

### 2. Chạy Server Mở Rộng Online Toàn Cầu (Dành cho người ở xa qua Internet)
Nếu muốn đồng nghiệp hoặc bạn bè ở ngoài mạng LAN (kết nối 4G/5G/Internet khác WiFi) cũng có thể vào cùng phòng nghe nhạc và chơi game:
- **Cách nhanh nhất**: Nhấp đúp vào file **`start-online.bat`**.
- Hoặc chạy bằng lệnh:
  ```bash
  npm run online
  ```
- Server sẽ tự động tạo một đường hầm HTTPS an toàn (Localtunnel) và cấp đường link toàn cầu:
  ```text
  🌐 LINK ONLINE TOÀN CẦU: https://vibe-music-xxx.loca.lt
  📶 LINK MẠNG LAN:       http://192.168.0.101:3000
  ```
- Mã QR trong giao diện Web sẽ tự động đồng bộ cả 2 chế độ LAN và Online để mọi người quét mã dễ dàng.

---

### 3. Deploy Lên Cloud Chạy 24/7 Miễn Phí Từ GitHub (Render / Railway)
Kho lưu trữ mã nguồn: [https://github.com/3122380192/vibe-music](https://github.com/3122380192/vibe-music)

1. Đăng nhập vào [Render.com](https://render.com) (hoặc Railway.app).
2. Chọn **New Web Service** $\rightarrow$ Kết nối với repository GitHub `3122380192/vibe-music`.
3. Cấu hình tự động nhận diện từ file `render.yaml`:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
4. Bấm **Deploy Web Service** là bạn có ngay link online vĩnh viễn 24/7 (ví dụ: `https://vibe-music-xxx.onrender.com`).

---

## 🎮 Tính Năng Nổi Bật

1. **Phòng Nhạc Thời Gian Thực (Time-Sync Livestream)**:
   - Dán link YouTube hoặc tìm kiếm trực tiếp để thêm bài hát vào hàng chờ.
   - Cơ chế phát đồng bộ từng giây cho tất cả người nghe trong phòng.
   - Hệ thống biểu quyết (Vote Up / Down) tự động đẩy bài hát yêu thích lên đầu.
   - Nhận diện link tự động không cần bấm Enter.

2. **Khu Mini Game Giải Trí**:
   - **Tài Xỉu**: Hiệu ứng úp bát gốm sứ và đập vỡ bát 3D chân thực, kèm phân tích thống kê cầu chẵn lẻ.
   - **Xóc Đĩa**: Đồng xu phong cách truyền thống, hiển thị lịch sử ván đấu.
   - **Cờ Caro XO**: Đấu trí 1v1 đối kháng LAN, tích hợp AI gợi ý nước đi tối ưu cho Admin.
   - **Cờ Tướng**: Bàn cờ gỗ 9x10 chuẩn luật, quản lý quân cờ và gợi ý chiến thuật.
   - **Bầu Cua Tôm Cá**: Bàn đặt cược đầy đủ 6 linh vật dân gian.
   - **Minibox Arcade (Slot 777 & Bài Cào 3 Lá)**: Hũ Jackpot tích lũy nổ lớn và so điểm 3 lá hấp dẫn.

3. **Nhạc Nền Thư Giãn (Lo-Fi Chill Ambient Engine)**:
   - Tự động bật giai điệu lo-fi êm dịu khi người dùng vào Khu Trò Chơi.
   - Tổng hợp 100% offline bằng Web Audio API với các hợp âm Rhodes/Piano điện ấm áp và tiếng chuông gió thanh mảnh.
   - Có nút **Bật / Tắt nhanh** trên thanh Header, trên sàn đấu Game, và trong modal Arcade kèm thanh chỉnh âm lượng.
   - Tự động tắt khi người dùng quay về tab Phòng Nhạc để không lẫn tiếng với bài hát YouTube.

4. **Quản Lý Tên Hiển Thị Linh Hoạt**:
   - Không gò bó gợi ý đặt tên hay để lộ mật mã.
   - Người dùng có thể bấm trực tiếp vào tên của mình trên thanh Header để đổi biệt danh bất kỳ lúc nào.
