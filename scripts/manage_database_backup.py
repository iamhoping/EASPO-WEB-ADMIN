#!/usr/bin/env python3
"""Create and restore full PostgreSQL backups for EASPO."""

from __future__ import annotations

import argparse
import getpass
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


BACKUP_DIR = Path(__file__).resolve().parents[1] / "backups"
BACKUP_NAME_PATTERN = re.compile(
    r"easp_backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-(?:AM|PM)(?:-\d+)?\.sql"
)
POSTGRES_DUMP_HEADER = b"PostgreSQL database dump"
RESTORE_CONFIRMATION = "Are you sure? This will replace all current data with the backup data."
KEEP_BACKUPS = 7


def get_database_url() -> str:
    value = os.environ.get("SUPABASE_DB_URL", "").strip()
    if value:
        return value
    return getpass.getpass("Enter the Supabase PostgreSQL connection URL (input hidden): ").strip()


def database_environment(database_url: str) -> dict[str, str]:
    try:
        parsed = urlsplit(database_url)
        hostname = parsed.hostname
        port = parsed.port or 5432
    except ValueError as error:
        raise RuntimeError("SUPABASE_DB_URL is not a valid PostgreSQL connection URL.") from error

    database_name = unquote(parsed.path.lstrip("/"))
    username = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    if parsed.scheme not in {"postgres", "postgresql"} or not hostname or not database_name or not username or not password:
        raise RuntimeError("SUPABASE_DB_URL must include a PostgreSQL host, database, username, and password.")

    sslmode = parse_qs(parsed.query).get("sslmode", ["require"])[0]
    environment = os.environ.copy()
    environment.pop("SUPABASE_DB_URL", None)
    environment.update({
        "PGHOST": hostname,
        "PGPORT": str(port),
        "PGDATABASE": database_name,
        "PGUSER": username,
        "PGPASSWORD": password,
        "PGSSLMODE": sslmode,
        "PGAPPNAME": "easpo-database-backup",
    })
    return environment


def run_command(command: list[str], environment: dict[str, str]) -> None:
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            env=environment,
        )
    except FileNotFoundError as error:
        tool = Path(command[0]).name
        raise RuntimeError(
            f"{tool} was not found. Install the PostgreSQL command-line tools and try again."
        ) from error

    if result.returncode:
        detail = (result.stderr or "").strip()
        suffix = f" Details: {detail}" if detail else ""
        raise RuntimeError(f"{Path(command[0]).name} failed with exit code {result.returncode}.{suffix}")


def reserve_backup_path(directory: Path, timestamp: datetime) -> Path:
    stem = f"easp_backup_{timestamp.strftime('%Y-%m-%d_%I-%M-%p')}"
    sequence = 1
    while True:
        suffix = "" if sequence == 1 else f"-{sequence}"
        candidate = directory / f"{stem}{suffix}.sql"
        try:
            descriptor = os.open(candidate, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(descriptor)
            return candidate
        except FileExistsError:
            sequence += 1


def prune_backups(directory: Path) -> int:
    backups = [
        path for path in directory.iterdir()
        if BACKUP_NAME_PATTERN.fullmatch(path.name) and path.is_file() and not path.is_symlink()
    ]
    backups.sort(key=lambda path: (path.stat().st_mtime_ns, path.name), reverse=True)
    expired = backups[KEEP_BACKUPS:]
    for path in expired:
        path.unlink()
    return len(expired)


def create_backup(
    directory: Path = BACKUP_DIR,
    database_url: str | None = None,
    timestamp: datetime | None = None,
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    environment = database_environment(database_url or get_database_url())
    backup_time = timestamp or datetime.now().astimezone()
    backup_path = reserve_backup_path(directory, backup_time)
    temporary_path: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(
            prefix=".easp_backup_",
            suffix=".tmp",
            dir=directory,
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)

        run_command([
            "pg_dump",
            "--format=plain",
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-acl",
            "--file",
            str(temporary_path),
        ], environment)

        if not temporary_path.is_file() or temporary_path.stat().st_size == 0:
            raise RuntimeError("pg_dump completed without creating a non-empty SQL backup.")
        with temporary_path.open("rb") as backup_file:
            if POSTGRES_DUMP_HEADER not in backup_file.read(1024):
                raise RuntimeError("The output is not a plain PostgreSQL SQL dump.")

        os.replace(temporary_path, backup_path)
        temporary_path = None
        prune_backups(directory)
        return backup_path
    except OSError as error:
        raise RuntimeError(f"Could not save or rotate SQL backups: {error}") from error
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()
        if backup_path.exists() and backup_path.stat().st_size == 0:
            backup_path.unlink()


def validate_backup_file(backup_file: str | Path, directory: Path = BACKUP_DIR) -> Path:
    directory_path = directory.resolve()
    try:
        candidate = Path(backup_file).expanduser().resolve(strict=True)
    except FileNotFoundError as error:
        raise RuntimeError("The selected SQL backup file could not be found.") from error
    if candidate.parent != directory_path or not candidate.is_file():
        raise RuntimeError("Choose a SQL backup file directly inside the backups folder.")
    if not BACKUP_NAME_PATTERN.fullmatch(candidate.name):
        raise RuntimeError("The file name is not a recognized EASPO full-database backup.")
    with candidate.open("rb") as source:
        header = source.read(1024)
    if POSTGRES_DUMP_HEADER not in header:
        raise RuntimeError("The selected file is not a plain PostgreSQL SQL dump.")
    return candidate


def restore_backup(
    backup_file: str | Path,
    directory: Path = BACKUP_DIR,
    database_url: str | None = None,
    input_fn=None,
    print_fn=None,
) -> bool:
    source = validate_backup_file(backup_file, directory)
    read_input = input_fn or input
    print_message = print_fn or print

    print_message(RESTORE_CONFIRMATION)
    try:
        answer = read_input("Type the full sentence exactly to continue: ")
    except EOFError:
        print_message("Restore cancelled.")
        return False
    if answer != RESTORE_CONFIRMATION:
        print_message("Restore cancelled; no database changes were made.")
        return False

    environment = database_environment(database_url or get_database_url())
    run_command([
        "psql",
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        "--single-transaction",
        "--file",
        str(source),
    ], environment)
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create or restore full EASPO PostgreSQL backups.")
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("backup", help="create a full .sql backup and keep the latest seven")
    restore_parser = commands.add_parser("restore", help="replace database contents from a full .sql backup")
    restore_parser.add_argument("backup_file", help="backup file inside the backups folder")
    arguments = parser.parse_args(argv)

    try:
        if arguments.action == "backup":
            backup_path = create_backup()
            print(f"Full PostgreSQL backup created: {backup_path}")
        elif restore_backup(arguments.backup_file):
            print("Full PostgreSQL restore completed.")
        return 0
    except (OSError, RuntimeError, EOFError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
