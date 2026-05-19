/**
 * Forge Names — Codename pool + claim logic for strategy naming.
 *
 * Every strategy that reaches TIER_1 gets a "Forge {Codename}" name.
 * Names are unique, never recycled after retirement.
 */

export const FORGE_CODENAME_POOL = [
  // Original 19 (mapped to existing strategies)
  "Viper", "Phantom", "Tide", "Raid", "Apex", "Serpent", "Shadow",
  "Fracture", "Thrust", "Origin", "Atlas", "Judas", "Shield",
  "Unicorn", "Mirror", "Sniper", "Pulse", "Trigger", "Quake",
  // Extended pool (181 more = 200 total)
  "Falcon", "Havoc", "Eclipse", "Bolt", "Drift", "Fang",
  "Cipher", "Onyx", "Prism", "Vertex", "Nova", "Storm",
  "Razor", "Ember", "Wraith", "Halo", "Torque", "Flux",
  "Zenith", "Spectre", "Aegis", "Blitz", "Chrono", "Delta",
  "Edge", "Flare", "Granite", "Hydra", "Ion", "Jolt",
  "Krypton", "Lancer", "Mammoth", "Nexus", "Orion", "Pike",
  "Raven", "Saber", "Talon", "Ultra", "Vector", "Warden",
  "Anvil", "Bravo", "Cobalt", "Dagger", "Epoch",
  "Glyph", "Hawk", "Inferno", "Javelin", "Karma", "Lynx",
  "Mantis", "Nimbus", "Obsidian", "Patriot", "Quasar", "Raptor",
  "Sigma", "Tempest", "Umbra", "Venom", "Wolf", "Xenon",
  "Yeti", "Zephyr", "Archer", "Bandit", "Centurion", "Draco",
  "Electra", "Fury", "Goliath", "Hermes", "Impulse", "Jinx",
  "Knight", "Legion", "Mirage", "Nomad", "Omega", "Phoenix",
  "Quantum", "Ronin", "Sentinel", "Titan", "Valor", "Warlock",
  "Axion", "Bastion", "Condor", "Dynamo", "Everest", "Frost",
  "Griffin", "Horizon", "Icarus", "Jet", "Kinetic", "Lumen",
  "Mercury", "Neptune", "Oxide", "Pinnacle", "Radiant", "Stealth",
  "Thunder", "Uppercut", "Vortex", "Wildfire", "Xylo", "Yukon",
  "Zero", "Alpha", "Barrage", "Catalyst", "Dispatch", "Enigma",
  "Firebolt", "Garrison", "Huntsman", "Isotope", "Joker", "Kraken",
  "Latitude", "Monsoon", "Nitro", "Outpost", "Piston", "Riptide",
  "Summit", "Trident", "Uprising", "Vigil", "Wyvern", "Zodiac",
  "Armada", "Blaze", "Crusader", "Domino", "Exodus", "Foxhound",
  "Gladiator", "Harbor", "Iron", "Juggernaut", "Keystone",
  // Fill to 200 total
  "Bulwark", "Corsair", "Defiant", "Flint", "Gambit",
  "Harpoon", "Ignite", "Jackal", "Kestrel", "Longbow",
  "Maelstrom", "Napalm", "Oblivion", "Paladin", "Rampart",
  "Scythe", "Torrent", "Vanguard", "Wolverine", "Arsenal",
  "Blackout", "Cyclone", "Dragoon", "Enforcer", "Fortress",
  "Gryphon", "Hound", "Invictus", "Jager", "Kodiak",
  "Leviathan", "Mustang", "Onager",
] as const;

export type ForgeCodename = (typeof FORGE_CODENAME_POOL)[number];

/**
 * Generate the seed SQL for the strategy_names table.
 * Used by migration 0019.
 */
export function generateSeedSQL(): string {
  const values = FORGE_CODENAME_POOL.map(
    (name) => `(gen_random_uuid(), '${name}', 'Forge ${name}', FALSE, FALSE, NOW())`
  ).join(",\n    ");

  return `INSERT INTO strategy_names (id, codename, full_name, claimed, retired, created_at)
  VALUES
    ${values}
  ON CONFLICT (codename) DO NOTHING;`;
}
