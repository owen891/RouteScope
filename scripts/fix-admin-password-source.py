#!/usr/bin/env python3
"""Move the administrator password from .env into config.yaml safely.

The script never prints secret values. It creates timestamped backups before
atomically replacing either file, so operators can restore the original pair.
"""

from __future__ import annotations

import argparse
import os
import shutil
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover - depends on operator environment
    raise SystemExit("PyYAML is required; install it with: python -m pip install PyYAML") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", type=Path, default=Path("/opt/upstream-ops/.env"))
    parser.add_argument("--config", type=Path, default=Path("/opt/upstream-ops/data/config.yaml"))
    parser.add_argument(
        "--backup-dir",
        type=Path,
        help="backup parent directory (default: <config parent>/backups)",
    )
    return parser.parse_args()


def read_env(path: Path) -> tuple[dict[str, str], list[str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    values: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values, lines


def preserve_mode(path: Path, temp_path: Path) -> None:
    os.chmod(temp_path, stat.S_IMODE(path.stat().st_mode))


def stage_text(path: Path, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, raw_temp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temp_path = Path(raw_temp)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        preserve_mode(path, temp_path)
        return temp_path
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def load_config(path: Path) -> dict[str, Any]:
    loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(loaded, dict):
        raise SystemExit("config.yaml root must be a mapping; abort")
    return loaded


def main() -> int:
    args = parse_args()
    env_path = args.env.resolve(strict=True)
    config_path = args.config.resolve(strict=True)

    env, env_lines = read_env(env_path)
    password = env.get("ADMIN_PASSWORD", "")
    if not password:
        raise SystemExit("ADMIN_PASSWORD is missing or empty in .env; abort")

    config = load_config(config_path)
    auth = config.setdefault("auth", {})
    if not isinstance(auth, dict):
        raise SystemExit("config.yaml auth must be a mapping; abort")
    auth["enabled"] = True
    auth["username"] = auth.get("username") or env.get("ADMIN_USERNAME") or "admin"
    auth["password"] = password

    filtered_lines = [
        line
        for line in env_lines
        if not ("=" in line and line.split("=", 1)[0].strip() == "ADMIN_PASSWORD")
    ]
    env_content = "\n".join(filtered_lines) + "\n"
    config_content = yaml.safe_dump(config, allow_unicode=True, sort_keys=False)

    backup_parent = (args.backup_dir or config_path.parent / "backups").resolve()
    stamp = datetime.now(timezone.utc).strftime("admin-password-source-%Y%m%dT%H%M%SZ")
    backup_dir = backup_parent / stamp
    backup_dir.mkdir(parents=True, exist_ok=False)
    shutil.copy2(env_path, backup_dir / env_path.name)
    shutil.copy2(config_path, backup_dir / config_path.name)

    staged_config = stage_text(config_path, config_content)
    staged_env = stage_text(env_path, env_content)
    try:
        os.replace(staged_config, config_path)
        os.replace(staged_env, env_path)
    finally:
        staged_config.unlink(missing_ok=True)
        staged_env.unlink(missing_ok=True)

    print(f"administrator password source migrated; backups: {backup_dir}")
    print("secret values were not printed; restart the service and verify login before removing backups")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
