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
- Gán **proxy SOCKS5 / HTTP / MTProto** theo account (pool, chia đều, test)
- Join/leave nhóm, quét danh sách nhóm
- Đọc/gửi tin nhắn, reaction, poll, media
- Chạy tác vụ hàng loạt trên nhiều tài khoản
- Chạy **hội thoại tự nhiên** (kịch bản nhiều vai, delay, typing)
- Xem **nhật ký hoạt động** khi bật database

```
telegram-manager/
├── backend/     # FastAPI + Telethon — port 8001
└── frontend/    # React + Vite — port 5173 (proxy /api)
```

**73 REST endpoint** · response envelope `{ success, data, error }` · OpenAPI tại `/docs`

---

## Điểm nổi bật

- **Session lock hai lớp** (`asyncio` + file lock) — an toàn khi nhiều request/worker cùng mở `.session`
- **Proxy per session** — pool, gán 1–nhiều, chia đều (round-robin), test TCP, import list
- **Chat workspace**: pagination, unread, mark-read, gửi/reply/ảnh/forward/edit/pin
- **Tác vụ hàng loạt** và **hội thoại tự nhiên** với monitor tiến độ trên UI
- **Metadata DB**: `session_meta`, `proxies`, `group_scans`, `audit_logs`, roster
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

> Ảnh full-width theo nhóm. Click ảnh trên GitHub để xem lớn. Chụp lại khi đổi UI: [`docs/screenshots/README.md`](docs/screenshots/README.md)

### Quản lý tài khoản

| Tổng quan | Tài khoản |
|:---------:|:---------:|
| <img src="docs/screenshots/dashboard.png" alt="Tổng quan — dashboard thống kê & lối tắt" width="100%" /> | <img src="docs/screenshots/sessions.png" alt="Tài khoản — session, check live, avatar" width="100%" /> |
| **Tổng quan** · `/` | **Tài khoản** · `/sessions` |

| Sổ tài khoản | Proxy |
|:------------:|:-----:|
| <img src="docs/screenshots/roster.png" alt="Sổ tài khoản — bảng cột tùy chỉnh" width="100%" /> | <img src="docs/screenshots/proxy.png" alt="Proxy — gán SOCKS5/HTTP/MTProto, pool, chia đều, test" width="100%" /> |
| **Sổ tài khoản** · `/roster` | **Proxy** · `/proxy` |

### Chat, nhóm & automation

| Tin nhắn | Nhóm & kênh |
|:--------:|:-----------:|
| <img src="docs/screenshots/dialogs.png" alt="Tin nhắn — chat workspace" width="100%" /> | <img src="docs/screenshots/groups.png" alt="Nhóm & kênh — join/leave, quét" width="100%" /> |
| **Tin nhắn** · `/dialogs` | **Nhóm & kênh** · `/groups` |

| Tác vụ hàng loạt | Hội thoại tự nhiên |
|:----------------:|:------------------:|
| <img src="docs/screenshots/tasks.png" alt="Tác vụ hàng loạt — pipeline multi-acc" width="100%" /> | <img src="docs/screenshots/conversation.png" alt="Hội thoại tự nhiên — kịch bản nhiều vai" width="100%" /> |
| **Tác vụ hàng loạt** · `/tasks` | **Hội thoại tự nhiên** · `/conversation` |

### Bảo mật & hệ thống

| Bảo mật | Nhật ký hoạt động |
|:-------:|:-----------------:|
| <img src="docs/screenshots/security.png" alt="Bảo mật — 2FA, privacy invite" width="100%" /> | <img src="docs/screenshots/audit.png" alt="Nhật ký hoạt động — audit log" width="100%" /> |
| **Bảo mật** · `/security` | **Nhật ký hoạt động** · `/audit` |

| Trạng thái API |
|:--------------:|
| <img src="docs/screenshots/health.png" alt="Trạng thái API — health check" width="70%" /> |
| **Trạng thái API** · `/health` |

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
4. (Tuỳ chọn) **Proxy** (`/proxy`) — import pool, gán / chia đều proxy cho acc

> Đăng nhập Telegram trên điện thoại **không** tự tạo session cho API này.

---

## Tính năng dashboard

| Trang | Route | Mô tả |
|-------|-------|-------|
| Tổng quan | `/` | Thống kê, lối tắt, bản đồ API |
| Tài khoản | `/sessions` | Liệt kê, kiểm tra live, chi tiết, avatar, xóa session |
| Sổ tài khoản | `/roster` | Bảng acc, cột tùy chỉnh, import CSV |
| **Proxy** | `/proxy` | Pool SOCKS5/HTTP/MTProto, gán acc, chia đều, test, import list |
| Nhóm & kênh | `/groups` | Join/leave, quét danh sách |
| Tin nhắn | `/dialogs` | Chat UI — đọc/gửi/media/reaction |
| Tác vụ hàng loạt | `/tasks` | Pipeline join/react/vote/reply nhiều acc |
| Hội thoại tự nhiên | `/conversation` | Kịch bản nhiều vai, preview, monitor job |
| Bảo mật | `/security` | Đổi 2FA, privacy invite hàng loạt |
| Nhật ký hoạt động | `/audit` | Audit log + lịch sử quét nhóm |
| Trạng thái API | `/health` | Backend, Telegram config, session dir, DB |

### Proxy (tóm tắt)

- **Pool**: thêm 1 proxy, import nhiều dòng (`host:port`, `host:port:user:pass`, `type|host|port|…`)
- **Gán**: 1 proxy → nhiều account, hoặc **chia đều** (round-robin) từ pool
- **Test**: từng proxy hoặc Test all; trạng thái OK/Lỗi lưu trên pool
- **Yêu cầu**: database bật (`DATABASE_URL` / SQLite mặc định)

---

## Kiến trúc

### Backend

```
app/
├── main.py                      # FastAPI lifespan, mount /api
├── config.py                    # Settings, session lock
├── db/                          # SQLModel, metadata, proxy_store, roster_store
├── routers/                     # health, auth, sessions, roster, proxies,
│                                # groups, dialogs, messages, conversation, metadata
├── schemas/                     # Pydantic request/response
├── services/
│   ├── telegram/                # Telethon (client pool, groups, dialogs, proxy…)
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

### Proxy per session

- Bảng `proxies` + `session_meta.proxy_id` (0..1 proxy / account)
- Telethon client pool inject SOCKS5 / HTTP / MTProto khi tạo client
- Gán / gỡ proxy → drop client trong pool để kết nối lại qua endpoint mới

### Nhật ký audit (database)

Ghi vào `audit_logs` khi `DATABASE_ENABLED=true`:

| Nhóm action | Ví dụ |
|-------------|-------|
| `auth.*` | `auth.login` |
| `sessions.*` | import, sync, delete, cập nhật profile |
| `proxy.*` | create, assign, assign_bulk, check, delete |
| `groups.*` | join, leave, leave_all, scan |
| `conversation.*` | `conversation.start`, `conversation.run` |

Xem trên UI tại `/audit` hoặc `GET /api/metadata/audit`.

---

## API (73 endpoints)

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
<summary><strong>Proxy (9)</strong></summary>

| Method | Endpoint | Trang UI |
|--------|----------|----------|
| GET | `/api/proxies` | Proxy |
| POST | `/api/proxies` | Proxy |
| GET | `/api/proxies/{id}` | Proxy |
| PATCH | `/api/proxies/{id}` | Proxy |
| DELETE | `/api/proxies/{id}` | Proxy |
| POST | `/api/proxies/{id}/check` | Proxy |
| GET | `/api/proxies/assignments` | Proxy |
| PUT | `/api/proxies/assignments/{phone}` | Proxy |
| POST | `/api/proxies/assignments/bulk` | Proxy |

> Bulk assign hỗ trợ `mode=same` (mọi phone cùng 1 proxy) và `mode=round_robin` (chia đều pool). Cần database bật.

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
| `DATABASE_ENABLED` | Bật metadata / audit / **proxy** | `true` |

> Proxy pool & gán account **cần database**. SQLite local đủ dùng; Docker dùng PostgreSQL.

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

Dự án portfolio: **full-stack**, **REST API design**, **Telegram/MTProto**, **proxy multi-acc**, **Docker**, **automated testing**.
