# Screenshots

Ảnh minh họa cho README chính. Chụp lại khi UI thay đổi.

## Cách chụp

1. `docker compose up` (hoặc backend + `cd frontend && npm run dev`)
2. Mở http://localhost:5173
3. Light theme, cửa sổ ~1280–1440px, có dữ liệu mẫu
4. Lưu PNG vào thư mục này (đúng tên file)

## Danh sách file

| File | Route | Trang | Gợi ý nội dung |
|------|-------|-------|----------------|
| `dashboard.png` | `/` | Tổng quan | Stats + quick links |
| `sessions.png` | `/sessions` | Tài khoản | List session + badge status |
| `roster.png` | `/roster` | Sổ tài khoản | Bảng cột tùy chỉnh có data |
| `proxy.png` | `/proxy` | Proxy | Bảng acc + pool, vài proxy đã gán/test OK |
| `dialogs.png` | `/dialogs` | Tin nhắn | Chat + thread |
| `groups.png` | `/groups` | Nhóm & kênh | Picker + danh sách nhóm |
| `tasks.png` | `/tasks` | Tác vụ hàng loạt | Composer + progress |
| `conversation.png` | `/conversation` | Hội thoại tự nhiên | Script preview / job |
| `security.png` | `/security` | Bảo mật | 2FA hoặc privacy bulk |
| `audit.png` | `/audit` | Nhật ký hoạt động | Bảng audit có dòng |
| `health.png` | `/health` | Trạng thái API | Backend OK |

## Layout trong README

README nhóm ảnh theo 3 mục:

1. **Quản lý tài khoản** — dashboard, sessions, roster, **proxy**
2. **Chat, nhóm & automation** — dialogs, groups, tasks, conversation
3. **Bảo mật & hệ thống** — security, audit, health

Mỗi ô có caption **Tên trang · `/route`** dưới ảnh để đọc rõ trên GitHub.
