ALTER TABLE game_actions MODIFY action_type ENUM('mafia_kill','maniac_kill','investigate','sheriff_shoot','protect','detain','block','observe','vote','abstain') NOT NULL;
