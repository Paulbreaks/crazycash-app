-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `account_type` ENUM('guest', 'telegram') NOT NULL DEFAULT 'guest',
    `telegram_id` BIGINT NULL,
    `telegram_photo_url` VARCHAR(2048) NULL,
    `guest_expires_at` DATETIME(3) NULL,
    `email` VARCHAR(255) NULL,
    `username` VARCHAR(64) NULL,
    `password_hash` VARCHAR(255) NULL,
    `fun_balance` BIGINT NOT NULL DEFAULT 1000,
    `real_balance` BIGINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_users_uuid`(`uuid`),
    UNIQUE INDEX `uq_users_telegram_id`(`telegram_id`),
    UNIQUE INDEX `uq_users_email`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_operations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `type` ENUM('fun_credit_claim', 'ton_deposit', 'ton_withdrawal') NOT NULL,
    `idempotency_key` VARCHAR(128) NOT NULL,
    `request_fingerprint` CHAR(64) NOT NULL,
    `status` ENUM('completed', 'rejected', 'processing', 'failed') NOT NULL,
    `error_code` VARCHAR(64) NULL,
    `result` JSON NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_client_operations_uuid`(`uuid`),
    INDEX `ix_client_operations_user_id_created_at`(`user_id`, `created_at`),
    INDEX `ix_client_operations_status_created_at`(`status`, `created_at`),
    UNIQUE INDEX `uq_client_operations_user_id_type_idempotency_key`(`user_id`, `type`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_statistics` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `source_user_uuid` CHAR(36) NOT NULL,
    `account_type` ENUM('guest', 'telegram') NOT NULL,
    `telegram_id` BIGINT NULL,
    `first_ip` VARCHAR(45) NULL,
    `first_seen_at` DATETIME(3) NOT NULL,
    `last_seen_at` DATETIME(3) NOT NULL,
    `guest_deleted_at` DATETIME(3) NULL,
    `fun_spins_count` BIGINT NOT NULL DEFAULT 0,
    `fun_wagered` BIGINT NOT NULL DEFAULT 0,
    `fun_payout` BIGINT NOT NULL DEFAULT 0,
    `real_spins_count` BIGINT NOT NULL DEFAULT 0,
    `real_wagered` BIGINT NOT NULL DEFAULT 0,
    `real_payout` BIGINT NOT NULL DEFAULT 0,
    `last_fun_spin_at` DATETIME(3) NULL,
    `last_real_spin_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_player_statistics_source_user_uuid`(`source_user_uuid`),
    INDEX `ix_player_statistics_account_type_first_seen_at`(`account_type`, `first_seen_at`),
    INDEX `ix_player_statistics_telegram_id`(`telegram_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_sessions_uuid`(`uuid`),
    UNIQUE INDEX `uq_sessions_token_hash`(`token_hash`),
    INDEX `ix_sessions_user_id_expires_at`(`user_id`, `expires_at`),
    INDEX `ix_sessions_expires_at`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `raw_address` VARCHAR(80) NOT NULL,
    `public_key` CHAR(64) NOT NULL,
    `network` ENUM('testnet', 'mainnet') NOT NULL,
    `verified_at` DATETIME(3) NOT NULL,
    `disconnected_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_wallets_uuid`(`uuid`),
    UNIQUE INDEX `uq_wallets_raw_address`(`raw_address`),
    INDEX `ix_wallets_user_id_verified_at`(`user_id`, `verified_at`),
    UNIQUE INDEX `uq_wallets_user_id_network`(`user_id`, `network`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ton_proof_challenges` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `payload` CHAR(64) NOT NULL,
    `session_id` BIGINT NOT NULL,
    `user_id` INTEGER NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_ton_proof_challenges_payload`(`payload`),
    INDEX `ix_ton_proof_challenges_session_id_expires_at`(`session_id`, `expires_at`),
    INDEX `ix_ton_proof_challenges_expires_at`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_entries` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `kind` ENUM('deposit_credit', 'spin_bet', 'spin_payout', 'withdrawal_hold', 'withdrawal_release') NOT NULL,
    `amount` BIGINT NOT NULL,
    `balance_after` BIGINT NOT NULL,
    `idempotency_key` VARCHAR(128) NULL,
    `reference_uuid` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_ledger_entries_uuid`(`uuid`),
    INDEX `ix_ledger_entries_user_id_created_at`(`user_id`, `created_at`),
    UNIQUE INDEX `uq_ledger_entries_user_id_idempotency_key`(`user_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deposits` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `wallet_id` BIGINT NOT NULL,
    `client_operation_id` BIGINT NULL,
    `network` ENUM('testnet', 'mainnet') NOT NULL,
    `expected_amount` BIGINT NOT NULL,
    `received_amount` BIGINT NULL,
    `status` ENUM('pending', 'observed', 'credited', 'expired', 'rejected') NOT NULL DEFAULT 'pending',
    `transaction_hash` VARCHAR(128) NULL,
    `transaction_lt` VARCHAR(32) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `observed_at` DATETIME(3) NULL,
    `credited_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_deposits_uuid`(`uuid`),
    UNIQUE INDEX `uq_deposits_client_operation_id`(`client_operation_id`),
    INDEX `ix_deposits_user_id_created_at`(`user_id`, `created_at`),
    INDEX `ix_deposits_status_expires_at`(`status`, `expires_at`),
    UNIQUE INDEX `uq_deposits_network_transaction_hash_lt`(`network`, `transaction_hash`, `transaction_lt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ton_chain_checkpoints` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `network` ENUM('testnet', 'mainnet') NOT NULL,
    `recipient_address` VARCHAR(80) NOT NULL,
    `transaction_hash` VARCHAR(128) NULL,
    `transaction_lt` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_ton_chain_checkpoints_network_recipient`(`network`, `recipient_address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `withdrawals` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `wallet_id` BIGINT NOT NULL,
    `network` ENUM('testnet', 'mainnet') NOT NULL,
    `amount` BIGINT NOT NULL,
    `status` ENUM('requested', 'held', 'sent', 'finalized', 'failed', 'cancelled') NOT NULL DEFAULT 'requested',
    `idempotency_key` VARCHAR(128) NOT NULL,
    `transaction_hash` VARCHAR(128) NULL,
    `transaction_lt` VARCHAR(32) NULL,
    `held_at` DATETIME(3) NULL,
    `observed_at` DATETIME(3) NULL,
    `finalized_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_withdrawals_uuid`(`uuid`),
    INDEX `ix_withdrawals_user_id_created_at`(`user_id`, `created_at`),
    INDEX `ix_withdrawals_status_created_at`(`status`, `created_at`),
    UNIQUE INDEX `uq_withdrawals_user_id_idempotency_key`(`user_id`, `idempotency_key`),
    UNIQUE INDEX `uq_withdrawals_network_transaction_hash_lt`(`network`, `transaction_hash`, `transaction_lt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fun_spins` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `request_id` VARCHAR(128) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `bet` BIGINT NOT NULL,
    `combination` CHAR(3) NOT NULL,
    `rule` VARCHAR(64) NOT NULL,
    `multiplier` SMALLINT UNSIGNED NOT NULL,
    `payout` BIGINT NOT NULL,
    `balance_after` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_fun_spins_uuid`(`uuid`),
    INDEX `ix_fun_spins_user_id_created_at`(`user_id`, `created_at`),
    UNIQUE INDEX `uq_fun_spins_user_id_request_id`(`user_id`, `request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `real_spins` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `request_id` VARCHAR(128) NOT NULL,
    `denomination` VARCHAR(4) NOT NULL DEFAULT '0.01',
    `user_id` INTEGER NOT NULL,
    `bet` BIGINT NOT NULL,
    `combination` CHAR(3) NOT NULL,
    `rule` VARCHAR(64) NOT NULL,
    `multiplier` SMALLINT UNSIGNED NOT NULL,
    `payout` BIGINT NOT NULL,
    `balance_after` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_real_spins_uuid`(`uuid`),
    INDEX `ix_real_spins_user_id_created_at`(`user_id`, `created_at`),
    UNIQUE INDEX `uq_real_spins_user_id_request_id`(`user_id`, `request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `client_operations` ADD CONSTRAINT `fk_client_operations_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `fk_sessions_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `wallets` ADD CONSTRAINT `fk_wallets_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ton_proof_challenges` ADD CONSTRAINT `fk_ton_proof_challenges_session_id` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ton_proof_challenges` ADD CONSTRAINT `fk_ton_proof_challenges_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ledger_entries` ADD CONSTRAINT `fk_ledger_entries_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `deposits` ADD CONSTRAINT `fk_deposits_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `deposits` ADD CONSTRAINT `fk_deposits_wallet_id` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `deposits` ADD CONSTRAINT `fk_deposits_client_operation_id` FOREIGN KEY (`client_operation_id`) REFERENCES `client_operations`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `withdrawals` ADD CONSTRAINT `fk_withdrawals_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `withdrawals` ADD CONSTRAINT `fk_withdrawals_wallet_id` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `fun_spins` ADD CONSTRAINT `fk_fun_spins_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `real_spins` ADD CONSTRAINT `fk_real_spins_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
