# Hội thoại (Campaign)

UI product name: **Hội thoại** · route `/conversation`  
Code / API: **`campaign`** · `/api/campaign/*` · package `app/services/campaign/`

---

## Mục tiêu

Lập **kịch bản chat multi-account** (thường crypto) bằng AI, xem preview Telegram-style, rồi **chạy job** gửi tin vào group theo timeline (`at_sec`).

---

## Flow người dùng

1. **Chiến dịch** — ý định, ngôn ngữ, topic, link group  
2. **Acc** — ≥ 2 session, role / persona  
3. **Market** (tuỳ chọn) — giá + news grounding  
4. **Settings** — số tin, thời lượng (phút), mật độ, reply rate…  
5. **Prompt / Model** — review + model id (link [OpenAI Pricing](https://platform.openai.com/docs/pricing))  
6. **Generate plan** → Preview + Timeline  
7. **Start gửi** → **Dừng** / **Tiếp tục**  
8. **Lưu draft / Mở draft** (localStorage; auto-save)

---

## API

| Method | Path | Mô tả |
|--------|------|--------|
| `GET` | `/api/campaign/ai-status` | AI bật? model mặc định, gợi ý, `pricing_url` |
| `GET` | `/api/campaign/market` | Snapshot market / news |
| `POST` | `/api/campaign/plan` | Generate plan (cần `AI_ENABLED` + key) |
| `POST` | `/api/campaign/jobs` | Tạo & start job |
| `GET` | `/api/campaign/jobs/{id}` | Status + `line_results` |
| `POST` | `/api/campaign/jobs/{id}/stop` | Dừng |
| `POST` | `/api/campaign/jobs/{id}/resume` | Tiếp tục tin còn lại |

---

## Module backend

```
services/campaign/
├── planner.py      # Chunked LLM generation
├── prompts.py      # System / user prompts + prefs
├── normalize.py    # Parse plan, fit timeline → duration_min
├── workflow.py     # Orchestration cho router
└── execution/
    ├── runner.py   # Gửi tin theo at_sec, stop/resume
    ├── store.py    # campaign_jobs DB
    ├── validator.py
    └── audit_log.py
```

### Timeline

- AI trả `at_sec` (giây từ lúc start)  
- `fit_timeline_to_duration` kéo/nén + rải burst để khớp **phút** user nhập  
- Runner `schedule_mode`: chờ đúng mốc, typing nằm trong gap  

### Draft (frontend only)

- Key localStorage: `tm_campaign_mvp_draft_v1`  
- Auto-save + nút **Lưu draft** / **Mở draft**  
- **Không** lưu job Telegram đang chạy  

---

## Cấu hình AI

Trong `backend/.env`:

```env
AI_ENABLED=true
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
# OPENAI_MODELS=gpt-4.1-mini,gpt-4o-mini
```

Xem thêm `backend/.env.example` và `backend/app/config.py`.

---

## Gợi ý vận hành

- Acc phải online / session hợp lệ, đã trong group đích  
- Link group: `https://t.me/...` hoặc peer id  
- Sau **Dừng**, đợi 1–2s nếu **Tiếp tục** báo lỗi race (backend đã chờ task cũ)  
- Cùng browser profile + cùng origin khi dùng draft (`localhost` ≠ `127.0.0.1`)  
