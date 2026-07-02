"""conversation_jobs table

Revision ID: 003
Revises: 002
Create Date: 2026-07-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.drop_index(op.f("ix_conversation_jobs_created_at"), table_name="conversation_jobs")
    op.drop_index(op.f("ix_conversation_jobs_status"), table_name="conversation_jobs")
    op.drop_table("conversation_jobs")