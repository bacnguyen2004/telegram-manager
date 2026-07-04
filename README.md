# Telegram Manager

![CI](https://github.com/bacnguyen2004/telegram-manager/actions/workflows/ci.yml/badge.svg)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

**Full-stack dashboard** quản lý tài khoản Telegram qua web UI và REST API — **FastAPI**, **Telethon**, **React**, **PostgreSQL**.

🔗 **Repo:** [github.com/bacnguyen2004/telegram-manager](https://github.com/bacnguyen2004/telegram-manager)

---

## Tổng quan

Monorepo gồm backend Telethon/MTProto và frontend React. Một dashboard thống nhất để:

- Thêm và quản lý file `.session` (OTP / 2FA)
- Join/leave nhóm, quét danh sách nhóm
- Đọc/gửi tin nhắn, reaction, poll, media
- Chạy tác vụ hàng loạt trên nhiều tài khoản
- Chạy **hội thoại tự nhiên** (kịch bản nhiều vai, delay, typing)
- Xem **nhật ký hoạt động** khi bật PostgreSQL

```
telegram-manager/
├── backend/     # FastAPI + Telethon — port 8001
└── frontend/    # React + Vite — port 5173 (proxy /api)
```

**64 REST endpoint** · response envelope `{ success, data, error }` · OpenAPI tại `/docs`

---

## Điểm nổi bật

- **Session lock hai lớp** (`asyncio` + file lock) — an toàn khi nhiều request/worker cùng mở `.session`
- **Chat workspace**: pagination, unread, mark-read, gửi/reply/ảnh/forward/edit/pin
- **Tác vụ hàng loạt** và **hội thoại tự nhiên** với monitor tiến độ trên UI
- **PostgreSQL metadata**: `session_meta`, `group_scans`, `audit_logs` (login, nhóm, hội thoại)
- **Sổ tài khoản** với cột tùy chỉnh lưu DB
- Docker Compose full-stack, CI (pytest + vitest + build), light/dark theme

### Tech stack

| Layer | Công nghệ |
|-------|-----------|
| Backend | Python 3.11, FastAPI, Telethon, SQLModel, Alembic |
| Frontend | React 19, TypeScript, Vite, React Router |
| Database | PostgreSQL 16 (Docker), SQLite (dev local) |
| DevOps | Docker Compose, nginx, GitHub Actions |
| Testing | pytest, vitest |

---

## Screenshots

| Tổng quan | Tài khoản | Sổ tài khoản |
|-----------|-----------|--------------|
| ![Tổng quan](docs/screenshots/dashboard.png) | ![Tài khoản](docs/screenshots/sessions.png) | ![Sổ tài khoản](docs/screenshots/roster.png) |

| Tin nhắn | Nhóm & kênh | Tác vụ hàng loạt |
|----------|-------------|------------------|
| ![Tin nhắn](docs/screenshots/dialogs.png) | ![Nhóm & kênh](docs/screenshots/groups.png) | ![Tác vụ hàng loạt](docs/screenshots/tasks.png) |

| Hội thoại tự nhiên | Nhật ký hoạt động | Bảo mật |
|--------------------|-------------------|---------|
| ![Hội thoại tự nhiên](docs/screenshots/conversation.png) | ![Nhật ký hoạt động](docs/screenshots/audit.png) | ![Bảo mật](docs/screenshots/security.png) |

| Trạng thái API |
|----------------|
| ![Trạng thái API](docs/screenshots/health.png) |

Chụp lại ảnh sau khi đổi UI: [`docs/screenshots/README.md`](docs/screenshots/README.md)

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
| Swagger | http://127.0.0.1:8001/docs |
| Health | http://127.0.0.1:8001/api/health |

### Thêm tài khoản lần đầu

1. Mở http://localhost:5173/sessions?add=1
2. Nhập số điện thoại → OTP → mã (và 2FA nếu có)
3. Vào **Tài khoản** (`/sessions`) — xác nhận file `.session` trên disk

> Đăng nhập Telegram trên điện thoại **không** tự tạo session cho API này.

---

## Tính năng dashboard

| Trang | Route | Mô tả |
|-------|-------|-------|
| Tổng quan | `/` | Thống kê, lối tắt, bản đồ 64 API |
| Tài khoản | `/sessions` | Liệt kê, kiểm tra live, chi tiết, avatar, xóa session |
| Sổ tài khoản | `/roster` | Bảng acc, cột tùy chỉnh, import |
| Nhóm & kênh | `/groups` | Join/leave, quét danh sách |
| Tin nhắn | `/dialogs` | Chat UI — đọc/gửi/media/reaction |
| Tác vụ hàng loạt | `/tasks` | Pipeline join/react/vote/reply nhiều acc |
| Hội thoại tự nhiên | `/conversation` | Kịch bản nhiều vai, preview, monitor job |
| Bảo mật | `/security` | Đổi 2FA, privacy invite hàng loạt |
| Nhật ký hoạt động | `/audit` | Audit log + lịch sử quét nhóm |
| Trạng thái API | `/health` | Backend, Telegram config, session dir, DB |

---

## Kiến trúc

### Backend

```
app/
├── main.py                      # FastAPI lifespan, mount /api
├── config.py                    # Settings, session lock
├── db/                          # SQLModel + metadata store
├── routers/                     # health, auth, sessions, roster, groups,
│                                # dialogs, messages, conversation, metadata
├── schemas/                     # Pydantic request/response
├── services/
│   ├── telegram/                # Telethon (sessions, groups, dialogs, messages…)
│   └── conversation/            # Parser, validator, job runner, audit
└── utils/
    ├── session_lock.py          # Per-phone asyncio + file lock
    └── responses.py             # { success, data, error }
```

### Session lock

Mỗi `phone` ↔ một file `.session`. Telethon không an toàn khi truy cập đồng thời:

| Lớp | Phạm vi |
|-----|---------|
| `asyncio.Lock` | Nhiều request trong cùng process |
| File `runtime/locks/{phone}.lock` | Nhiều process / worker |

### Nhật ký audit (PostgreSQL)

Ghi vào `audit_logs` khi `DATABASE_ENABLED=true`:

| Nhóm action | Ví dụ |
|-------------|-------|
| `auth.*` | `auth.login` |
| `sessions.*` | import, sync, delete, cập nhật profile |
| `groups.*` | join, leave, leave_all, scan |
| `conversation.*` | `conversation.start`, `conversation.run` (job hội thoại) |

Xem trên UI tại `/audit` hoặc `GET /api/metadata/audit`.

---

## API (64 endpoints)

Mọi response: `{ "success": true|false, "data": ..., "error": null|"..." }`

<details>
<summary><strong>Trạng thái API (1)</strong></summary>

| Method | Endpoint | Trang UI |
|--------|----------|----------|
| GET | `/api/health` | Trạng thái API |

</details>

<details>
<summary><strong>Tài khoản (11)</strong></summary>

| Method | Endpoint | Trang UI |
|--------|----------|----------|
| GET | `/api/sessions` | Tài khoản |
| POST | `/api/sessions/check` | Tài khoản |
| GET | `/api/sessions/{phone}` | Tài khoản |
| DELETE | `/api/sessions/{phone}` | Tài khoản |
| GET | `/api/sessions/{phone}/me` | Tài khoản |
| GET | `/api/sessions/{phone}/avatar` | Tài khoản |
| PATCH | `/api/sessions/{phone}/profile` | Tài khoản |
| POST | `/api/sessions/{phone}/avatar` | Tài khoản |
| DELETE | `/api/sessions/{phone}/avatar` | Tài khoản |
| GET | `/api/sessions/{phone}/authorizations` | Tài khoản |
| DELETE | `/api/sessions/{phone}/authorizations/{auth_hash}` | Tài khoản |

</details>

<details>
<summary><strong>Sổ tài khoản (6)</strong></summary>

| Method | Endpoint | Trang UI |
|--------|----------|----------|
| GET | `/api/roster` | Sổ tài khoản |
| PATCH | `/api/roster/{phone}` | Sổ tài khoản |
| POST | `/api/roster/columns` | Sổ tài khoản |
| PATCH | `/api/roster/columns/{column_key}` | Sổ tài khoản |
| DELETE | `/api/roster/columns/{column_key}` | Sổ tài khoản |
| POST | `/api/roster/import` | Sổ tài khoản |

</details>

<details>
<summary><strong>Nhóm & kênh (4)</strong></summary>

| Method | Endpoint | Trang UI |
|--------|----------|----------|
| POST | `/api/groups/join` | Nhóm & kênh |
| POST | `/api/groups/leave` | Nhóm & kênh |
| POST | `/api/groups/leave-all` | Nhóm & kênh |
| GET | `/api/groups/{phone}` | Nhóm & kênh |

</details>

<details>
<summary><strong>Danh sách chat (9)</strong></summary>

| Method | Endpoint | Trang UI |
|--------|----------|----------|
| GET | `/api/dialogs/{phone}` | Tin nhắn |
| GET | `/api/dialogs/{phone}/messages` | Tin nhắn |
| GET | `/api/dialogs/{phone}/messages/new` | Tin nhắn |
| GET | `/api/dialogs/{phone}/messages/search` | Tin nhắn |
| GET | `/api/dialogs/{phone}/messages/stream` | Tin nhắn |
| GET | `/api/dialogs/{phone}/pinned` | Tin nhắn |
| GET | `/api/dialogs/{phone}/messages/{id}/photo` | Tin nhắn |
| GET | `/api/dialogs/{phone}/messages/{id}/media` | Tin nhắn |
| POST | `/api/dialogs/{phone}/read` | Tin nhắn |

</details>

<details>
<summary><strong>Gửi & thao tác tin (15)</strong></summary>

| Method | Endpoint | Trang UI |
|--------|----------|----------|
| POST | `/api/messages/send` | Tin nhắn |
| POST | `/api/messages/reply` | Tin nhắn |
| POST | `/api/messages/send-media` | Tin nhắn |
| POST | `/api/messages/forward` | Tin nhắn |
| POST | `/api/messages/forward-bulk` | Tin nhắn |
| POST | `/api/messages/edit` | Tin nhắn |
| POST | `/api/messages/delete-bulk` | Tin nhắn |
| POST | `/api/messages/pin` | Tin nhắn |
| POST | `/api/messages/react` | Tin nhắn |
| DELETE | `/api/messages/react` | Tin nhắn |
| DELETE | `/api/messages/{message_id}` | Tin nhắn |
| GET | `/api/messages/poll` | Tác vụ hàng loạt |
| POST | `/api/messages/poll/add-option` | Tác vụ hàng loạt |
| POST | `/api/messages/vote` | Tác vụ hàng loạt |
| POST | `/api/messages/vote/cancel` | Tác vụ hàng loạt |

</details>

<details>
<summary><strong>Hội thoại tự nhiên (8)</strong></summary>

| Method | Endpoint | Trang UI |
|--------|----------|----------|
| POST | `/api/conversation/validate` | Hội thoại tự nhiên |
| POST | `/api/conversation/parse` | Hội thoại tự nhiên |
| GET | `/api/conversation/jobs` | Hội thoại tự nhiên |
| POST | `/api/conversation/jobs` | Hội thoại tự nhiên |
| GET | `/api/conversation/jobs/{job_id}` | Hội thoại tự nhiên |
| POST | `/api/conversation/jobs/{job_id}/resume` | Hội thoại tự nhiên |
| POST | `/api/conversation/jobs/{job_id}/lines/{line_id}/retry` | Hội thoại tự nhiên |
| POST | `/api/conversation/jobs/{job_id}/stop` | Hội thoại tự nhiên |

</details>

<details>
<summary><strong>Nhật ký & metadata (4)</strong></summary>

| Method | Endpoint | Trang UI |
|--------|----------|----------|
| GET | `/api/metadata/overview` | Nhật ký hoạt động |
| GET | `/api/metadata/audit` | Nhật ký hoạt động |
| GET | `/api/metadata/group-scans` | Nhật ký hoạt động |
| GET | `/api/metadata/sessions` | Tài khoản |

> Cần `DATABASE_URL` (hoặc SQLite mặc định). Tắt metadata: `DATABASE_ENABLED=false`.

</details>

<details>
<summary><strong>Xác thực & bảo mật (6)</strong></summary>

| Method | Endpoint | Trang UI |
|--------|----------|----------|
| POST | `/api/auth/send-code` | Thêm tài khoản |
| POST | `/api/auth/login` | Thêm tài khoản |
| POST | `/api/auth/register` | Thêm tài khoản |
| GET | `/api/auth/login-code/{phone}` | — |
| PUT | `/api/auth/2fa` | Bảo mật |
| PUT | `/api/auth/privacy` | Bảo mật |

</details>

Bản đồ API đầy đủ trên dashboard (`/`) được đồng bộ với `frontend/src/utils/apiMap.ts`.

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

Proxy `/api` → `http://127.0.0.1:8001`. Đổi target: `frontend/.env.local` với `VITE_API_PROXY_TARGET`.

### Tests

```powershell
# Backend
cd backend
pip install -r requirements-dev.txt
python -m pytest

# Frontend
cd frontend
npm ci
npm run test
npm run build
```

CI chạy pytest + vitest + build trên mỗi push/PR tới `main`.

---

## Biến môi trường

| Biến | Mô tả | Mặc định |
|------|-------|----------|
| `TELEGRAM_API_ID` | API ID từ my.telegram.org | — |
| `TELEGRAM_API_HASH` | API hash | — |
| `SESSION_FOLDER` | Thư mục `.session` | `runtime/sessions` |
| `SESSION_LOCK_DIR` | Thư mục file lock | `runtime/locks` |
| `TG_SESSION_LOCK_TIMEOUT` | Chờ lock tối đa (giây) | `120` |
| `TG_SESSION_LOCK_STALE_SECONDS` | Xóa lock stale sau crash | `300` |
| `DATABASE_URL` | PostgreSQL hoặc SQLite | SQLite (`runtime/telegram_manager.db`) |
| `DATABASE_ENABLED` | Bật metadata / audit | `true` |

Ba cách cấu hình DB (SQLite local / Postgres dev / Docker full): xem `backend/.env.example`.

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

## Author

[bacnguyen2004](https://github.com/bacnguyen2004)

Dự án portfolio: **full-stack**, **REST API design**, **Telegram/MTProto**, **Docker**, **automated testing**.