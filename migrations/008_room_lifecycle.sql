ALTER TABLE games
  ADD COLUMN room_game_mode ENUM('classic','custom') NULL AFTER room_id,
  ADD COLUMN room_max_players TINYINT UNSIGNED NULL AFTER room_game_mode,
  ADD COLUMN room_settings_json JSON NULL AFTER room_max_players;

UPDATE games g
JOIN rooms r ON r.id = g.room_id
SET g.room_game_mode = r.game_mode,
    g.room_max_players = r.max_players,
    g.room_settings_json = r.settings_json;

ALTER TABLE games
  MODIFY room_id CHAR(36) NULL,
  MODIFY room_game_mode ENUM('classic','custom') NOT NULL,
  MODIFY room_max_players TINYINT UNSIGNED NOT NULL,
  MODIFY room_settings_json JSON NOT NULL,
  DROP FOREIGN KEY fk_games_room;

ALTER TABLE games
  ADD CONSTRAINT fk_games_room_lifecycle FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;
