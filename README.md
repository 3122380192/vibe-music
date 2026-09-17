# 🎧 LAN Music Office - Trình Nghe Nhạc Mạng Nội Bộ Thời Gian Thực

Ứng dụng chia sẻ âm nhạc và thảo luận nội bộ cho văn phòng, chạy hoàn toàn trong mạng LAN sử dụng **Node.js**, **Express** và **Socket.io**.

---

## 📁 Cấu trúc Thư mục Dự án

```text
múic/
├── public/
│   └── index.html         # Giao diện Web Client (Tailwind CSS, Socket.io, Player, QR Modal)
├── index.html             # File HTML tại gốc (đồng bộ với public/index.html)
├── server.js              # Server Node.js + Socket.io Server + Time-Sync Engine + QR Generator
├── package.json           # Khai báo các gói thư viện (express, socket.io, qrcode)
├── start.bat              # File 1-click khởi chạy nhanh cho máy Admin trên Windows
├── .gitignore             # Loại bỏ node_modules khi đưa lên GitHub
└── README.md              # Tài liệu hướng dẫn sử dụng & triển khai
```

---

## 🚀 Hướng dẫn Khởi chạy (Dành cho Admin)

### Cách 1: Khởi động nhanh bằng 1 click chuột (Khuyên dùng)
Double click trực tiếp vào file **`start.bat`** tại thư mục dự án:
- Script sẽ tự động kiểm tra Node.js, cài đặt thư viện phụ thuộc (nếu chưa có).
- Tự động mở trình duyệt tại `http://localhost:3000`.
- Khởi chạy server và hiển thị địa chỉ LAN để mời đồng nghiệp.

### Cách 2: Khởi động qua Terminal (PowerShell / Command Prompt)
```powershell
# 1. Cài đặt các thư viện (nếu mới clone về)
npm install

# 2. Khởi chạy server
node server.js
```

Khi server khởi động thành công, màn hình terminal sẽ hiển thị địa chỉ truy cập:
```text
======================================================
   🎧 LAN MUSIC OFFICE - SERVER REALTIME ONLINE
======================================================
> Truy cập cục bộ: http://localhost:3000
> Chia sẻ cho đồng nghiệp trong mạng LAN:
   👉 http://192.168.0.101:3000  (Ethernet / Wi-Fi)
------------------------------------------------------
* Mã QR & API chia sẻ: http://localhost:3000/api/qr
* Tính năng: Time-Sync, Auto Admin Failover, Vote Playlist, QR Code
======================================================
```

---

## 📱 Tính năng Quét Mã QR & Sao Chép Link Vào Phòng

1. **Quét mã QR từ điện thoại:**
   - Trên thanh công cụ (Header) hoặc màn hình đăng nhập, bấm vào nút **`📱 Mã QR & Link`**.
   - Màn hình sẽ hiện mã QR sắc nét (được tạo trực tiếp từ Node.js server, **hoạt động 100% offline không cần internet**).
   - Đồng nghiệp chỉ cần mở **Camera điện thoại (iPhone / Android)** hoặc **Zalo / QR Scanner** quét mã là vào phòng ngay lập tức mà không cần gõ địa chỉ IP thủ công.
2. **Sao chép link mời:**
   - Bấm nút **`📋 Sao chép Link`**, hệ thống tự động copy đường dẫn phòng (ví dụ `http://192.168.0.101:3000`) vào clipboard để dán vào nhóm chat nội bộ (Zalo, Teams, Slack...).
   - Hỗ trợ chọn đổi card mạng (Wi-Fi hoặc Ethernet) linh hoạt nếu máy tính Admin có nhiều mạng kết nối.

---

## 🐙 Hỏi đáp: Có thể đưa lên GitHub để chạy trực tiếp không?

### 1. GitHub Pages có chạy trực tiếp được Server không?
- **Không.** **GitHub Pages** chỉ hỗ trợ các trang Web tĩnh (**Static HTML/CSS/JS**). Nó **không thể chạy môi trường Node.js hay Socket.io Server** trên đám mây của GitHub.
- Tuy nhiên, vì yêu cầu của bạn là **"Server sẽ được bật trực tiếp là mạng LAN ở máy Admin"**, thì giải pháp chuẩn và chuyên nghiệp nhất là:

### 2. Cách kết hợp GitHub và Server mạng LAN máy Admin:
GitHub đóng vai trò là **kho lưu trữ mã nguồn (Source Code Repository)** để:
- Bạn lưu trữ, quản lý các phiên bản code an toàn.
- Bất kỳ ai trong văn phòng được giao làm máy chủ Admin chỉ cần tải về hoặc clone từ GitHub về máy của họ là chạy được ngay.

#### Các bước đưa mã nguồn lên GitHub:
1. Mở PowerShell tại thư mục dự án và khởi tạo Git:
   ```bash
   git init
   git add .
   git commit -m "feat: LAN Music Office with QR Code, Time-Sync & Playlist Vote"
   ```
2. Tạo một Repository mới trên [GitHub.com](https://github.com/new) (ví dụ đặt tên: `lan-music-office`).
3. Đẩy code lên GitHub:
   ```bash
   git branch -M main
   git remote add origin https://github.com/<tai-khoan-cua-ban>/lan-music-office.git
   git push -u origin main
   ```
4. Khi đồng nghiệp khác muốn làm máy chủ Admin:
   Chỉ cần tải repo về hoặc gõ:
   ```bash
   git clone https://github.com/<tai-khoan-cua-ban>/lan-music-office.git
   cd lan-music-office
   # Nhấp đúp file start.bat là xong!
   ```

### 3. Nếu muốn chạy Server Online hoàn toàn miễn phí trên Internet (không chỉ giới hạn mạng LAN)?
Nếu một ngày bạn muốn đồng nghiệp dù ở nhà hay ra ngoài quán cà phê vẫn nghe chung được, bạn có thể kết nối repo GitHub này với các nền tảng Cloud miễn phí hỗ trợ Node.js + WebSocket như:
- **Render.com** (Khuyên dùng - Miễn phí kết nối trực tiếp với GitHub, tự động deploy mỗi khi push code).
- **Railway.app** hoặc **Fly.io**.
- Hoặc giữ server ở máy Admin và dùng **Cloudflare Tunnel / ngrok** để mở cổng ra ngoài Internet chỉ với 1 dòng lệnh:
  ```powershell
  npx localtunnel --port 3000
  ```
