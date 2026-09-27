CREATE TABLE `login_attempts` (
	`ip_hash` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attempts_reset_idx` ON `login_attempts` (`reset_at`);--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`digest` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `vault` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`envelope` text NOT NULL
);
