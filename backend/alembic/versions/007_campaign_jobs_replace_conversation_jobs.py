"""Replace conversation_jobs with campaign_jobs (no data migrate).

Revision ID: 007
Revises: 006
Create Date: 2026-07-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names() -> set[str]:
    bind = op.get_bind()
    return set(inspect(bind).get_table_names())


def upgrade() -> None:
    names = _table_names()
    if "conversation_jobs" in names:
        # Drop legacy indexes + table (data intentionally discarded)
        try:
            op.drop_index(
                op.f("ix_conversation_jobs_created_at"),
                table_name="conversation_jobs",
            )
        except Exception:
            pass
        try:
            op.drop_index(
                op.f("ix_conversation_jobs_status"),
                table_name="conversation_jobs",
            )
        except Exception:
            pass
        op.drop_table("conversation_jobs")

    names = _table_names()
    if "campaign_jobs" in names:
        return

    op.create_table(
        "campaign_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("group_link", sa.String(length=512), nullable=False),
        sa.Column("peer_id", sa.String(length=512), nullable=False),
        sa.Column("script_json", sa.Text(), nullable=False),
        sa.Column("total_lines", sa.Integer(), nullable=False),
        sa.Column("completed_lines", sa.Integer(), nullable=False),
        sa.Column("success_lines", sa.Integer(), nullable=False),
        sa.Column("error_lines", sa.Integer(), nullable=False),
        sa.Column("stop_requested", sa.Boolean(), nullable=False),
        sa.Column("line_results_json", sa.Text(), nullable=False),
        sa.Column("error_message", sa.String(length=2000), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_campaign_jobs_status"),
        "campaign_jobs",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_campaign_jobs_created_at"),
        "campaign_jobs",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    names = _table_names()
    if "campaign_jobs" in names:
        try:
            op.drop_index(op.f("ix_campaign_jobs_created_at"), table_name="campaign_jobs")
        except Exception:
            pass
        try:
            op.drop_index(op.f("ix_campaign_jobs_status"), table_name="campaign_jobs")
        except Exception:
            pass
        op.drop_table("campaign_jobs")

    names = _table_names()
    if "conversation_jobs" in names:
        return

    op.create_table(
        "conversation_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("group_link", sa.String(length=512), nullable=False),
        sa.Column("peer_id", sa.String(length=512), nullable=False),
        sa.Column("script_json", sa.Text(), nullable=False),
        sa.Column("total_lines", sa.Integer(), nullable=False),
        sa.Column("completed_lines", sa.Integer(), nullable=False),
        sa.Column("success_lines", sa.Integer(), nullable=False),
        sa.Column("error_lines", sa.Integer(), nullable=False),
        sa.Column("stop_requested", sa.Boolean(), nullable=False),
        sa.Column("line_results_json", sa.Text(), nullable=False),
        sa.Column("error_message", sa.String(length=2000), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_conversation_jobs_status"),
        "conversation_jobs",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_conversation_jobs_created_at"),
        "conversation_jobs",
        ["created_at"],
        unique=False,
    )
