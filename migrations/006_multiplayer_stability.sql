ALTER TABLE rooms
  ADD COLUMN create_request_key VARCHAR(80) NULL AFTER invite_hash,
  ADD COLUMN revision BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER settings_json,
  ADD UNIQUE KEY uq_rooms_host_request (host_user_id, create_request_key);

ALTER TABLE games ADD COLUMN revision BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER day_number;

ALTER TABLE chat_messages
  ADD COLUMN sequence_no BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE AFTER message,
  ADD COLUMN idempotency_key VARCHAR(80) NULL AFTER sequence_no,
  ADD UNIQUE KEY uq_chat_idempotency (room_id, sender_user_id, idempotency_key),
  ADD KEY ix_chat_room_sequence (room_id, channel, sequence_no);

ALTER TABLE game_events
  ADD COLUMN sequence_no BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE AFTER public_message,
  ADD KEY ix_game_events_sequence (game_id, sequence_no);
