"""proxies table and session_meta.proxy_id

Revision ID: 006
Revises: 004
Create Date: 2026-07-09

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "proxies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("proxy_type", sa.String(length=16), nullable=False),
        sa.Column("host", sa.String(length=255), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=128), nullable=True),
        sa.Column("password", sa.String(length=256), nullable=True),
        sa.Column("secret", sa.String(length=128), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_check_status", sa.String(length=16), nullable=True),
        sa.Column("last_check_at", sa.DateTime(), nullable=True),
        sa.Column("last_check_message", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column(
        "session_meta",
        sa.Column("proxy_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        op.f("ix_session_meta_proxy_id"),
        "session_meta",
        ["proxy_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_session_meta_proxy_id"), table_name="session_meta")
    op.drop_column("session_meta", "proxy_id")
    op.drop_table("proxies")
