ALTER TABLE games MODIFY current_phase ENUM('role_reveal','night','day','voting') NOT NULL DEFAULT 'role_reveal';
ALTER TABLE games MODIFY winner_team ENUM('town','mafia','solo') NULL;
ALTER TABLE game_players MODIFY role ENUM('civilian','mafia','don','sheriff','doctor','detective','jailor','prostitute','vagabond','maniac') NOT NULL;
ALTER TABLE game_players MODIFY team ENUM('town','mafia','solo') NOT NULL;
ALTER TABLE game_actions MODIFY action_type ENUM('mafia_kill','maniac_kill','investigate','protect','detain','block','observe','vote','abstain') NOT NULL;
ALTER TABLE match_history MODIFY role ENUM('civilian','mafia','don','sheriff','doctor','detective','jailor','prostitute','vagabond','maniac') NOT NULL;
ALTER TABLE match_history MODIFY team ENUM('town','mafia','solo') NOT NULL;
CREATE TABLE IF NOT EXISTS game_events (
  id CHAR(36) PRIMARY KEY,
  game_id CHAR(36) NOT NULL,
  day_number SMALLINT UNSIGNED NOT NULL,
  phase ENUM('role_reveal','night','day','voting') NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  public_message VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_game_events_timeline (game_id, created_at),
  CONSTRAINT fk_game_events_game FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS game_role_results (
  id CHAR(36) PRIMARY KEY,
  game_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  day_number SMALLINT UNSIGNED NOT NULL,
  result_type ENUM('investigation','observation') NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_game_role_result (game_id,user_id,day_number,result_type),
  CONSTRAINT fk_role_result_game FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_result_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
