# Telegram Manager

![CI](https://github.com/bacnguyen2004/telegram-manager/actions/workflows/ci.yml/badge.svg)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

**Full-stack web app** quản lý tài khoản Telegram qua dashboard và REST API — xây dựng với **FastAPI**, **Telethon**, **React**, **PostgreSQL**.

🔗 **Repo:** [github.com/bacnguyen2004/telegram-manager](https://github.com/bacnguyen2004/telegram-manager)

---

## Tổng quan

Monorepo gồm backend API (Telethon/MTProto) và frontend dashboard. Người dùng có thể đăng nhập OTP/2FA, quản lý nhiều session, join/leave nhóm, đọc/gửi tin nhắn (text, ảnh, reply), đồng bộ trạng thái đã đọc với Telegram — tất cả qua giao diện web hoặc Swagger.

```
telegram-manager/
├── backend/     # FastAPI + Telethon (port 8001)
└── frontend/    # React + Vite (port 5173, proxy /api)
```

### Điểm nổi bật (CV / portfolio)

- Thiết kế **session lock** hai lớp (`asyncio` + file lock) — an toàn khi nhiều request/worker cùng mở file `.session` Telethon
- **31 REST endpoint** với response envelope chuẩn, OpenAPI/Swagger tự động
- Dashboard chat: pagination tin cũ, scroll tới tin đã đọc, badge unread, gửi/reply/ảnh/xóa
- **PostgreSQL metadata** (SQLModel): login history, group scan, audit log — tách khỏi session Telethon trên disk
- **Docker Compose** full-stack (API + web + Postgres), CI pytest + vitest trên GitHub Actions
- Light/dark theme, auth flow thống nhất một trang `/auth`

### Tech stack

| Layer | Công nghệ |
|-------|-----------|
| Backend | Python 3.11, FastAPI, Telethon, SQLModel, Alembic, Pydantic |
| Frontend | React 19, TypeScript, Vite, React Router |
| Database | PostgreSQL 16 (production Docker), SQLite (dev local) |
| DevOps | Docker Compose, nginx, GitHub Actions |
| Testing | pytest, vitest |

---

## Screenshots

| Dashboard | Dialogs — chat UI | Sessions |
|-----------|-------------------|----------|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Dialogs](docs/screenshots/dialogs.png) | ![Sessions](docs/screenshots/sessions.png) |

| Tasks — bulk automation | Audit — nhật ký DB | Groups |
|-------------------------|--------------------|--------|
| ![Tasks](docs/screenshots/tasks.png) | ![Audit](docs/screenshots/audit.png) | ![Groups](docs/screenshots/groups.png) |

> Chụp thêm ảnh Tasks / Audit / Groups: `docker compose up` + `npm run dev` → mở `/tasks`, `/audit`, `/groups` → lưu PNG vào `docs/screenshots/`.

---

## Quick start (Docker)

**Yêu cầu:** Docker, `TELEGRAM_API_ID` + `TELEGRAM_API_HASH` từ [my.telegram.org](https://my.telegram.org)

```powershell
# Từ repo root
copy backend\.env.example backend\.env
# Điền TELEGRAM_API_ID + TELEGRAM_API_HASH

docker compose up --build
```

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:5173 |
| Swagger API | http://127.0.0.1:8001/docs |
| Health check | http://127.0.0.1:8001/api/health |

### Đăng nhập lần đầu

1. Mở http://localhost:5173/auth
2. Nhập số điện thoại → gửi OTP → nhập mã (và 2FA nếu có)
3. Vào **Sessions** — xác nhận file `.session` đã tạo

> Đăng nhập Telegram trên điện thoại **không** tự tạo session cho API.

---

## Tính năng

| Module | Mô tả |
|--------|-------|
| **Auth** | OTP, 2FA, đăng ký tài khoản mới, đổi 2FA, privacy invite |
| **Sessions** | Liệt kê, kiểm tra live, chi tiết file + DB metadata, xóa |
| **Groups** | Join/leave nhóm & channel, leave-all, danh sách nhóm |
| **Dialogs** | Danh sách chat, đọc tin, mark-read, tải ảnh thumbnail |
| **Messages** | Gửi text, reply, gửi ảnh (multipart), reaction, poll/vote |
| **Tasks** | Bulk automation — react, vote, join, reply, pipeline nhiều acc |
| **Metadata** | `session_meta`, `group_scans`, `audit_logs` (PostgreSQL) |
| **Health** | Trạng thái backend, Telegram config, database, session dir |

---

## Kiến trúc

### Backend

```
app/
├── main.py                 # FastAPI lifespan, router mount
├── config.py               # Settings + session_lock singleton
├── db/                     # SQLModel metadata (session_meta, group_scans, audit_logs)
├── routers/                # HTTP layer (health, auth, sessions, groups, dialogs, messages)
├── schemas/                # Pydantic request/response
├── services/telegram/      # Telethon business logic
│   └── client.py           # telethon_session() — lock → connect → yield → disconnect
└── utils/
    ├── session_lock.py     # Per-phone asyncio + file lock
    └── responses.py        # { success, data, error } envelope
```

### Session lock

Mỗi `phone` map tới một file `.session` (SQLite). Telethon không an toàn khi concurrent — giải pháp:

| Lớp | Phạm vi |
|-----|---------|
| `asyncio.Lock` | Nhiều request trong cùng process |
| File `runtime/locks/{phone}.lock` | Nhiều process / worker |

### Frontend routes

| Route | Trang |
|-------|-------|
| `/` | Dashboard — bản đồ API |
| `/auth` | Đăng nhập thống nhất (OTP → 2FA / đăng ký) |
| `/sessions` | Quản lý session |
| `/dialogs` | Chat workspace |
| `/groups` | Join / leave / list nhóm |
| `/tasks` | Tác vụ hàng loạt (bulk) |
| `/audit` | Nhật ký audit + lịch sử quét nhóm |
| `/security` | 2FA, privacy |
| `/health` | Health check |

---

## API (31 endpoints)

Response chuẩn: `{ "success": true|false, "data": ..., "error": null|"..." }`

<details>
<summary><strong>Health & Sessions</strong></summary>

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/health` | Trạng thái hệ thống |
| GET | `/api/sessions` | Liệt kê session trên disk |
| POST | `/api/sessions/check` | Kiểm tra live/unauthorized |
| GET | `/api/sessions/{phone}` | Chi tiết + `db_metadata` |
| DELETE | `/api/sessions/{phone}` | Xóa session |
| GET | `/api/sessions/{phone}/me` | Thông tin tài khoản Telegram |

</details>

<details>
<summary><strong>Auth</strong></summary>

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/auth/send-code` | Gửi OTP |
| POST | `/api/auth/login` | Đăng nhập (+ 2FA) |
| POST | `/api/auth/register` | Đăng ký mới |
| GET | `/api/auth/login-code/{phone}` | Đọc OTP từ Telegram |
| PUT | `/api/auth/2fa` | Đổi mật khẩu 2FA |
| PUT | `/api/auth/privacy` | Cài privacy invite |

</details>

<details>
<summary><strong>Groups, Dialogs & Messages</strong></summary>

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/groups/join` | Join nhóm/channel |
| POST | `/api/groups/leave` | Rời 1 nhóm |
| POST | `/api/groups/leave-all` | Rời tất cả |
| GET | `/api/groups/{phone}` | Danh sách nhóm |
| GET | `/api/dialogs/{phone}` | Tất cả chat + `read_inbox_max_id` |
| GET | `/api/dialogs/{phone}/messages` | Đọc tin (`peer_id`, `limit`, `offset_id`) |
| POST | `/api/dialogs/{phone}/read` | Đánh dấu đã đọc |
| GET | `/api/dialogs/{phone}/messages/{id}/photo` | Thumbnail ảnh |
| POST | `/api/messages/send` | Gửi text |
| POST | `/api/messages/reply` | Trả lời tin |
| POST | `/api/messages/send-media` | Gửi ảnh (multipart) |
| POST | `/api/messages/react` | Reaction tin |
| DELETE | `/api/messages/react` | Gỡ reaction |
| GET | `/api/messages/poll` | Thông tin poll / to-do |
| POST | `/api/messages/vote` | Vote poll |
| POST | `/api/messages/vote/cancel` | Hủy vote |
| POST | `/api/messages/poll/add-option` | Thêm đáp án poll |
| DELETE | `/api/messages/{message_id}` | Xóa tin |

</details>

<details>
<summary><strong>Metadata (PostgreSQL)</strong></summary>

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/metadata/overview` | Tổng quan session meta / audit / scans |
| GET | `/api/metadata/audit` | Danh sách audit log (`phone`, `limit`, `offset`) |
| GET | `/api/metadata/group-scans` | Lịch sử quét nhóm theo acc |
| GET | `/api/metadata/sessions` | Session meta + lần quét nhóm gần nhất |

> Cần `DATABASE_URL` trong `backend/.env`. Dev local có thể dùng SQLite; Docker dùng PostgreSQL.

</details>

---

## Dev local

### Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Proxy `/api` → `http://127.0.0.1:8001`. Đổi port: `frontend/.env.local` với `VITE_API_PROXY_TARGET`.

### Tests

```powershell
# Backend
cd backend
pip install -r requirements-dev.txt
pytest

# Frontend
cd frontend
npm ci
npm run test
```

CI chạy pytest + vitest + frontend build trên mỗi push/PR tới `main`.

---

## Biến môi trường

| Biến | Mô tả | Mặc định |
|------|-------|----------|
| `TELEGRAM_API_ID` | API ID từ my.telegram.org | — |
| `TELEGRAM_API_HASH` | API hash | — |
| `SESSION_FOLDER` | Thư mục file `.session` | `runtime/sessions` |
| `SESSION_LOCK_DIR` | Thư mục file lock | `runtime/locks` |
| `TG_SESSION_LOCK_TIMEOUT` | Chờ lock tối đa (giây) | `120` |
| `TG_SESSION_LOCK_STALE_SECONDS` | Xóa lock cũ sau crash (giây) | `300` |
| `DATABASE_URL` | PostgreSQL hoặc SQLite | SQLite local |
| `DATABASE_ENABLED` | Bật/tắt metadata DB | `true` |

Chi tiết 3 cách cấu hình DB (SQLite local / Postgres dev / Docker full): xem `backend/.env.example`.

---

## Docker services

```powershell
docker compose up --build    # foreground
docker compose up -d         # background
docker compose down
```

| Service | Port | Mô tả |
|---------|------|-------|
| `web` | 5173 | nginx + React build |
| `api` | 8001 | FastAPI |
| `db` | 5433 → 5432 | PostgreSQL (`telegram` / `telegram` / `telegram_manager`) |

Volumes: `telegram-sessions`, `telegram-locks`, `postgres-data`.

---

## Roadmap

- [x] Auth, sessions, groups, dialogs, messaging (text/reply/media/delete)
- [x] Dialog read sync, session lock, light/dark theme
- [x] pytest, GitHub Actions CI, Docker Compose
- [x] PostgreSQL metadata (login, group scan, audit log)
- [ ] Task system (bulk join/send)

---

## Author

[bacnguyen2004](https://github.com/bacnguyen2004)

Dự án demo kỹ năng **full-stack**, **API design**, **Telegram integration**, **Docker**, và **automated testing**.