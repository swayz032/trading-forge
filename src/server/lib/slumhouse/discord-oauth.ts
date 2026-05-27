/**
 * Discord OAuth 2.0 helpers for the Slumhouse portal.
 *
 * Pure functions, no DB writes. Caller passes the returned access token to
 * fetchDiscordUser; the resulting Discord user ID is then looked up against
 * slumhouse_users for the session-cookie mint.
 */

const TOKEN_URL = "https://discord.com/api/oauth2/token";
const USER_URL = "https://discord.com/api/users/@me";

export async function exchangeCodeForToken(code: string): Promise<string> {
  const clientId = required("DISCORD_CLIENT_ID");
  const clientSecret = required("DISCORD_CLIENT_SECRET");
  const redirectUri = required("DISCORD_REDIRECT_URI");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`discord_oauth_token_exchange_failed: ${res.status} ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("discord_oauth_no_access_token");
  return json.access_token;
}

export interface DiscordUser {
  id: string;
  username: string;
  displayName: string;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch(USER_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`discord_oauth_user_fetch_failed: ${res.status}`);
  const raw = (await res.json()) as { id: string; username: string; global_name?: string | null };
  return {
    id: raw.id,
    username: raw.username,
    displayName: raw.global_name || raw.username,
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing_env:${name}`);
  return v;
}
