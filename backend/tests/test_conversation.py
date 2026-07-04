from sqlmodel import Session, select

from app.db.engine import get_engine
from app.db.models import AuditLog
from app.schemas.conversation import (
    ConversationLineInput,
    ConversationLineResult,
    ConversationParseRequest,
    ConversationScriptInput,
    ConversationSpeakerInput,
    ConversationTimingInput,
)
from app.services.conversation.audit_log import record_conversation_finish, record_conversation_start
from app.services.conversation.parser import parse_conversation_script
from app.services.conversation.runner import ConversationRunner
from app.services.conversation.store import conversation_job_store
from app.services.conversation.validator import validate_conversation_script


def _two_speakers():
    return [
        ConversationSpeakerInput(id="a", label="An", phone="+84901111111"),
        ConversationSpeakerInput(id="b", label="Binh", phone="+84902222222"),
    ]


def _line(line_id: int, speaker_id: str, text: str, reply_to: int | None = None) -> ConversationLineInput:
    return ConversationLineInput(
        id=line_id,
        script_ref=line_id,
        speaker_id=speaker_id,
        text=text,
        reply_to=reply_to,
    )


def test_parse_simple_and_marker_lines():
    script, _skipped = parse_conversation_script(
        ConversationParseRequest(
            group_link="https://t.me/testgroup",
            speakers=_two_speakers(),
            script_text=(
                "An: Chao ban\n"
                "Binh: Chao An\n"
                "#3 Binh reply 1: Hom nay on khong?\n"
                "---\n"
                "Round 2\n"
                "An: On ma"
            ),
        )
    )
    assert len(script.lines) == 4
    assert script.lines[0].speaker_id == "a"
    assert script.lines[0].script_ref == 1
    assert script.lines[2].reply_to == 1
    assert script.lines[2].script_ref == 3
    assert script.lines[2].text == "Hom nay on khong?"


def test_parse_preserves_gpt_script_ref_with_gaps():
    script, skipped = parse_conversation_script(
        ConversationParseRequest(
            group_link="https://t.me/g",
            speakers=_two_speakers(),
            script_text=(
                "#1 Person A: one\n"
                "#5 Person B: five\n"
                "#6 Person B reply_to #1: six"
            ),
        )
    )
    assert not skipped
    assert [line.script_ref for line in script.lines] == [1, 5, 6]
    assert [line.id for line in script.lines] == [1, 2, 3]
    assert script.lines[2].reply_to == 1


def test_validate_rejects_unknown_reply_target():
    script = ConversationScriptInput(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[
            _line(1, "a", "Hi"),
            _line(2, "b", "?", reply_to=99),
        ],
        timing=ConversationTimingInput(),
    )
    result = validate_conversation_script(script)
    assert result.valid is False
    assert any(item.code == "invalid_reply" for item in result.issues)


def test_validate_rejects_more_than_four_consecutive_lines():
    script = ConversationScriptInput(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[_line(i, "a", f"Line {i}") for i in range(1, 6)],
        timing=ConversationTimingInput(),
    )
    result = validate_conversation_script(script)
    assert result.valid is False
    assert any(item.code == "max_consecutive" for item in result.issues)


def test_validate_accepts_balanced_script():
    script = ConversationScriptInput(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[
            _line(1, "a", "A1"),
            _line(2, "a", "A2"),
            _line(3, "b", "B1"),
            _line(4, "a", "A3"),
        ],
        timing=ConversationTimingInput(),
    )
    result = validate_conversation_script(script)
    assert result.valid is True
    assert result.line_count == 4


def test_parse_without_group_link_returns_lines(client):
    response = client.post(
        "/api/conversation/parse",
        json={
            "script_text": "An: Hello\nBinh: Hi",
            "group_link": "",
            "speakers": [
                {"id": "a", "label": "An", "phone": "+84111"},
                {"id": "b", "label": "Binh", "phone": "+84222"},
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["line_count"] == 2
    assert body["data"]["valid"] is True
    assert any(item["code"] == "missing_group" for item in body["data"]["issues"])


def test_parse_simple_reply_line():
    script, _skipped = parse_conversation_script(
        ConversationParseRequest(
            group_link="https://t.me/g",
            speakers=_two_speakers(),
            script_text="An: Hello\nBinh reply 1: Follow up",
        )
    )
    assert len(script.lines) == 2
    assert script.lines[1].reply_to == 1
    assert script.lines[1].text == "Follow up"


def test_parse_person_a_maps_to_first_speaker_when_labels_are_custom():
    script, skipped = parse_conversation_script(
        ConversationParseRequest(
            group_link="https://t.me/g",
            speakers=_two_speakers(),
            script_text=(
                "#1 Person A: Hello\n"
                "#2 Person B: Hi\n"
                "#3 Person B reply_to #1: Follow up"
            ),
        )
    )
    assert not skipped
    assert len(script.lines) == 3
    assert script.lines[0].speaker_id == "a"
    assert script.lines[1].speaker_id == "b"
    assert script.lines[2].reply_to == 1


def test_parse_reports_skipped_unknown_speaker():
    script, skipped = parse_conversation_script(
        ConversationParseRequest(
            group_link="https://t.me/g",
            speakers=_two_speakers(),
            script_text="#10 Person C: Unknown speaker",
        )
    )
    assert not script.lines
    assert any(item.code == "skipped_line" for item in skipped)


def test_parse_endpoint_via_client(client):
    response = client.post(
        "/api/conversation/parse",
        json={
            "script_text": "An: Hello\nBinh: Hi",
            "group_link": "https://t.me/demo",
            "speakers": [
                {"id": "a", "label": "An", "phone": "+84111"},
                {"id": "b", "label": "Binh", "phone": "+84222"},
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["valid"] is True
    assert body["data"]["line_count"] == 2


def test_list_jobs_endpoint(client):
    script = ConversationScriptInput(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[_line(1, "a", "Hi"), _line(2, "b", "Yo")],
        timing=ConversationTimingInput(),
    )
    conversation_job_store.create(script)

    response = client.get("/api/conversation/jobs?limit=5")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["total"] >= 1
    assert len(body["data"]["items"]) >= 1


def test_create_job_with_start_line_id_marks_earlier_lines_skipped():
    script = ConversationScriptInput(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[
            _line(1, "a", "One"),
            _line(2, "b", "Two"),
            _line(3, "a", "Three"),
        ],
        timing=ConversationTimingInput(),
    )
    job = conversation_job_store.create(script, start_line_id=2)
    results = {item.line_id: item.status for item in conversation_job_store.get_line_results(job.id or 0)}
    assert results[1] == "skipped"
    assert results[2] == "pending"
    assert results[3] == "pending"


def test_create_job_with_start_line_id_carries_success_results():
    script = ConversationScriptInput(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[
            _line(1, "a", "One"),
            _line(2, "b", "Two"),
            _line(3, "a", "Three"),
            _line(4, "b", "Four"),
        ],
        timing=ConversationTimingInput(),
    )
    carried = [
        ConversationLineResult(
            line_id=1,
            speaker_id="a",
            phone="+84901111111",
            status="success",
            message_id=101,
            detail="Da gui",
        ),
        ConversationLineResult(
            line_id=2,
            speaker_id="b",
            phone="+84902222222",
            status="success",
            message_id=102,
            detail="Da gui",
        ),
    ]
    job = conversation_job_store.create(
        script,
        start_line_id=4,
        carried_line_results=carried,
    )
    results = {
        item.line_id: item
        for item in conversation_job_store.get_line_results(job.id or 0)
    }
    assert results[1].status == "success"
    assert results[1].message_id == 101
    assert results[2].status == "success"
    assert results[3].status == "skipped"
    assert results[3].detail == "Bo qua — chay tu dong #4"
    assert results[4].status == "pending"


def test_store_reset_line_for_retry():
    script = ConversationScriptInput(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[_line(1, "a", "Hi"), _line(2, "b", "Yo")],
        timing=ConversationTimingInput(),
    )
    job = conversation_job_store.create(script)
    job_id = job.id or 0
    conversation_job_store.update_line_result(
        job_id,
        ConversationLineResult(
            line_id=2,
            speaker_id="b",
            phone="+84902222222",
            status="error",
            detail="Flood wait",
        ),
        completed_lines=1,
        success_lines=0,
        error_lines=1,
    )
    reset = conversation_job_store.reset_line_for_retry(job_id, 2)
    assert reset is not None
    results = {item.line_id: item.status for item in conversation_job_store.get_line_results(job_id)}
    assert results[2] == "pending"


def test_running_detail_includes_typing_seconds():
    detail = ConversationRunner._running_detail(5, None, 2)
    assert "Dang go (5s)" in detail
    assert "Tra loi dong #2" in detail


def test_wait_detail_describes_speaker_change():
    assert ConversationRunner._wait_detail(12, True) == "Cho delay (12s) — doi nguoi"
    assert ConversationRunner._wait_detail(8, False) == "Cho delay (8s) — cung nguoi"


def test_success_detail_includes_typing_when_used():
    detail = ConversationRunner._success_detail(
        "Da gui tin nhan",
        101,
        None,
        None,
        typing_seconds=4,
    )
    assert "Go 4s" in detail
    assert "TG #101" in detail


def test_pick_typing_delay_disabled_when_max_zero():
    script = ConversationScriptInput(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[_line(1, "a", "One")],
        timing=ConversationTimingInput(typing_min_sec=2, typing_max_sec=0),
    )
    assert ConversationRunner._pick_typing_delay(script) == 0


def test_pick_typing_delay_swaps_inverted_range():
    script = ConversationScriptInput(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[_line(1, "a", "One")],
        timing=ConversationTimingInput(typing_min_sec=8, typing_max_sec=3),
    )
    delay = ConversationRunner._pick_typing_delay(script)
    assert 3 <= delay <= 8


def test_resolve_final_status_marks_error_when_lines_failed():
    assert ConversationRunner._resolve_final_status(999_999, 1) == "error"
    assert ConversationRunner._resolve_final_status(999_999, 0) == "done"


def test_resolve_final_status_stays_pending_when_lines_remain():
    script = ConversationScriptInput(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[
            _line(1, "a", "One"),
            _line(2, "b", "Two"),
            _line(3, "a", "Three"),
        ],
        timing=ConversationTimingInput(),
    )
    job = conversation_job_store.create(script)
    job_id = job.id or 0
    conversation_job_store.update_line_result(
        job_id,
        ConversationLineResult(
            line_id=1,
            speaker_id="a",
            phone="+84901111111",
            status="success",
            detail="Da gui",
        ),
        completed_lines=1,
        success_lines=1,
        error_lines=0,
    )
    assert ConversationRunner._resolve_final_status(job_id, 0) == "pending"


def test_conversation_audit_start_and_finish(test_paths):
    script = ConversationScriptInput(
        group_link="https://t.me/audit_conv",
        peer_id="-100123",
        speakers=_two_speakers(),
        lines=[_line(1, "a", "Hi"), _line(2, "b", "Yo")],
        timing=ConversationTimingInput(
            delay_min_sec=4,
            delay_max_sec=8,
            typing_min_sec=2,
            typing_max_sec=5,
        ),
    )
    job = conversation_job_store.create(script)
    job_id = job.id or 0

    record_conversation_start(job_id, script)
    conversation_job_store.mark_running(job_id)
    conversation_job_store.update_line_result(
        job_id,
        ConversationLineResult(
            line_id=1,
            speaker_id="a",
            phone="+84901111111",
            status="success",
            message_id=11,
            detail="Da gui",
        ),
        completed_lines=1,
        success_lines=1,
        error_lines=0,
    )
    conversation_job_store.mark_finished(job_id, "done")
    record_conversation_finish(job_id, "done")

    with Session(get_engine()) as session:
        audits = session.exec(
            select(AuditLog)
            .where(AuditLog.phone == "+84901111111")
            .order_by(AuditLog.created_at)
        ).all()

    assert len(audits) == 2
    start = audits[0]
    finish = audits[1]
    assert start.action == "conversation.start"
    assert start.status == "info"
    assert start.resource == "-100123"
    assert "total_lines" in (start.detail or "")
    assert "typing_min_sec" in (start.detail or "")

    assert finish.action == "conversation.run"
    assert finish.status == "success"
    assert "success_lines" in (finish.detail or "")
    assert "final_status" in (finish.detail or "")


def test_conversation_audit_maps_error_status(test_paths):
    script = ConversationScriptInput(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[_line(1, "a", "Hi")],
        timing=ConversationTimingInput(),
    )
    job = conversation_job_store.create(script)
    job_id = job.id or 0
    conversation_job_store.mark_finished(job_id, "error", "Gui that bai")
    record_conversation_finish(job_id, "error", error_message="Gui that bai")

    with Session(get_engine()) as session:
        row = session.exec(
            select(AuditLog).where(AuditLog.action == "conversation.run")
        ).first()

    assert row is not None
    assert row.status == "error"
    assert "error_message" in (row.detail or "")