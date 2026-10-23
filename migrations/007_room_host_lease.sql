ALTER TABLE room_members
  ADD COLUMN last_seen_at DATETIME(3) NULL AFTER joined_at,
  ADD KEY ix_room_members_presence (room_id, last_seen_at);

UPDATE room_members
SET last_seen_at = UTC_TIMESTAMP(3)
WHERE membership_status = 'active';
