INSERT INTO "regions" ("id", "slug", "name") VALUES
	('f1ee7000-0000-4000-8000-000000000001', 'sa', 'South America'),
	('f1ee7000-0000-4000-8000-000000000002', 'na', 'North America'),
	('f1ee7000-0000-4000-8000-000000000003', 'eu', 'Europe'),
	('f1ee7000-0000-4000-8000-000000000004', 'as', 'Asia'),
	('f1ee7000-0000-4000-8000-000000000005', 'af', 'Africa')
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "exit_nodes" ("id", "region_id", "label", "endpoint", "control_url", "public_key", "tunnel_cidr", "credential_ref", "last_seen_at") VALUES
	('f1ee7000-0000-4000-8000-000000000011', 'f1ee7000-0000-4000-8000-000000000001', 'sa-01', '127.0.0.1:21820', 'http://127.0.0.1:21821', 'rKCjjZR5cgoZSG0BE1Cjs5wHcOAOYU5Vweb/Gj0rPWg=', '10.13.13.0/24', 'poc-vpn/exit-node/sa', now()),
	('f1ee7000-0000-4000-8000-000000000012', 'f1ee7000-0000-4000-8000-000000000002', 'na-01', '127.0.0.1:21830', 'http://127.0.0.1:21831', 'l9q1kct/2KO4JeXyFdwLgv0hjmSAlKtx4IphTAyPDlk=', '10.13.14.0/24', 'poc-vpn/exit-node/na', now()),
	('f1ee7000-0000-4000-8000-000000000013', 'f1ee7000-0000-4000-8000-000000000003', 'eu-01', '127.0.0.1:21840', 'http://127.0.0.1:21841', '6WeATIWyV+4hSkrG+IeOjkptYhWMXiMKCvgKME63wm0=', '10.13.15.0/24', 'poc-vpn/exit-node/eu', now()),
	('f1ee7000-0000-4000-8000-000000000014', 'f1ee7000-0000-4000-8000-000000000004', 'as-01', '127.0.0.1:21850', 'http://127.0.0.1:21851', 'ERBj22MetQp6YlY0nyaJ9v14aze22A9w2GKU8IPTTXI=', '10.13.16.0/24', 'poc-vpn/exit-node/as', now()),
	('f1ee7000-0000-4000-8000-000000000015', 'f1ee7000-0000-4000-8000-000000000005', 'af-01', '127.0.0.1:21860', 'http://127.0.0.1:21861', 'wB8vw5IyH2ifpbQuW0rcRjZSY4dTV3ZO2M5x1mMSVDk=', '10.13.17.0/24', 'poc-vpn/exit-node/af', now())
ON CONFLICT ("public_key") DO NOTHING;
