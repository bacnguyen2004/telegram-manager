"""Campaign execution runtime tests (store / runner / validator / audit).

Public API: /api/campaign/* — see test_campaign.py.
Audit action strings stay conversation.* for existing UI filters.
"""

from sqlmodel import Session, select

from app.db.engine import get_engine
from app.db.models import AuditLog
from app.schemas.campaign import (
    CampaignScriptLine,
    CampaignLineResult,
    CampaignScript,
    CampaignSpeakerRuntimeInput,
    CampaignTimingInput,
)
from app.services.campaign.execution.audit_log import (
    record_job_finish,
    record_job_start,
)
from app.services.campaign.execution.runner import CampaignRunner
from app.services.campaign.execution.store import campaign_job_store
from app.services.campaign.execution.validator import validate_campaign_script_structure


def _two_speakers():
    return [
        CampaignSpeakerRuntimeInput(id="a", label="An", phone="+84901111111"),
        CampaignSpeakerRuntimeInput(id="b", label="Binh", phone="+84902222222"),
    ]


def _line(
    line_id: int, speaker_id: str, text: str, reply_to: int | None = None
) -> CampaignScriptLine:
    return CampaignScriptLine(
        id=line_id,
        script_ref=line_id,
        speaker_id=speaker_id,
        text=text,
        reply_to=reply_to,
    )


def test_validate_rejects_unknown_reply_target():
    script = CampaignScript(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[
            _line(1, "a", "Hi"),
            _line(2, "b", "?", reply_to=99),
        ],
        timing=CampaignTimingInput(),
    )
    result = validate_campaign_script_structure(script)
    assert result.valid is False
    assert any(item.code == "invalid_reply" for item in result.issues)


def test_validate_rejects_more_than_four_consecutive_lines():
    script = CampaignScript(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[_line(i, "a", f"Line {i}") for i in range(1, 6)],
        timing=CampaignTimingInput(),
    )
    result = validate_campaign_script_structure(script)
    assert result.valid is False
    assert any(item.code == "max_consecutive" for item in result.issues)


def test_validate_accepts_balanced_script():
    script = CampaignScript(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[
            _line(1, "a", "A1"),
            _line(2, "a", "A2"),
            _line(3, "b", "B1"),
            _line(4, "a", "A3"),
        ],
        timing=CampaignTimingInput(),
    )
    result = validate_campaign_script_structure(script)
    assert result.valid is True
    assert result.line_count == 4


def test_create_job_with_start_line_id_marks_earlier_lines_skipped():
    script = CampaignScript(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[
            _line(1, "a", "One"),
            _line(2, "b", "Two"),
            _line(3, "a", "Three"),
        ],
        timing=CampaignTimingInput(),
    )
    job = campaign_job_store.create(script, start_line_id=2)
    results = {
        item.line_id: item.status
        for item in campaign_job_store.get_line_results(job.id or 0)
    }
    assert results[1] == "skipped"
    assert results[2] == "pending"
    assert results[3] == "pending"


def test_create_job_with_start_line_id_carries_success_results():
    script = CampaignScript(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[
            _line(1, "a", "One"),
            _line(2, "b", "Two"),
            _line(3, "a", "Three"),
            _line(4, "b", "Four"),
        ],
        timing=CampaignTimingInput(),
    )
    carried = [
        CampaignLineResult(
            line_id=1,
            speaker_id="a",
            phone="+84901111111",
            status="success",
            message_id=101,
            detail="Da gui",
        ),
        CampaignLineResult(
            line_id=2,
            speaker_id="b",
            phone="+84902222222",
            status="success",
            message_id=102,
            detail="Da gui",
        ),
    ]
    job = campaign_job_store.create(
        script,
        start_line_id=4,
        carried_line_results=carried,
    )
    results = {
        item.line_id: item
        for item in campaign_job_store.get_line_results(job.id or 0)
    }
    assert results[1].status == "success"
    assert results[1].message_id == 101
    assert results[2].status == "success"
    assert results[3].status == "skipped"
    assert results[3].detail == "Bo qua — chay tu dong #4"
    assert results[4].status == "pending"


def test_store_reset_line_for_retry():
    script = CampaignScript(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[_line(1, "a", "Hi"), _line(2, "b", "Yo")],
        timing=CampaignTimingInput(),
    )
    job = campaign_job_store.create(script)
    job_id = job.id or 0
    campaign_job_store.update_line_result(
        job_id,
        CampaignLineResult(
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
    reset = campaign_job_store.reset_line_for_retry(job_id, 2)
    assert reset is not None
    results = {
        item.line_id: item.status
        for item in campaign_job_store.get_line_results(job_id)
    }
    assert results[2] == "pending"


def test_running_detail_includes_typing_seconds():
    detail = CampaignRunner._running_detail(5, None, 2)
    assert "Dang go (5s)" in detail
    assert "Tra loi dong #2" in detail


def test_wait_detail_describes_speaker_change():
    assert CampaignRunner._wait_detail(12, True) == "Cho delay (12s) — doi nguoi"
    assert CampaignRunner._wait_detail(8, False) == "Cho delay (8s) — cung nguoi"
    assert "lich t+20s" in CampaignRunner._wait_detail(
        8, False, schedule_at=20, typing_sec=5
    )
    assert "go 5s" in CampaignRunner._wait_detail(
        8, False, schedule_at=20, typing_sec=5
    )


def test_fold_typing_into_remaining_does_not_stack():
    # Gap 12s, want 5s typing → wait 7 + type 5 = 12 (no extra)
    wait, typing = CampaignRunner.fold_typing_into_remaining(12.0, 5)
    assert wait + typing == 12
    assert typing == 5
    assert wait == 7
    # Tight gap: typing fills whole window
    wait, typing = CampaignRunner.fold_typing_into_remaining(3.0, 7)
    assert wait == 0
    assert typing == 3
    # Late: short typing flash (still visible in group)
    wait, typing = CampaignRunner.fold_typing_into_remaining(-1.0, 5)
    assert wait == 0
    assert typing == 3
    # Sub-second remaining must NOT zero typing
    wait, typing = CampaignRunner.fold_typing_into_remaining(0.5, 5)
    assert wait == 0
    assert typing >= 1
    # Typing disabled
    wait, typing = CampaignRunner.fold_typing_into_remaining(10.0, 0)
    assert wait == 10
    assert typing == 0


def test_success_detail_includes_typing_when_used():
    detail = CampaignRunner._success_detail(
        "Da gui tin nhan",
        101,
        None,
        None,
        typing_seconds=4,
    )
    assert "Go 4s" in detail
    assert "TG #101" in detail


def test_pick_typing_delay_disabled_when_max_zero():
    script = CampaignScript(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[_line(1, "a", "One")],
        timing=CampaignTimingInput(typing_min_sec=2, typing_max_sec=0),
    )
    assert CampaignRunner._pick_typing_delay(script) == 0
    assert CampaignRunner._pick_typing_delay(script, "ok") == 0


def test_pick_typing_delay_swaps_inverted_range():
    script = CampaignScript(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[_line(1, "a", "One")],
        timing=CampaignTimingInput(typing_min_sec=8, typing_max_sec=3),
    )
    delay = CampaignRunner._pick_typing_delay(script)
    assert 3 <= delay <= 8


def test_pick_typing_delay_always_shows_when_enabled():
    script = CampaignScript(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[_line(1, "a", "One")],
        timing=CampaignTimingInput(typing_min_sec=2, typing_max_sec=7),
    )
    for text in ("ok", "yep", "Yeah true", "BTC looks heavy near support"):
        delay = CampaignRunner._pick_typing_delay(script, text)
        assert delay >= 1, text
        assert delay <= 7, text


def test_resolve_final_status_marks_error_when_lines_failed():
    assert CampaignRunner._resolve_final_status(999_999, 1) == "error"
    assert CampaignRunner._resolve_final_status(999_999, 0) == "done"


def test_resolve_final_status_stays_pending_when_lines_remain():
    script = CampaignScript(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[
            _line(1, "a", "One"),
            _line(2, "b", "Two"),
            _line(3, "a", "Three"),
        ],
        timing=CampaignTimingInput(),
    )
    job = campaign_job_store.create(script)
    job_id = job.id or 0
    campaign_job_store.update_line_result(
        job_id,
        CampaignLineResult(
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
    assert CampaignRunner._resolve_final_status(job_id, 0) == "pending"


def test_conversation_audit_start_and_finish(test_paths):
    script = CampaignScript(
        group_link="https://t.me/audit_conv",
        peer_id="-100123",
        speakers=_two_speakers(),
        lines=[_line(1, "a", "Hi"), _line(2, "b", "Yo")],
        timing=CampaignTimingInput(
            delay_min_sec=4,
            delay_max_sec=8,
            typing_min_sec=2,
            typing_max_sec=5,
        ),
    )
    job = campaign_job_store.create(script)
    job_id = job.id or 0

    record_job_start(job_id, script)
    campaign_job_store.mark_running(job_id)
    campaign_job_store.update_line_result(
        job_id,
        CampaignLineResult(
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
    campaign_job_store.mark_finished(job_id, "done")
    record_job_finish(job_id, "done")

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
    script = CampaignScript(
        group_link="https://t.me/g",
        speakers=_two_speakers(),
        lines=[_line(1, "a", "Hi")],
        timing=CampaignTimingInput(),
    )
    job = campaign_job_store.create(script)
    job_id = job.id or 0
    campaign_job_store.mark_finished(job_id, "error", "Gui that bai")
    record_job_finish(job_id, "error", error_message="Gui that bai")

    with Session(get_engine()) as session:
        row = session.exec(
            select(AuditLog).where(AuditLog.action == "conversation.run")
        ).first()

    assert row is not None
    assert row.status == "error"
    assert "error_message" in (row.detail or "")
