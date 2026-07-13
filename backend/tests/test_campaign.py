"""Campaign core tests — aligned with UI surface (plan/market/jobs start-stop)."""

from app.schemas.campaign import CampaignPlan, CampaignPlanLine, CampaignSpeakerInput
from app.services.campaign.normalize import (
    fit_timeline_to_duration,
    parse_plan_dict,
    plan_to_script,
    validate_campaign_script,
)
from app.services.campaign.planner import (
    _chunk_sizes,
    _extract_json_object,
    _merge_chunk_lines,
    _tokens_for_chunk,
    build_speaker_cards,
    chunk_size_for_target,
)


def test_extract_json_object_plain_and_fenced():
    raw = '{"title": "x", "duration_min": 10, "lines": []}'
    assert _extract_json_object(raw)["title"] == "x"
    fenced = '```json\n{"title": "y", "duration_min": 12, "lines": []}\n```'
    assert _extract_json_object(fenced)["title"] == "y"
    assert _tokens_for_chunk(40) >= 6000
    assert _chunk_sizes(200, 40) == [40, 40, 40, 40, 40]
    assert _chunk_sizes(90, 40) == [40, 40, 10]
    assert chunk_size_for_target(150) == 25

    existing = [
        CampaignPlanLine(at_sec=0, speaker_id="a", action="send", text="hi"),
    ]
    chunk = [
        CampaignPlanLine(at_sec=0, speaker_id="b", action="send", text="yo"),
        CampaignPlanLine(
            at_sec=10, speaker_id="a", action="reply", text="ok", reply_to_line=1
        ),
    ]
    merged = _merge_chunk_lines(existing, chunk)
    assert len(merged) == 3
    assert merged[2].reply_to_line == 2
    # Relative AI gaps preserved after shift (10s between chunk lines)
    assert merged[2].at_sec - merged[1].at_sec == 10
    assert merged[1].at_sec >= existing[0].at_sec + 3


def test_build_speaker_cards_strips_phone_and_keeps_persona():
    cards = build_speaker_cards(
        [
            {
                "id": "a",
                "label": "Alex",
                "phone": "+84901",
                "role": "lead",
                "activity": "high",
                "message_style": "short",
                "preferred_assets": ["BTC", "ETH"],
                "can_open": True,
            },
            {"id": "b", "label": "Minh", "phone": "+84902", "role": "member"},
        ]
    )
    assert len(cards) == 2
    assert cards[0]["id"] == "a"
    assert cards[0]["label"] == "Alex"
    assert "phone" not in cards[0]
    assert cards[0].get("activity") == "high"
    assert cards[0].get("preferred_assets") == ["BTC", "ETH"]
    assert cards[0].get("can_open") is True


def test_parse_plan_dict_filters_and_gaps():
    plan = parse_plan_dict(
        {
            "title": "T",
            "duration_min": 20,
            "lines": [
                {"at_sec": 0, "speaker_id": "a", "action": "send", "text": "hello world"},
                {
                    "at_sec": 5,
                    "speaker_id": "b",
                    "action": "reply",
                    "text": "hi",
                    "reply_to_line": 1,
                },
            ],
        }
    )
    assert len(plan.lines) == 2
    assert plan.lines[1].reply_to_line == 1


def test_parse_plan_dict_fixes_invalid_replies():
    plan = parse_plan_dict(
        {
            "title": "T",
            "duration_min": 20,
            "lines": [
                {"at_sec": 0, "speaker_id": "a", "action": "send", "text": "hi there"},
                {
                    "at_sec": 10,
                    "speaker_id": "b",
                    "action": "reply",
                    "text": "self reply bad",
                    "reply_to_line": 2,
                },
                {
                    "at_sec": 20,
                    "speaker_id": "a",
                    "action": "reply",
                    "text": "future reply bad",
                    "reply_to_line": 99,
                },
            ],
        }
    )
    assert plan.lines[1].action == "reply"
    assert plan.lines[1].reply_to_line == 1
    assert plan.lines[2].action == "reply"
    assert plan.lines[2].reply_to_line == 2


def test_merge_preserves_absolute_timeline_when_continuing():
    existing = [
        CampaignPlanLine(at_sec=100, speaker_id="a", action="send", text="hi"),
    ]
    chunk = [
        CampaignPlanLine(at_sec=120, speaker_id="b", action="send", text="later"),
        CampaignPlanLine(at_sec=140, speaker_id="a", action="send", text="ok"),
    ]
    merged = _merge_chunk_lines(existing, chunk)
    assert merged[1].at_sec == 120
    assert merged[2].at_sec == 140


def test_fit_timeline_stretches_short_ai_schedule_to_duration():
    # Model only scheduled ~3 minutes for a 20-minute campaign
    lines = [
        CampaignPlanLine(
            at_sec=t,
            speaker_id="a" if i % 2 == 0 else "b",
            action="send",
            text=f"m{i} hello",
        )
        for i, t in enumerate([0, 20, 45, 90, 120, 180])
    ]
    plan = CampaignPlan(title="T", duration_min=20, lines=lines)
    fitted = fit_timeline_to_duration(plan, 20)
    assert fitted.lines[0].at_sec == 0
    # End should land near 20 minutes
    assert fitted.lines[-1].at_sec >= 20 * 60 - 30
    assert fitted.lines[-1].at_sec <= 20 * 60 + 90
    # Relative order preserved
    assert fitted.lines[0].at_sec < fitted.lines[2].at_sec < fitted.lines[-1].at_sec


def test_fit_timeline_kills_pathological_dead_zone():
    """Multi-chunk pathology: 30 msgs in ~2 min, then jump to ~20 min."""
    times = list(range(0, 100, 3))  # ~34 msgs, 0..99
    times += [1100, 1120, 1150, 1200]  # late dump
    lines = [
        CampaignPlanLine(
            at_sec=t,
            speaker_id="a" if i % 2 == 0 else "b",
            action="send",
            text=f"m{i} msg here",
        )
        for i, t in enumerate(times)
    ]
    plan = CampaignPlan(title="T", duration_min=20, lines=lines)
    fitted = fit_timeline_to_duration(plan, 20)
    assert fitted.lines[0].at_sec == 0
    assert fitted.lines[-1].at_sec >= 20 * 60 - 30
    # Mid conversation should not still be in the first ~2 minutes
    mid = fitted.lines[len(fitted.lines) // 2].at_sec
    assert mid >= 5 * 60, f"mid still too early: {mid}s"
    # No single gap swallowing most of the campaign
    max_gap = max(
        fitted.lines[i].at_sec - fitted.lines[i - 1].at_sec
        for i in range(1, len(fitted.lines))
    )
    assert max_gap <= 8 * 60, f"max gap too large: {max_gap}s"


def test_plan_to_script_and_validate():
    speakers = [
        CampaignSpeakerInput(id="a", label="An", phone="+841"),
        CampaignSpeakerInput(id="b", label="Be", phone="+842"),
    ]
    plan = CampaignPlan(
        title="Test",
        duration_min=15,
        lines=[
            CampaignPlanLine(at_sec=0, speaker_id="a", action="send", text="hello there"),
            CampaignPlanLine(
                at_sec=20,
                speaker_id="b",
                action="reply",
                text="hey",
                reply_to_line=1,
            ),
        ],
    )
    script = plan_to_script(
        plan,
        speakers=speakers,
        group_link="https://t.me/example",
        peer_id=None,
    )
    assert len(script.lines) == 2
    assert script.lines[0].reply_to is None
    assert script.lines[1].reply_to == 1
    assert script.reply_on_speaker_change is False
    assert script.schedule_mode is True
    assert script.lines[0].at_sec == 0
    # plan_to_script fits timeline to duration_min (15p → last ≈ 900s)
    assert script.lines[1].at_sec >= 15 * 60 - 30
    assert script.lines[1].at_sec <= 15 * 60 + 60
    assert script.timing.typing_min_sec >= 2
    assert script.speakers[0].phone == "+841"
    validation = validate_campaign_script(script)
    assert validation.valid is True


def test_campaign_ai_status_endpoint(client):
    res = client.get("/api/campaign/ai-status")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert "configured" in body["data"]
    assert "message" in body["data"]
    assert "models" in body["data"]
    assert isinstance(body["data"]["models"], list)
    assert "pricing_url" in body["data"]
    assert "openai.com" in body["data"]["pricing_url"]
    assert "model_catalog" not in body["data"]
    assert "plan_cost_estimates_150" not in body["data"]


def test_resolve_openai_model():
    from app.services.ai.llm import resolve_openai_model
    from app.config import settings

    default = resolve_openai_model(None)
    assert default
    assert resolve_openai_model("") == default
    assert resolve_openai_model(settings.openai_model) == settings.openai_model
    assert resolve_openai_model("gpt-test-custom.1") == "gpt-test-custom.1"
    try:
        resolve_openai_model("bad model!!")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_start_and_stop_campaign_job(client, monkeypatch):
    from app.services.campaign.execution import campaign_runner, campaign_job_store

    monkeypatch.setattr(campaign_runner, "start", lambda job_id: True)

    payload = {
        "plan": {
            "title": "Run",
            "duration_min": 15,
            "lines": [
                {
                    "at_sec": 0,
                    "speaker_id": "a",
                    "action": "send",
                    "text": "line one here",
                },
                {
                    "at_sec": 12,
                    "speaker_id": "b",
                    "action": "reply",
                    "text": "line two here",
                    "reply_to_line": 1,
                },
            ],
        },
        "speakers": [
            {"id": "a", "label": "A", "phone": "+100", "role": "lead"},
            {"id": "b", "label": "B", "phone": "+200", "role": "echo"},
        ],
        "group_link": "https://t.me/testgroup",
    }
    res = client.post("/api/campaign/jobs", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["data"]["job_id"] > 0
    assert body["data"]["total_lines"] == 2
    job_id = body["data"]["job_id"]
    job = campaign_job_store.get(job_id)
    assert job is not None

    got = client.get(f"/api/campaign/jobs/{job_id}")
    assert got.status_code == 200
    assert got.json()["data"]["id"] == job_id

    stop = client.post(f"/api/campaign/jobs/{job_id}/stop")
    assert stop.status_code == 200
    assert stop.json()["success"] is True


def test_resume_campaign_job(client, monkeypatch):
    from app.services.campaign.execution import campaign_runner, campaign_job_store

    monkeypatch.setattr(campaign_runner, "start", lambda job_id, **kw: True)
    monkeypatch.setattr(campaign_runner, "resume", lambda job_id: True)

    payload = {
        "plan": {
            "title": "Run",
            "duration_min": 15,
            "lines": [
                {
                    "at_sec": 0,
                    "speaker_id": "a",
                    "action": "send",
                    "text": "line one here",
                },
                {
                    "at_sec": 12,
                    "speaker_id": "b",
                    "action": "send",
                    "text": "line two here",
                },
            ],
        },
        "speakers": [
            {"id": "a", "label": "A", "phone": "+100", "role": "lead"},
            {"id": "b", "label": "B", "phone": "+200", "role": "echo"},
        ],
        "group_link": "https://t.me/testgroup",
    }
    res = client.post("/api/campaign/jobs", json=payload)
    job_id = res.json()["data"]["job_id"]

    stop = client.post(f"/api/campaign/jobs/{job_id}/stop")
    assert stop.status_code == 200

    # Simulate stopped with remaining work
    job = campaign_job_store.get(job_id)
    assert job is not None
    campaign_job_store.mark_finished(job_id, "stopped")

    resume = client.post(f"/api/campaign/jobs/{job_id}/resume")
    assert resume.status_code == 200
    assert resume.json()["success"] is True
    assert resume.json()["data"]["id"] == job_id

    # Missing job
    assert client.post("/api/campaign/jobs/999999/resume").status_code == 404
