#!/usr/bin/env python3
"""Create, encrypt, upload, and verify a PostgreSQL backup in S3-compatible storage."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PREFIX = "backups/easpo-db/"
RETENTION_DAYS = 30


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable {name} is not configured.")
    return value


def safe_error(error: BaseException) -> str:
    message = str(error)
    secrets = (
        os.environ.get("SUPABASE_DB_URL", ""),
        os.environ.get("BACKUP_RUNNER_SECRET", ""),
        os.environ.get("AWS_ACCESS_KEY_ID", ""),
        os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
    )
    for secret in secrets:
        if secret:
            message = message.replace(secret, "[redacted]")
    return message[:1000] or error.__class__.__name__


def run(command: list[str], *, capture: bool = False) -> str:
    result = subprocess.run(
        command,
        check=False,
        text=True,
        stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        env={**os.environ, "PGSSLMODE": "require"},
    )
    if result.returncode:
        detail = (result.stderr or "").strip()
        raise RuntimeError(f"Command failed ({Path(command[0]).name}, exit {result.returncode}): {detail}")
    return result.stdout if capture else ""


def record_backup_event(payload: dict) -> dict:
    base_url = required_env("SUPABASE_URL").rstrip("/")
    anon_key = required_env("SUPABASE_ANON_KEY")
    runner_secret = required_env("BACKUP_RUNNER_SECRET")
    data = json.dumps(payload).encode()
    request = Request(
        f"{base_url}/functions/v1/record-backup-run",
        data=data,
        method="POST",
        headers={
            "apikey": anon_key,
            "Content-Type": "application/json",
            "x-backup-runner-secret": runner_secret,
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            parsed = json.loads(response.read() or b"{}")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Backup history request failed: {detail or error.code}") from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"Backup history request failed: {error}") from error
    if not isinstance(parsed, dict) or parsed.get("ok") is not True:
        raise RuntimeError("Backup history returned an unexpected response.")
    return parsed


def s3_command(*arguments: str, capture: bool = False) -> str:
    command = ["aws", *arguments]
    endpoint = os.environ.get("S3_ENDPOINT_URL", "").strip()
    if endpoint:
        command.extend(["--endpoint-url", endpoint])
    return run(command, capture=capture)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as backup_file:
        for chunk in iter(lambda: backup_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def expire_old_objects(bucket: str, cutoff: datetime) -> int:
    deleted = 0
    token = ""
    while True:
        args = ["s3api", "list-objects-v2", "--bucket", bucket, "--prefix", PREFIX, "--output", "json"]
        if token:
            args.extend(["--continuation-token", token])
        response = json.loads(s3_command(*args, capture=True) or "{}")
        for item in response.get("Contents", []):
            key = item.get("Key", "")
            modified = item.get("LastModified")
            if not key.startswith(PREFIX) or not modified:
                continue
            timestamp = datetime.fromisoformat(modified.replace("Z", "+00:00"))
            if timestamp < cutoff:
                s3_command("s3api", "delete-object", "--bucket", bucket, "--key", key)
                deleted += 1
        if not response.get("IsTruncated"):
            break
        token = response.get("NextContinuationToken", "")
        if not token:
            raise RuntimeError("S3 listing was truncated without a continuation token.")
    return deleted


def main() -> int:
    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)
    completed_at: str | None = None
    required_env("SUPABASE_DB_URL")
    required_env("BACKUP_AGE_RECIPIENT")
    required_env("S3_BUCKET")
    required_env("S3_REGION")
    if not os.environ.get("AWS_ACCESS_KEY_ID") or not os.environ.get("AWS_SECRET_ACCESS_KEY"):
        raise RuntimeError("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY credentials are not configured.")

    record_backup_event({
        "event": "started",
        "runId": run_id,
        "startedAt": started_at.isoformat(),
    })

    try:
        bucket = required_env("S3_BUCKET")
        region = required_env("S3_REGION")
        date_key = started_at.strftime("%Y/%m/%d")
        object_key = f"{PREFIX}{date_key}/{run_id}.dump.age"

        with tempfile.TemporaryDirectory(prefix="easpo-backup-") as temporary_directory:
            working = Path(temporary_directory)
            dump_path = working / "easpo.dump"
            encrypted_path = working / "easpo.dump.age"
            downloaded_path = working / "uploaded.dump.age"

            run([
                "pg_dump", "--dbname", required_env("SUPABASE_DB_URL"),
                "--format=custom", "--no-owner", "--no-acl",
                "--file", str(dump_path),
            ])
            if not dump_path.is_file() or dump_path.stat().st_size == 0:
                raise RuntimeError("pg_dump completed without creating a non-empty archive.")
            archive_list = run(["pg_restore", "--list", str(dump_path)], capture=True)
            if "TOC Entries" not in archive_list:
                raise RuntimeError("The PostgreSQL archive did not pass pg_restore validation.")

            run([
                "age", "--encrypt", "--recipient", required_env("BACKUP_AGE_RECIPIENT"),
                "--output", str(encrypted_path), str(dump_path),
            ])
            if not encrypted_path.is_file() or encrypted_path.stat().st_size == 0:
                raise RuntimeError("age completed without creating a non-empty encrypted archive.")

            local_sha256 = sha256_file(encrypted_path)
            size_bytes = encrypted_path.stat().st_size
            destination = f"s3://{bucket}/{object_key}"
            s3_command(
                "s3", "cp", str(encrypted_path), destination,
                "--region", region, "--only-show-errors",
            )
            s3_command(
                "s3", "cp", destination, str(downloaded_path),
                "--region", region, "--only-show-errors",
            )
            remote_sha256 = sha256_file(downloaded_path)
            if remote_sha256 != local_sha256 or downloaded_path.stat().st_size != size_bytes:
                raise RuntimeError("Downloaded object checksum or size does not match the uploaded backup.")

        completed_at = datetime.now(timezone.utc).isoformat()
        record_backup_event({
            "event": "verified",
            "runId": run_id,
            "completedAt": completed_at,
            "objectKey": object_key,
            "sha256": local_sha256,
            "sizeBytes": size_bytes,
        })
        print(f"Backup {run_id} uploaded and checksum-verified ({size_bytes} bytes).")
        try:
            expired = expire_old_objects(
                bucket,
                datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS),
            )
            print(f"Retention cleanup removed {expired} expired object(s).")
        except Exception as cleanup_error:
            print(f"::warning::Retention cleanup failed: {safe_error(cleanup_error)}", file=sys.stderr)
        return 0
    except Exception as error:
        completed_at = datetime.now(timezone.utc).isoformat()
        failure = safe_error(error)
        try:
            record_backup_event({
                "event": "failed",
                "runId": run_id,
                "completedAt": completed_at,
                "result": f"Backup failed: {failure}",
            })
        except Exception as history_error:
            print(f"ERROR: Backup failed and history could not be updated: {safe_error(history_error)}", file=sys.stderr)
        print(f"ERROR: Backup failed: {failure}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {safe_error(error)}", file=sys.stderr)
        raise SystemExit(1)
