# Telegram Manager

Monorepo FastAPI + React — quản lý tài khoản Telegram qua HTTP API và dashboard.

```
telegram-manager-api/
├── backend/     # FastAPI + Telethon (port 8001)
└── frontend/    # React + Vite (port 5173, proxy /api)
```

GitHub: https://github.com/bacnguyen2004/telegram-manager-api

---

## Yêu cầu

- Python 3.11+
- Node.js 18+
- `TELEGRAM_API_ID` + `TELEGRAM_API_HASH` từ https://my.telegram.org

---

## Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Điền `.env` (xem mục **Biến môi trường** bên dưới).

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

- API docs: http://127.0.0.1:8001/docs
- Health: http://127.0.0.1:8001/api/health

### Chạy test

```powershell
pip install -r requirements-dev.txt
pytest
```

Test gồm: health, sessions, messages/send (mock Telethon), session lock (2 request cùng phone).

---

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

Mở http://localhost:5173 — Vite proxy `/api` → backend.

Nếu backend chạy port khác `8001`, tạo `frontend/.env.local`:

```env
VITE_API_PROXY_TARGET=http://127.0.0.1:8000
```

---

## Biến môi trường (backend `.env`)

| Biến | Mô tả | Mặc định |
|---|---|---|
| `TELEGRAM_API_ID` | API ID từ my.telegram.org | — |
| `TELEGRAM_API_HASH` | API hash | — |
| `SESSION_FOLDER` | Thư mục file `.session` | `runtime/sessions` |
| `SESSION_LOCK_DIR` | Thư mục file lock | `runtime/locks` |
| `TG_SESSION_LOCK_TIMEOUT` | Chờ lock tối đa (giây) | `120` |
| `TG_SESSION_LOCK_STALE_SECONDS` | Xóa lock file cũ (crash) | `300` |

---

## Session lock

Mỗi tài khoản (`phone`) map tới một file `.session` (SQLite). Telethon **không an toàn** khi nhiều request mở cùng file song song.

**Giải pháp:** `session_lock` — mỗi phone chỉ một kết nối Telethon tại một thời điểm.

| Lớp | Phạm vi |
|---|---|
| `asyncio.Lock` | Nhiều request trong cùng process FastAPI |
| File `runtime/locks/{phone}.lock` | Nhiều process / worker |

Tất cả service dùng helper `telethon_session()` (lock → connect → yield client → disconnect → release).

Trong **cùng process**, request thứ hai **xếp hàng** qua `asyncio.Lock` cho đến khi request trước xong.

Giữa **nhiều process**, file lock chờ tối đa `TG_SESSION_LOCK_TIMEOUT` giây. Quá timeout → lỗi *"Session … dang duoc su dung boi request khac"*.

---

## API — 19 endpoint

Response chuẩn: `{ "success": true|false, "data": ..., "error": null|"..." }`

### Health

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/health` | Trạng thái backend, Telegram config, session dir |

### Sessions

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/sessions` | Liệt kê session (file `.session` trên disk) |
| POST | `/api/sessions/check` | Kiểm tra live/unauthorized |
| GET | `/api/sessions/{phone}` | Chi tiết 1 session |
| DELETE | `/api/sessions/{phone}` | Xóa session file |
| GET | `/api/sessions/{phone}/me` | Thông tin tài khoản Telegram |

### Auth

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/auth/send-code` | Gửi OTP |
| POST | `/api/auth/login` | Đăng nhập (+ 2FA) |
| POST | `/api/auth/register` | Đăng ký mới |
| GET | `/api/auth/login-code/{phone}` | Đọc OTP từ Telegram |
| PUT | `/api/auth/2fa` | Đổi mật khẩu 2FA |
| PUT | `/api/auth/privacy` | Cài privacy invite |

### Groups

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/groups/join` | Join nhóm/channel |
| POST | `/api/groups/leave` | Rời 1 nhóm |
| POST | `/api/groups/leave-all` | Rời tất cả nhóm/channel |
| GET | `/api/groups/{phone}` | Danh sách nhóm đã join |

### Dialogs & Messages

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/dialogs/{phone}` | Tất cả chat (private, bot, group, channel) |
| GET | `/api/dialogs/{phone}/messages` | Đọc tin nhắn 1 chat (`?peer_id=&limit=`) |
| POST | `/api/messages/send` | Gửi tin text (`phone`, `peer_id`, `text`) |

---

## Luồng bắt đầu (chưa có session)

```
1. .env          TELEGRAM_API_ID + HASH
2. send-code     OTP → Telegram app
3. login         Nhập OTP → tạo file .session
4. GET /sessions  Xác nhận count >= 1
```

> Đăng nhập Telegram trên điện thoại **không** tự tạo session cho API. Phải qua bước 2–3.

---

## Kiến trúc backend

```
app/
├── main.py
├── config.py              # settings + session_lock singleton
├── routers/               # HTTP layer
├── schemas/               # Pydantic request/response
├── services/telegram/     # Telethon logic
│   └── client.py          # telethon_session() — lock + connect
└── utils/
    ├── responses.py       # envelope { success, data, error }
    └── session_lock.py    # per-phone file lock
```

---

## Frontend pages

| Route | Trang |
|---|---|
| `/` | Dashboard — bản đồ API |
| `/sessions` | Quản lý session |
| `/groups` | Join / leave / list |
| `/dialogs` | Chat + gửi tin |
| `/login`, `/register`, … | Auth flow |
| `/health` | Health check |

---

## Roadmap (tóm tắt)

- [x] Auth, sessions, groups, dialogs, messages/send
- [x] Session lock, React dashboard
- [x] pytest cơ bản
- [ ] messages/reply, media upload
- [ ] Docker Compose
- [ ] Task system (bulk join/send)

Chi tiết: `PLAN.md`