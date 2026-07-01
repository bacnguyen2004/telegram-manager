"""Initial metadata tables: session_meta, group_scans, audit_logs.

Revision ID: 001
Revises:
Create Date: 2026-07-01

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "session_meta",
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("telegram_user_id", sa.Integer(), nullable=True),
        sa.Column("username", sa.String(length=64), nullable=True),
        sa.Column("display_name", sa.String(length=128), nullable=True),
        sa.Column("first_login_at", sa.DateTime(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(), nullable=False),
        sa.Column("login_count", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("phone"),
    )
    op.create_index(
        op.f("ix_session_meta_telegram_user_id"),
        "session_meta",
        ["telegram_user_id"],
        unique=False,
    )

    op.create_table(
        "group_scans",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("group_count", sa.Integer(), nullable=False),
        sa.Column("channel_count", sa.Integer(), nullable=False),
        sa.Column("scanned_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_group_scans_phone"), "group_scans", ["phone"], unique=False)
    op.create_index(
        op.f("ix_group_scans_scanned_at"), "group_scans", ["scanned_at"], unique=False
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("resource", sa.String(length=256), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("detail", sa.String(length=2000), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audit_logs_action"), "audit_logs", ["action"], unique=False)
    op.create_index(
        op.f("ix_audit_logs_created_at"), "audit_logs", ["created_at"], unique=False
    )
    op.create_index(op.f("ix_audit_logs_phone"), "audit_logs", ["phone"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_audit_logs_phone"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_created_at"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_action"), table_name="audit_logs")
    op.drop_table("audit_logs")

    op.drop_index(op.f("ix_group_scans_scanned_at"), table_name="group_scans")
    op.drop_index(op.f("ix_group_scans_phone"), table_name="group_scans")
    op.drop_table("group_scans")

    op.drop_index(op.f("ix_session_meta_telegram_user_id"), table_name="session_meta")
    op.drop_table("session_meta")