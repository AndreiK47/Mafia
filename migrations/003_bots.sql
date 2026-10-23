ALTER TABLE users ADD COLUMN is_bot BOOLEAN NOT NULL DEFAULT FALSE AFTER account_status;
CREATE INDEX ix_users_bot ON users (is_bot, account_status);
