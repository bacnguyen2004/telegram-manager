# Screenshots

Ảnh minh họa cho [README](../../README.md). Chụp lại khi UI đổi.

## Cách chụp

1. `docker compose up` hoặc backend + `cd frontend && npm run dev`
2. Mở http://localhost:5173
3. Light theme, cửa sổ ~1280–1440px, có dữ liệu mẫu
4. Lưu PNG **đúng tên file** trong thư mục này

## Danh sách file

| File | Route | Trang | Gợi ý nội dung |
|------|-------|-------|----------------|
| `dashboard.png` | `/` | Tổng quan | Stats + quick links |
| `sessions.png` | `/sessions` | Tài khoản | List session + status |
| `roster.png` | `/roster` | Sổ tài khoản | Bảng cột tùy chỉnh |
| `proxy.png` | `/proxy` | Proxy | Pool + gán acc |
| `dialogs.png` | `/dialogs` | Tin nhắn | Chat + thread |
| `groups.png` | `/groups` | Nhóm & kênh | Picker + list |
| `tasks.png` | `/tasks` | Tác vụ hàng loạt | Composer + progress |
| `conversation.png` | `/conversation` | Hội thoại | Preview plan / job monitor |
| `security.png` | `/security` | Bảo mật | 2FA / privacy bulk |
| `audit.png` | `/audit` | Nhật ký | Bảng audit |
| `health.png` | `/health` | Health | Backend OK |

## Layout README

1. **Quản lý tài khoản** — dashboard, sessions, roster, proxy  
2. **Chat, nhóm & automation** — dialogs, groups, tasks, conversation  
3. **Bảo mật & hệ thống** — security, audit, health  

Mỗi ô caption: **Tên trang · `/route`**.
