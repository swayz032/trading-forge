-- Fix: Remove "Forge Forge" (awkward) and add 33 new codenames to reach 200 total

-- Remove "Forge Forge"
DELETE FROM strategy_names WHERE codename = 'Forge' AND claimed = false;

-- Add new codenames (ON CONFLICT DO NOTHING for idempotency)
INSERT INTO strategy_names (id, codename, full_name, claimed, retired, created_at)
VALUES
    (gen_random_uuid(), 'Bulwark', 'Forge Bulwark', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Corsair', 'Forge Corsair', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Defiant', 'Forge Defiant', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Flint', 'Forge Flint', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Gambit', 'Forge Gambit', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Harpoon', 'Forge Harpoon', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Ignite', 'Forge Ignite', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Jackal', 'Forge Jackal', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Kestrel', 'Forge Kestrel', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Longbow', 'Forge Longbow', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Maelstrom', 'Forge Maelstrom', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Napalm', 'Forge Napalm', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Oblivion', 'Forge Oblivion', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Paladin', 'Forge Paladin', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Rampart', 'Forge Rampart', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Scythe', 'Forge Scythe', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Torrent', 'Forge Torrent', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Vanguard', 'Forge Vanguard', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Wolverine', 'Forge Wolverine', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Arsenal', 'Forge Arsenal', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Blackout', 'Forge Blackout', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Cyclone', 'Forge Cyclone', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Dragoon', 'Forge Dragoon', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Enforcer', 'Forge Enforcer', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Fortress', 'Forge Fortress', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Gryphon', 'Forge Gryphon', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Hound', 'Forge Hound', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Invictus', 'Forge Invictus', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Jager', 'Forge Jager', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Kodiak', 'Forge Kodiak', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Leviathan', 'Forge Leviathan', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Mustang', 'Forge Mustang', FALSE, FALSE, NOW()),
    (gen_random_uuid(), 'Onager', 'Forge Onager', FALSE, FALSE, NOW())
ON CONFLICT (codename) DO NOTHING;
