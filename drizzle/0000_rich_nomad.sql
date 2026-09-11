CREATE TABLE `scan_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scan_leases_expiry` ON `scan_leases` (`expires`);--> statement-breakpoint
CREATE TABLE `scan_quotas` (
	`bucket` text PRIMARY KEY NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scan_quotas_expiry` ON `scan_quotas` (`expires`);