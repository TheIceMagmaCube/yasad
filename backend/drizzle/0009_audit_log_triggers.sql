-- The audit log is append-only: no update, and no delete of an entry younger than 30 days, so a wrong
-- retention setting or a faulty purge cannot erase recent history.
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `audit_log`
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `audit_log_keep_recent` BEFORE DELETE ON `audit_log`
WHEN old.`at` > unixepoch() * 1000 - 30 * 86400000
BEGIN
  SELECT RAISE(ABORT, 'audit_log entries are kept 30 days at least');
END;
