from app.schemas.campaign import CampaignPlan, CampaignPlanLine, CampaignSpeakerInput
from app.services.campaign.normalize import (
    parse_plan_dict,
    plan_to_conversation_script,
    validate_campaign_script,
)
from app.services.campaign.conversation_beats import (
    ai_transition_hits,
    beat_compliance_issues,
    beat_for_batch,
    build_speaker_cards,
    extract_banned_phrases,
    format_beat_block,
    host_dominance_issues,
    motif_rehash_issues,
)
from app.services.campaign.planner import (
    _chunk_sizes,
    _extract_json_object,
    back_to_back_count,
    branch_diversity_score,
    branch_hints_for_phase,
    chunk_size_for_target,
    extract_said_topics,
    echo_shape_score,
    fair_but_count,
    fair_but_score,
    human_mess_score,
    glued_micro_ack_count,
    long_message_score,
    reactor_motif_score,
    phase_for_batch,
    price_density_score,
    reply_rate,
    round_robin_score,
    soft_ack_score,
    topic_repeat_score,
    ultra_short_score,
    vibe_repeat_score,
)


def test_extract_json_object_plain_and_fenced():
    from app.services.campaign.planner import (
        _chunk_sizes,
        _extract_json_object,
        _merge_chunk_lines,
        _tokens_for_chunk,
    )
    from app.schemas.campaign import CampaignPlanLine

    raw = '{"title": "x", "duration_min": 10, "lines": []}'
    assert _extract_json_object(raw)["title"] == "x"
    fenced = '```json\n{"title": "y", "duration_min": 12, "lines": []}\n```'
    assert _extract_json_object(fenced)["title"] == "y"
    assert _tokens_for_chunk(40) >= 6000
    assert _chunk_sizes(200, 40) == [40, 40, 40, 40, 40]
    assert _chunk_sizes(90, 40) == [40, 40, 10]

    existing = [
        CampaignPlanLine(at_sec=0, speaker_id="a", action="send", text="hi"),
    ]
    chunk = [
        CampaignPlanLine(at_sec=0, speaker_id="b", action="send", text="yo"),
        CampaignPlanLine(at_sec=10, speaker_id="a", action="reply", text="ok", reply_to_line=1),
    ]
    merged = _merge_chunk_lines(existing, chunk)
    assert len(merged) == 3
    # local reply 1 → first line of chunk → global index 2 (1-based)
    assert merged[2].reply_to_line == 2


def test_vibe_reply_and_back_to_back_helpers():
    bored = [
        CampaignPlanLine(at_sec=i, speaker_id="a", action="send", text=t)
        for i, t in enumerate(
            [
                "Btc still near 63k hold",
                "So bored sideways again",
                "Volume thin today",
                "Patience holding tight",
                "Eth sleepy 1745",
                "Still waiting breakout",
                "Paint dry market",
                "63k base solid",
            ]
        )
    ]
    assert vibe_repeat_score(bored) >= 0.7
    assert "sideways_bored" in extract_said_topics(bored)
    assert price_density_score(bored) >= 0.25
    assert back_to_back_count(list("aabcdbba")) == 2
    assert (
        reply_rate(
            [
                CampaignPlanLine(at_sec=0, speaker_id="a", action="send", text="hi"),
                CampaignPlanLine(
                    at_sec=1, speaker_id="b", action="reply", text="yo", reply_to_line=1
                ),
            ]
        )
        == 0.5
    )
    assert chunk_size_for_target(150) == 25
    assert phase_for_batch(1, 6) == "open"
    assert phase_for_batch(6, 6) == "close"

    acks = [
        CampaignPlanLine(at_sec=i, speaker_id="a", action="send", text=t)
        for i, t in enumerate(["Yeah", "True", "Could be", "BTC looks heavy"])
    ]
    assert soft_ack_score(acks) >= 0.5

    # Telegram rhythm helpers: 1–2 word share vs long essays
    mixed = [
        CampaignPlanLine(at_sec=i, speaker_id="a", action="send", text=t)
        for i, t in enumerate(
            [
                "BTC sleepy",
                "Same",
                "Pain",
                "lol",
                "Still holding?",
                "Yep",
                "Hard pass",
                "I added a small size near here",
                "Good call",
                "Looks rough near support still",
                "Fair enough",
                "Too risky",
            ]
        )
    ]
    assert ultra_short_score(mixed) >= 0.10  # Same/Pain/lol/Yep/Hard pass/Good call…
    assert long_message_score(mixed) <= 0.10

    fair_spam = [
        CampaignPlanLine(at_sec=i, speaker_id="a", action="send", text=t)
        for i, t in enumerate(
            [
                "Fair, but ETH still soft",
                "Fair but low volatility here",
                "Yeah, but stop is tight",
                "Same",
                "Pain",
            ]
        )
    ]
    assert fair_but_count(fair_spam) >= 3
    assert fair_but_score(fair_spam) >= 0.5

    messy = [
        CampaignPlanLine(at_sec=i, speaker_id="a", action="send", text=t)
        for i, t in enumerate(
            ["lol", "idk man", "wait what", "nvm", "BTC still soft near here"]
        )
    ]
    assert human_mess_score(messy) >= 0.5

    reactor_spam = [
        CampaignPlanLine(at_sec=i, speaker_id="b", action="send", text=t)
        for i, t in enumerate(
            ["Lol", "Ouch", "Pain", "Wtf that move", "Same", "Lmao", "Hard pass here"]
        )
    ]
    assert reactor_motif_score(reactor_spam) >= 0.5

    echo_spam = [
        CampaignPlanLine(at_sec=i, speaker_id="c", action="send", text=t)
        for i, t in enumerate(
            [
                "Same here honestly",
                "Not sold on that",
                "Kinda agree",
                "True that",
                "I added size near here",
            ]
        )
    ]
    assert echo_shape_score(echo_spam) >= 0.5

    glued = [
        CampaignPlanLine(at_sec=i, speaker_id="a", action="send", text=t)
        for i, t in enumerate(
            [
                "Me too, feels like it's steady at 63k",
                "True, volume still thin here",
                "Exactly, stop is tight",
                "BTC looks heavy near support",
            ]
        )
    ]
    assert glued_micro_ack_count(glued) >= 3
    assert ultra_short_score(glued) == 0.0

    branched = [
        CampaignPlanLine(at_sec=i, speaker_id="a", action="send", text=t)
        for i, t in enumerate(
            [
                "just sold a bit near here",
                "nah i still in",
                "afk work call",
                "not touching that pump",
                "lol wild",
                "ok chart later",
            ]
        )
    ]
    assert branch_diversity_score(branched) >= 0.5
    hints = branch_hints_for_phase("mid", ["sideways_bored", "patience_hold"])
    assert hints
    assert any("price" in h.lower() or "patience" in h.lower() or "bored" in h.lower() for h in hints)


def test_conversation_beat_schedule_and_fingerprints():
    b1 = beat_for_batch(1, 6)
    b2 = beat_for_batch(2, 6)
    b6 = beat_for_batch(6, 6)
    assert b1["id"] == "market_scan"
    assert b2["id"] == "trade_desk"
    assert b6["id"] == "wind_down"
    assert b1["id"] != b2["id"]
    block = format_beat_block(b2, already_topics=["etf_outflow"])
    assert "trade" in block.lower() or "PRIMARY" in block
    assert "etf_outflow" in block

    cards = build_speaker_cards(
        [
            {"id": "a", "role": "lead", "label": "Ian"},
            {"id": "b", "role": "reactor", "label": "Sun"},
            {"id": "c", "role": "degen", "label": "loop39"},
        ]
    )
    assert len(cards) == 3
    assert cards[0]["style"]
    assert cards[0].get("persona")
    assert "soft role" in (cards[0].get("persona") or "").lower() or "Soft role" in (
        cards[0].get("persona") or ""
    )
    assert cards[1]["role"] == "reactor"
    assert cards[2]["role"] == "degen"
    # Soft personas: lead avoid over-hosting; reactor avoid overusing one reaction
    assert "data dump" in cards[0]["avoid"].lower() or "summing" in cards[0]["avoid"].lower()
    assert "reaction" in cards[1]["avoid"].lower() or "every line" in cards[1]["avoid"].lower()

    # trade_desk compliance: pure price loop should fail
    pricey = [
        CampaignPlanLine(at_sec=i, speaker_id="a", action="send", text=t)
        for i, t in enumerate(
            [
                "BTC still around 63k",
                "ETH near 1750 sleepy",
                "SOL at 78 quiet",
                "BTC holding 63k",
                "ETH still 1750",
                "SOL flat near 78",
                "BTC 63k again",
                "ETH boring",
                "SOL same",
                "BTC range",
            ]
        )
    ]
    issues = beat_compliance_issues(pricey, b2, need_lines=10)
    assert issues, "trade_desk should reject pure majors loop"

    banned = extract_banned_phrases(pricey, limit=10)
    assert banned  # repeated price bigrams


def test_anti_host_and_ai_transitions():
    cards = [
        {"id": "a", "role": "lead", "style": "", "tics": "", "avoid": ""},
        {"id": "b", "role": "reactor", "style": "", "tics": "", "avoid": ""},
        {"id": "c", "role": "degen", "style": "", "tics": "", "avoid": ""},
    ]
    # Lead opens almost every thread and talks most
    hosty = []
    for i in range(12):
        if i % 3 == 0:
            hosty.append(
                CampaignPlanLine(
                    at_sec=i, speaker_id="a", action="send", text=f"New angle on charts {i}"
                )
            )
        elif i % 3 == 1:
            hosty.append(
                CampaignPlanLine(
                    at_sec=i,
                    speaker_id="b",
                    action="reply",
                    text="yeah",
                    reply_to_line=max(1, i),
                )
            )
        else:
            hosty.append(
                CampaignPlanLine(at_sec=i, speaker_id="a", action="send", text=f"Also look here {i}")
            )
    issues = host_dominance_issues(
        hosty, speaker_cards=cards, cast_ids=["a", "b", "c"], need_lines=12
    )
    assert issues

    trans = [
        CampaignPlanLine(at_sec=0, speaker_id="a", action="send", text="Speaking of alts"),
        CampaignPlanLine(at_sec=1, speaker_id="b", action="send", text="Back to BTC levels"),
        CampaignPlanLine(at_sec=2, speaker_id="c", action="send", text="Okay to sum up we wait"),
    ]
    hits = ai_transition_hits(trans)
    assert len(hits) >= 2
    assert any("speaking of" in h or "back to" in h or "sum up" in h for h in hits)

    prev = [
        CampaignPlanLine(at_sec=i, speaker_id="a", action="send", text=t)
        for i, t in enumerate(
            ["btc 63k", "still 63k", "near 63k again", "coinbase reshuffle", "coinbase again"]
        )
    ]
    batch = [
        CampaignPlanLine(at_sec=i, speaker_id="b", action="send", text=t)
        for i, t in enumerate(["63k hold", "coinbase still", "63k base"])
    ]
    m_issues = motif_rehash_issues(prev, batch, need_lines=10)
    assert m_issues


def test_parse_plan_dict_filters_and_gaps():
    plan = parse_plan_dict(
        {
            "title": "Morning",
            "duration_min": 20,
            "lines": [
                {"at_sec": 0, "speaker_id": "a", "action": "send", "text": "hi"},
                {"at_sec": 1, "speaker_id": "b", "action": "reply", "text": "yo", "reply_to_line": 1},
                {"at_sec": 50, "speaker_id": "a", "action": "send", "text": ""},
            ],
        }
    )
    assert plan.title == "Morning"
    assert len(plan.lines) == 2
    assert plan.lines[1].at_sec >= plan.lines[0].at_sec + 3


def test_parse_plan_dict_fixes_invalid_replies():
    plan = parse_plan_dict(
        {
            "title": "Fix replies",
            "duration_min": 15,
            "lines": [
                {"at_sec": 0, "speaker_id": "a", "action": "send", "text": "hi there"},
                {
                    "at_sec": 10,
                    "speaker_id": "b",
                    "action": "reply",
                    "text": "self reply bad",
                    "reply_to_line": 2,  # self / future — invalid
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


def test_rescale_timeline_even_spacing():
    from app.services.campaign.planner import _rescale_timeline

    # Simulate multi-chunk cliff: early lines ~0-400, late lines jump to 2000+
    raw_lines = [
        CampaignPlanLine(at_sec=i * 10, speaker_id="a" if i % 2 == 0 else "b", action="send", text=f"m{i}")
        for i in range(40)
    ]
    raw_lines += [
        CampaignPlanLine(
            at_sec=2000 + i * 10,
            speaker_id="a" if i % 2 == 0 else "b",
            action="send",
            text=f"n{i}",
        )
        for i in range(14)
    ]
    plan = CampaignPlan(title="T", duration_min=40, lines=raw_lines)
    scaled = _rescale_timeline(plan, 40)
    assert scaled.lines[0].at_sec == 0
    assert scaled.lines[-1].at_sec <= 40 * 60 + 5
    # No multi-minute cliff in the middle after rescale
    mid = len(scaled.lines) // 2
    gap = scaled.lines[mid].at_sec - scaled.lines[mid - 1].at_sec
    assert gap < 120


def test_plan_to_conversation_script_and_validate():
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
    script = plan_to_conversation_script(
        plan,
        speakers=speakers,
        group_link="https://t.me/example",
        peer_id=None,
    )
    assert len(script.lines) == 2
    assert script.lines[0].reply_to is None  # action=send must not become a reply
    assert script.lines[1].reply_to == 1
    # Only explicit plan replies; do not auto-reply on speaker change
    assert script.reply_on_speaker_change is False
    # Absolute schedule: typing folded into at_sec (no stack drift)
    assert script.schedule_mode is True
    assert script.lines[0].at_sec == 0
    assert script.lines[1].at_sec == 20
    # Campaign must show Telegram "đang gõ" before each send
    assert script.timing.typing_min_sec >= 2
    assert script.timing.typing_max_sec >= script.timing.typing_min_sec
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


def test_resolve_openai_model():
    from app.services.ai.llm import resolve_openai_model
    from app.config import settings

    default = resolve_openai_model(None)
    assert default
    assert resolve_openai_model("") == default
    # default always allowed
    assert resolve_openai_model(settings.openai_model) == settings.openai_model
    # safe custom id
    assert resolve_openai_model("gpt-test-custom.1") == "gpt-test-custom.1"
    try:
        resolve_openai_model("bad model!!")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_start_campaign_job_without_ai(client, monkeypatch):
    from app.services.conversation import conversation_runner, conversation_job_store

    monkeypatch.setattr(conversation_runner, "start", lambda job_id: True)

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
    job = conversation_job_store.get(body["data"]["job_id"])
    assert job is not None


def test_resume_campaign_job_after_stop(client, monkeypatch):
    from app.services.conversation import conversation_runner, conversation_job_store
    from app.schemas.conversation import ConversationLineResult

    monkeypatch.setattr(conversation_runner, "start", lambda job_id: True)
    monkeypatch.setattr(conversation_runner, "resume", lambda job_id: True)
    monkeypatch.setattr(conversation_runner, "is_active", lambda job_id: False)

    payload = {
        "plan": {
            "title": "Resume me",
            "duration_min": 15,
            "lines": [
                {
                    "at_sec": 0,
                    "speaker_id": "a",
                    "action": "send",
                    "text": "first message here",
                },
                {
                    "at_sec": 10,
                    "speaker_id": "b",
                    "action": "send",
                    "text": "second message here",
                },
            ],
        },
        "speakers": [
            {"id": "a", "label": "A", "phone": "+101", "role": "lead"},
            {"id": "b", "label": "B", "phone": "+202", "role": "echo"},
        ],
        "group_link": "https://t.me/resume_group",
    }
    start = client.post("/api/campaign/jobs", json=payload)
    assert start.status_code == 200
    job_id = start.json()["data"]["job_id"]

    # Simulate: line 1 ok, line 2 pending, job stopped
    conversation_job_store.update_line_result(
        job_id,
        ConversationLineResult(
            line_id=1,
            speaker_id="a",
            phone="+101",
            status="success",
            message_id=11,
            detail="Da gui",
        ),
        completed_lines=1,
        success_lines=1,
        error_lines=0,
    )
    conversation_job_store.mark_finished(job_id, "stopped")
    job = conversation_job_store.get(job_id)
    assert job is not None
    assert job.status == "stopped"

    res = client.post(f"/api/campaign/jobs/{job_id}/resume")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["data"]["id"] == job_id


def test_retry_campaign_line(client, monkeypatch):
    from app.services.conversation import conversation_runner, conversation_job_store
    from app.schemas.conversation import ConversationLineResult

    monkeypatch.setattr(conversation_runner, "start", lambda job_id: True)
    monkeypatch.setattr(
        conversation_runner, "retry_line", lambda job_id, line_id: True
    )
    monkeypatch.setattr(conversation_runner, "is_active", lambda job_id: False)

    payload = {
        "plan": {
            "title": "Retry",
            "duration_min": 10,
            "lines": [
                {
                    "at_sec": 0,
                    "speaker_id": "a",
                    "action": "send",
                    "text": "only line text ok",
                },
                {
                    "at_sec": 8,
                    "speaker_id": "b",
                    "action": "send",
                    "text": "second fails here",
                },
            ],
        },
        "speakers": [
            {"id": "a", "label": "A", "phone": "+111", "role": "lead"},
            {"id": "b", "label": "B", "phone": "+222", "role": "echo"},
        ],
        "group_link": "https://t.me/retry_g",
    }
    start = client.post("/api/campaign/jobs", json=payload)
    job_id = start.json()["data"]["job_id"]
    conversation_job_store.update_line_result(
        job_id,
        ConversationLineResult(
            line_id=2,
            speaker_id="b",
            phone="+222",
            status="error",
            detail="You can't write in this chat",
        ),
        completed_lines=1,
        success_lines=0,
        error_lines=1,
    )
    conversation_job_store.mark_finished(job_id, "error")

    res = client.post(f"/api/campaign/jobs/{job_id}/lines/2/retry")
    assert res.status_code == 200
    assert res.json()["success"] is True
