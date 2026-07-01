#!/bin/sh
set -e

if [ "${DATABASE_ENABLED:-true}" != "false" ]; then
  echo "Running Alembic migrations..."
  alembic upgrade head
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8001