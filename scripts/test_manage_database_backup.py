import importlib.util
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("manage_database_backup.py")
SPEC = importlib.util.spec_from_file_location("manage_database_backup", MODULE_PATH)
manage_database_backup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(manage_database_backup)


class ManageDatabaseBackupTests(unittest.TestCase):
    DATABASE_URL = "postgresql://dbuser:p%40ss%3Aword@db.example.test:5432/postgres?sslmode=require"

    def test_connection_url_is_passed_to_postgres_tools_without_url_or_password_arguments(self):
        environment = manage_database_backup.database_environment(self.DATABASE_URL)
        self.assertEqual(environment["PGHOST"], "db.example.test")
        self.assertEqual(environment["PGPORT"], "5432")
        self.assertEqual(environment["PGDATABASE"], "postgres")
        self.assertEqual(environment["PGUSER"], "dbuser")
        self.assertEqual(environment["PGPASSWORD"], "p@ss:word")
        self.assertNotIn("SUPABASE_DB_URL", environment)

    def test_backup_is_full_sql_named_by_time_and_retains_only_seven(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            old_backups = []
            for day in range(1, 8):
                path = directory / f"easp_backup_2026-11-{day:02d}_09-00-AM.sql"
                path.write_bytes(b"-- PostgreSQL database dump\n")
                os.utime(path, (day, day))
                old_backups.append(path)
            unrelated = directory / "other.sql"
            unrelated.write_text("keep", encoding="utf-8")
            timestamp = datetime(2026, 11, 13, 9, 0, tzinfo=timezone.utc)

            def fake_run(command, environment):
                output = Path(command[command.index("--file") + 1])
                output.write_bytes(b"-- PostgreSQL database dump\n-- full SQL\n")

            with patch.object(manage_database_backup, "run_command", side_effect=fake_run) as run:
                result = manage_database_backup.create_backup(
                    directory,
                    self.DATABASE_URL,
                    timestamp,
                )

            command = run.call_args.args[0]
            self.assertEqual(result.name, "easp_backup_2026-11-13_09-00-AM.sql")
            self.assertIn("--clean", command)
            self.assertIn("--if-exists", command)
            self.assertNotIn("--schema", command)
            self.assertNotIn("--exclude-table", command)
            backups = [
                path for path in directory.iterdir()
                if manage_database_backup.BACKUP_NAME_PATTERN.fullmatch(path.name)
            ]
            self.assertEqual(len(backups), 7)
            self.assertFalse(old_backups[0].exists())
            self.assertTrue(unrelated.exists())

    def test_backup_does_not_overwrite_a_backup_created_in_the_same_minute(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            existing = directory / "easp_backup_2026-11-13_09-00-AM.sql"
            existing.write_text("previous backup", encoding="utf-8")

            def fake_run(command, environment):
                Path(command[command.index("--file") + 1]).write_bytes(
                    b"-- PostgreSQL database dump\n-- new backup\n"
                )

            with patch.object(manage_database_backup, "run_command", side_effect=fake_run):
                result = manage_database_backup.create_backup(
                    directory,
                    self.DATABASE_URL,
                    datetime(2026, 11, 13, 9, 0, tzinfo=timezone.utc),
                )

            self.assertEqual(result.name, "easp_backup_2026-11-13_09-00-AM-2.sql")
            self.assertEqual(existing.read_text(encoding="utf-8"), "previous backup")

    def test_restore_requires_exact_confirmation_and_runs_full_transactional_sql(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            backup = directory / "easp_backup_2026-11-13_09-00-AM.sql"
            backup.write_bytes(b"-- PostgreSQL database dump\n-- archived rows included\n")
            messages = []
            with patch.object(manage_database_backup, "run_command") as run:
                restored = manage_database_backup.restore_backup(
                    backup,
                    directory,
                    self.DATABASE_URL,
                    input_fn=lambda _: manage_database_backup.RESTORE_CONFIRMATION,
                    print_fn=messages.append,
                )

            self.assertTrue(restored)
            self.assertEqual(messages[0], manage_database_backup.RESTORE_CONFIRMATION)
            command = run.call_args.args[0]
            self.assertEqual(command[0], "psql")
            self.assertIn("--single-transaction", command)
            self.assertIn("--set=ON_ERROR_STOP=1", command)
            self.assertIn("--file", command)

    def test_restore_cancelled_or_unrecognized_file_never_runs_psql(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            backup = directory / "easp_backup_2026-11-13_09-00-AM.sql"
            backup.write_bytes(b"-- PostgreSQL database dump\n")
            with patch.object(manage_database_backup, "run_command") as run:
                restored = manage_database_backup.restore_backup(
                    backup,
                    directory,
                    self.DATABASE_URL,
                    input_fn=lambda _: "yes",
                    print_fn=lambda _: None,
                )
                self.assertFalse(restored)
                run.assert_not_called()

            unrelated = directory / "unrelated.sql"
            unrelated.write_bytes(b"-- PostgreSQL database dump\n")
            with self.assertRaisesRegex(RuntimeError, "recognized EASPO"):
                manage_database_backup.validate_backup_file(unrelated, directory)
            with self.assertRaisesRegex(RuntimeError, "could not be found"):
                manage_database_backup.validate_backup_file(directory / "missing.sql", directory)


if __name__ == "__main__":
    unittest.main()
