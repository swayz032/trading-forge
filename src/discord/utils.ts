import { EmbedBuilder } from "discord.js";

const FORGE_FOOTER = "Trading Forge";

/**
 * Fetch wrapper for the Trading Forge API.
 * Returns parsed JSON or throws with a descriptive message.
 */
export async function fetchForge<T = any>(
  baseUrl: string,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const apiKey = process.env.API_KEY;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Standard error embed (red, with timestamp and footer).
 */
export function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Error")
    .setDescription(message)
    .setColor(0xff0000)
    .setTimestamp()
    .setFooter({ text: FORGE_FOOTER });
}

/**
 * Map a status string to a Discord embed colour.
 */
export function statusColor(status: string): number {
  const s = status.toLowerCase();
  if (["healthy", "fresh", "approved", "trade", "success", "promote", "green"].includes(s))
    return 0x00ff00; // green
  if (["critical", "blocked", "skip", "kill", "stale", "red", "unhealthy"].includes(s))
    return 0xff0000; // red
  if (["warning", "reduce", "revise", "orange", "degraded"].includes(s))
    return 0xffa500; // orange
  return 0x00bfff; // blue (info / default)
}

/**
 * Safely truncate a string for embed fields (Discord max 1024).
 */
export function truncate(str: string, max = 1024): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}

/**
 * Build a consistent info embed with green/blue styling.
 */
export function infoEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x00bfff)
    .setTimestamp()
    .setFooter({ text: FORGE_FOOTER });
  if (description) embed.setDescription(description);
  return embed;
}
