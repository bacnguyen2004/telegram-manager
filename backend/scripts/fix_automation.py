from pathlib import Path

src = Path("app/services/conversation")
dst = Path("app/services/automation/conversation")
dst.mkdir(parents=True, exist_ok=True)

for name in ["parser.py", "validator.py", "runner.py", "store.py", "audit_log.py"]:
    text = (src / name).read_text(encoding="utf-8")
    # skip if already a facade
    if "Backward-compatible facade" in text:
        raise SystemExit(f"{name} is already a facade; restore from git first")
    text = text.replace("from ...schemas", "from ....schemas")
    text = text.replace("from ...db", "from ....db")
    text = text.replace("from ..telegram", "from ...telegram")
    (dst / name).write_text(text, encoding="utf-8")
    print("wrote", dst / name)

(dst / "__init__.py").write_text(
    "from .parser import parse_conversation_script\n"
    "from .runner import conversation_runner\n"
    "from .store import conversation_job_store\n"
    "from .validator import validate_conversation_script\n"
    "\n"
    "__all__ = [\n"
    '    "conversation_job_store",\n'
    '    "conversation_runner",\n'
    '    "parse_conversation_script",\n'
    '    "validate_conversation_script",\n'
    "]\n",
    encoding="utf-8",
)

Path("app/services/automation/__init__.py").write_text(
    "from .conversation import (\n"
    "    conversation_job_store,\n"
    "    conversation_runner,\n"
    "    parse_conversation_script,\n"
    "    validate_conversation_script,\n"
    ")\n"
    "\n"
    "__all__ = [\n"
    '    "conversation_job_store",\n'
    '    "conversation_runner",\n'
    '    "parse_conversation_script",\n'
    '    "validate_conversation_script",\n'
    "]\n",
    encoding="utf-8",
)

for name in ["parser", "validator", "runner", "store", "audit_log"]:
    (src / f"{name}.py").write_text(
        '"""Backward-compatible facade."""\n'
        f"from ..automation.conversation.{name} import *  # noqa: F403\n",
        encoding="utf-8",
    )

(src / "__init__.py").write_text(
    '"""Backward-compatible facade for conversation automation."""\n'
    "from ..automation.conversation import (\n"
    "    conversation_job_store,\n"
    "    conversation_runner,\n"
    "    parse_conversation_script,\n"
    "    validate_conversation_script,\n"
    ")\n"
    "\n"
    "__all__ = [\n"
    '    "conversation_job_store",\n'
    '    "conversation_runner",\n'
    '    "parse_conversation_script",\n'
    '    "validate_conversation_script",\n'
    "]\n",
    encoding="utf-8",
)
print("done")
