"""AI campaign planning + job orchestration for Hội thoại UI.

- ``planner`` / ``normalize`` / ``inject`` / ``goal_draft`` — building blocks
- ``workflow`` — product orchestration used by ``/api/campaign/*``
- Runtime execution: ``services.campaign.execution``
"""

from .normalize import plan_to_script, validate_campaign_script
from .planner import plan_campaign
from .workflow import (
    CampaignBadRequestError,
    CampaignConflictError,
    CampaignNotFoundError,
    CampaignUpstreamError,
    CampaignWorkflow,
    campaign_workflow,
)

__all__ = [
    "CampaignBadRequestError",
    "CampaignConflictError",
    "CampaignNotFoundError",
    "CampaignUpstreamError",
    "CampaignWorkflow",
    "campaign_workflow",
    "plan_campaign",
    "plan_to_script",
    "validate_campaign_script",
]
