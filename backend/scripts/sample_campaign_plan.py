"""One-shot sample campaign plan (local dev)."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

# Load .env
env_path = ROOT / ".env"
if env_path.exists():
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        os.environ.setdefault(key, val)

from app.schemas.campaign import CampaignPlanRequest, CampaignSpeakerInput  # noqa: E402
from app.services.campaign.planner import plan_campaign  # noqa: E402


async def main() -> None:
    req = CampaignPlanRequest(
        goal=(
            "Friends texting today BTC/ETH on phones — price + vibe, not a market show. "
            "Very short texts (4–12 words), first letter capital, English only. "
            "FORBIDDEN: Morning all, Overall…, analyst speak, news-host recaps, perfect A-B-C-D rotation. "
            "No Yep/Exactly spam. Live prices as around/near only. "
            "Selected news: rare gossip only, never headline dumps."
        ),
        duration_min=12,
        target_lines=16,
        density="normal",
        language="en",
        group_link="https://t.me/example",
        selected_news=[
            "Bitcoin ETF outflows raise questions among traders",
            "Ethereum foundation explores AI tools for bug detection",
        ],
        must_discuss_news=[],
        speakers=[
            CampaignSpeakerInput(id="a", label="Sun Thien", phone="+84900000001", role="lead"),
            CampaignSpeakerInput(id="b", label="loop39", phone="+84900000002", role="member"),
            CampaignSpeakerInput(id="c", label="Cuong", phone="+84900000003", role="member"),
            CampaignSpeakerInput(id="d", label="Zedarel", phone="+84900000004", role="member"),
        ],
        use_market_context=True,
    )
    plan, market = await plan_campaign(req)
    print("TITLE:", plan.title)
    print("DURATION_MIN:", plan.duration_min)
    print("LINES:", len(plan.lines))
    if market:
        print("MARKET_OK:", market.get("ok"))
        for c in market.get("coins") or []:
            print(f"  {c.get('symbol')}: ${c.get('usd')} ({c.get('usd_24h_change')})")
    print("---SCRIPT---")
    labels = {s.id: s.label for s in req.speakers}
    for line in plan.lines:
        m, s = divmod(int(line.at_sec), 60)
        sp = labels.get(line.speaker_id, line.speaker_id)
        reply = ""
        if line.action == "reply" and line.reply_to_line:
            reply = f" ↩#{line.reply_to_line}"
        print(f"{m}:{s:02d}  [{sp}]{reply}  {line.text}")


if __name__ == "__main__":
    asyncio.run(main())
