ALTER TABLE games MODIFY current_phase ENUM('role_reveal','night','day','voting','verdict') NOT NULL DEFAULT 'role_reveal';
ALTER TABLE games ADD COLUMN verdict_target_user_id CHAR(36) NULL AFTER winner_team;
ALTER TABLE game_events MODIFY phase ENUM('role_reveal','night','day','voting','verdict') NOT NULL;
CREATE TABLE IF NOT EXISTS game_verdict_votes (
  id CHAR(36) PRIMARY KEY,
  game_id CHAR(36) NOT NULL,
  day_number SMALLINT UNSIGNED NOT NULL,
  voter_user_id CHAR(36) NOT NULL,
  accused_user_id CHAR(36) NOT NULL,
  convict BOOLEAN NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_verdict_vote (game_id, day_number, voter_user_id),
  KEY ix_verdict_accused (game_id, day_number, accused_user_id),
  CONSTRAINT fk_verdict_game FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  CONSTRAINT fk_verdict_voter FOREIGN KEY (voter_user_id) REFERENCES users(id),
  CONSTRAINT fk_verdict_accused FOREIGN KEY (accused_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
