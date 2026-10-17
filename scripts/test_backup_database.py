import importlib.util
import json
import os
import unittest
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("backup_database.py")
SPEC = importlib.util.spec_from_file_location("backup_database", MODULE_PATH)
backup_database = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backup_database)


class BackupDatabaseTests(unittest.TestCase):
    def test_sha256_file_reads_content_in_chunks(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "backup.age"
            path.write_bytes(b"easpo backup")
            self.assertEqual(
                backup_database.sha256_file(path),
                "a45d9320346e4a7b982b5bdb03b334688cd18f809abca9d26018c12a3c772e50",
            )

    def test_safe_error_redacts_connection_and_runner_secrets(self):
        with patch.dict(os.environ, {
            "SUPABASE_DB_URL": "postgresql://db:private-password@example.test/db",
            "BACKUP_RUNNER_SECRET": "runner-private-secret",
            "AWS_ACCESS_KEY_ID": "access-private",
            "AWS_SECRET_ACCESS_KEY": "secret-private",
        }, clear=True):
            message = backup_database.safe_error(RuntimeError(
                "db=postgresql://db:private-password@example.test/db "
                "runner=runner-private-secret access=access-private secret=secret-private",
            ))
        self.assertNotIn("private-password", message)
        self.assertNotIn("runner-private-secret", message)
        self.assertNotIn("access-private", message)
        self.assertNotIn("secret-private", message)
        self.assertEqual(message.count("[redacted]"), 4)

    def test_retention_deletes_only_expired_objects_under_backup_prefix(self):
        listing = {
            "Contents": [
                {"Key": "backups/easpo-db/old.dump.age", "LastModified": "2026-08-01T00:00:00Z"},
                {"Key": "backups/easpo-db/new.dump.age", "LastModified": "2026-10-10T00:00:00Z"},
                {"Key": "other/old.dump.age", "LastModified": "2026-08-01T00:00:00Z"},
            ],
            "IsTruncated": False,
        }
        with patch.object(backup_database, "s3_command", return_value=json.dumps(listing)) as command:
            removed = backup_database.expire_old_objects(
                "private-bucket",
                datetime(2026, 10, 1, tzinfo=timezone.utc),
            )
        self.assertEqual(removed, 1)
        command.assert_any_call(
            "s3api", "delete-object", "--bucket", "private-bucket",
            "--key", "backups/easpo-db/old.dump.age",
        )
        self.assertEqual(command.call_count, 2)


if __name__ == "__main__":
    unittest.main()
