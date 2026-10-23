CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  username VARCHAR(24) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar VARCHAR(32) NOT NULL DEFAULT 'A',
  account_status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NULL,
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  KEY ix_users_status (account_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  csrf_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  UNIQUE KEY uq_sessions_token (token_hash),
  KEY ix_sessions_user_expiry (user_id, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rooms (
  id CHAR(36) PRIMARY KEY,
  room_code VARCHAR(24) NOT NULL,
  name VARCHAR(40) NOT NULL,
  host_user_id CHAR(36) NOT NULL,
  visibility ENUM('public','private') NOT NULL DEFAULT 'public',
  game_mode ENUM('classic','custom') NOT NULL DEFAULT 'classic',
  language VARCHAR(8) NOT NULL DEFAULT 'EN',
  max_players TINYINT UNSIGNED NOT NULL,
  status ENUM('waiting','starting','in_progress','closed') NOT NULL DEFAULT 'waiting',
  invite_hash CHAR(64) NULL,
  settings_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_rooms_code (room_code),
  KEY ix_rooms_discovery (visibility, status, game_mode, created_at),
  KEY ix_rooms_host (host_user_id),
  CONSTRAINT fk_rooms_host FOREIGN KEY (host_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS room_members (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  membership_status ENUM('active','left') NOT NULL DEFAULT 'active',
  is_ready BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  left_at DATETIME(3) NULL,
  UNIQUE KEY uq_room_member (room_id, user_id),
  KEY ix_members_user_active (user_id, membership_status),
  KEY ix_members_room_active (room_id, membership_status),
  CONSTRAINT fk_members_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS games (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  game_number INT UNSIGNED NOT NULL,
  status ENUM('in_progress','completed','cancelled') NOT NULL DEFAULT 'in_progress',
  current_phase ENUM('day','night','voting') NOT NULL DEFAULT 'day',
  day_number SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  phase_started_at DATETIME(3) NOT NULL,
  phase_ends_at DATETIME(3) NOT NULL,
  winner_team ENUM('town','mafia') NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at DATETIME(3) NULL,
  UNIQUE KEY uq_room_game_no (room_id, game_number),
  KEY ix_games_deadline (status, phase_ends_at),
  CONSTRAINT fk_games_room FOREIGN KEY (room_id) REFERENCES rooms(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS game_players (
  id CHAR(36) PRIMARY KEY,
  game_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  seat_number TINYINT UNSIGNED NOT NULL,
  role ENUM('civilian','mafia','don','sheriff','doctor','detective','jailor') NOT NULL,
  team ENUM('town','mafia') NOT NULL,
  player_status ENUM('alive','eliminated','disconnected') NOT NULL DEFAULT 'alive',
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  eliminated_at DATETIME(3) NULL,
  UNIQUE KEY uq_game_player (game_id, user_id),
  UNIQUE KEY uq_game_seat (game_id, seat_number),
  KEY ix_game_players_alive (game_id, player_status),
  CONSTRAINT fk_game_players_game FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  CONSTRAINT fk_game_players_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS game_actions (
  id CHAR(36) PRIMARY KEY,
  game_id CHAR(36) NOT NULL,
  day_number SMALLINT UNSIGNED NOT NULL,
  phase ENUM('day','night','voting') NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  action_type ENUM('mafia_kill','investigate','protect','detain','vote','abstain') NOT NULL,
  target_user_id CHAR(36) NULL,
  action_status ENUM('submitted','resolved','cancelled') NOT NULL DEFAULT 'submitted',
  idempotency_key VARCHAR(80) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_action_idempotency (game_id, actor_user_id, idempotency_key),
  KEY ix_actions_resolution (game_id, day_number, phase, action_status),
  CONSTRAINT fk_actions_game FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  CONSTRAINT fk_actions_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT fk_actions_target FOREIGN KEY (target_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS votes (
  id CHAR(36) PRIMARY KEY,
  game_id CHAR(36) NOT NULL,
  day_number SMALLINT UNSIGNED NOT NULL,
  voter_user_id CHAR(36) NOT NULL,
  target_user_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_vote_per_day (game_id, day_number, voter_user_id),
  KEY ix_votes_target (game_id, day_number, target_user_id),
  CONSTRAINT fk_votes_game FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_voter FOREIGN KEY (voter_user_id) REFERENCES users(id),
  CONSTRAINT fk_votes_target FOREIGN KEY (target_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  game_id CHAR(36) NULL,
  sender_user_id CHAR(36) NOT NULL,
  channel ENUM('room','day','mafia') NOT NULL,
  message VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_chat_room_time (room_id, channel, created_at),
  KEY ix_chat_game_time (game_id, created_at),
  CONSTRAINT fk_chat_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_game FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL,
  CONSTRAINT fk_chat_sender FOREIGN KEY (sender_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS match_history (
  id CHAR(36) PRIMARY KEY,
  game_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role ENUM('civilian','mafia','don','sheriff','doctor','detective','jailor') NOT NULL,
  team ENUM('town','mafia') NOT NULL,
  result ENUM('win','loss') NOT NULL,
  statistics_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_history_game_user (game_id, user_id),
  KEY ix_history_user_time (user_id, created_at),
  CONSTRAINT fk_history_game FOREIGN KEY (game_id) REFERENCES games(id),
  CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(80) PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key CHAR(64) PRIMARY KEY,
  window_start DATETIME(3) NOT NULL,
  hits INT UNSIGNED NOT NULL DEFAULT 0,
  KEY ix_rate_limit_expiry (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
