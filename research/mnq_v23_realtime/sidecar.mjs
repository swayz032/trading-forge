#!/usr/bin/env node
/**
 * Local-only read-only ProjectX realtime sidecar for MNQ v2.3.
 *
 * Official hub semantics:
 *   user   -> accounts / orders / positions / trades
 *   market -> contract quotes / trades / market depth
 *
 * This process DOES NOT expose or call any order placement endpoint. Its only
 * output is an atomic JSON snapshot consumed by the fail-closed Python broker.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { HubConnectionBuilder, HttpTransportType } from '@microsoft/signalr';

const REMOTE_MARKERS = [
  'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'BUILDKITE', 'JENKINS_URL',
  'CODESPACES', 'RAILWAY_ENVIRONMENT', 'RENDER', 'FLY_APP_NAME', 'DYNO',
  'AWS_EXECUTION_ENV', 'K_SERVICE', 'WEBSITE_INSTANCE_ID'
];

function refuseRemoteRuntime() {
  const hits = REMOTE_MARKERS.filter((k) => String(process.env[k] || '').trim());
  const genericCI = ['1', 'true', 'yes', 'on'].includes(String(process.env.CI || '').toLowerCase());
  if (hits.length || genericCI) {
    throw new Error(`REMOTE_RUNTIME_REFUSE:PROJECTX_REALTIME:${hits.join(',') || 'CI'}`);
  }
}

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`MISSING_ENV:${name}`);
  return value;
}

refuseRemoteRuntime();

const username = required('TOPSTEPX_USERNAME');
const apiKey = required('TOPSTEPX_API_KEY');
const accountId = Number(required('TOPSTEPX_ACCOUNT_ID'));
const contractId = required('MNQ_V23_CONTRACT_ID');
const snapshotPath = path.resolve(process.env.MNQ_V23_REALTIME_SNAPSHOT || './.mnq_v23/realtime.json');
if (!Number.isInteger(accountId) || accountId <= 0) throw new Error('INVALID_ACCOUNT_ID');
if (!contractId.startsWith('CON.F.US.MNQ.')) throw new Error('INVALID_MNQ_CONTRACT_ID');

fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });

const state = {
  schema_version: 1,
  pid: process.pid,
  account_id: accountId,
  contract_id: contractId,
  snapshot_written_utc: null,
  user_hub_connected: false,
  market_hub_connected: false,
  last_user_event_utc: null,
  last_quote_received_utc: null,
  last_trade_received_utc: null,
  quote_payload_timestamp: null,
  best_bid: null,
  best_ask: null,
  last_price: null,
  account: null,
  open_orders: {},
  positions: {},
  last_error: null
};

function isoNow() { return new Date().toISOString(); }

function atomicWrite() {
  state.snapshot_written_utc = isoNow();
  const tmp = `${snapshotPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, snapshotPath);
}

function sanitizeError(err) {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(apiKey, '[REDACTED]').slice(0, 500);
}

async function authenticate() {
  const response = await fetch('https://api.topstepx.com/api/Auth/loginKey', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'text/plain' },
    body: JSON.stringify({ userName: username, apiKey })
  });
  if (!response.ok) throw new Error(`AUTH_HTTP_${response.status}`);
  const data = await response.json();
  if (!data.success || !data.token) throw new Error(`AUTH_REFUSE:${data.errorCode ?? 'unknown'}`);
  return String(data.token);
}

function buildConnection(url, token) {
  return new HubConnectionBuilder()
    .withUrl(url, {
      skipNegotiation: true,
      transport: HttpTransportType.WebSockets,
      accessTokenFactory: () => token,
      timeout: 10000
    })
    .withAutomaticReconnect()
    .build();
}

async function subscribeUser(conn) {
  await conn.invoke('SubscribeAccounts');
  await conn.invoke('SubscribeOrders', accountId);
  await conn.invoke('SubscribePositions', accountId);
  await conn.invoke('SubscribeTrades', accountId);
}

async function subscribeMarket(conn) {
  await conn.invoke('SubscribeContractQuotes', contractId);
  await conn.invoke('SubscribeContractTrades', contractId);
  await conn.invoke('SubscribeContractMarketDepth', contractId);
}

function accountMatches(data) { return Number(data?.id) === accountId; }
function userRecordMatches(data) { return Number(data?.accountId) === accountId; }

async function main() {
  const token = await authenticate();
  const user = buildConnection('https://rtc.topstepx.com/hubs/user', token);
  const market = buildConnection('https://rtc.topstepx.com/hubs/market', token);

  user.on('GatewayUserAccount', (data) => {
    if (!accountMatches(data)) return;
    state.account = data;
    state.last_user_event_utc = isoNow();
    atomicWrite();
  });
  user.on('GatewayUserOrder', (data) => {
    if (!userRecordMatches(data)) return;
    const id = String(data.id);
    // Gateway order statuses can evolve; retaining every latest payload lets the
    // Python side reconcile against REST rather than guessing status semantics.
    state.open_orders[id] = data;
    state.last_user_event_utc = isoNow();
    atomicWrite();
  });
  user.on('GatewayUserPosition', (data) => {
    if (!userRecordMatches(data)) return;
    state.positions[String(data.id)] = data;
    state.last_user_event_utc = isoNow();
    atomicWrite();
  });
  user.on('GatewayUserTrade', (data) => {
    if (!userRecordMatches(data)) return;
    state.last_user_event_utc = isoNow();
    atomicWrite();
  });

  market.on('GatewayQuote', (eventContractId, data) => {
    if (eventContractId !== contractId) return;
    state.best_bid = Number.isFinite(Number(data?.bestBid)) ? Number(data.bestBid) : null;
    state.best_ask = Number.isFinite(Number(data?.bestAsk)) ? Number(data.bestAsk) : null;
    state.last_price = Number.isFinite(Number(data?.lastPrice)) ? Number(data.lastPrice) : null;
    state.quote_payload_timestamp = data?.timestamp || data?.lastUpdated || null;
    state.last_quote_received_utc = isoNow();
    atomicWrite();
  });
  market.on('GatewayTrade', (eventContractId, data) => {
    if (eventContractId !== contractId) return;
    state.last_trade_received_utc = isoNow();
    if (Number.isFinite(Number(data?.price))) state.last_price = Number(data.price);
    atomicWrite();
  });
  market.on('GatewayDepth', (eventContractId, _data) => {
    if (eventContractId !== contractId) return;
    // Depth is subscribed as an independent liveness/data-quality witness. We do
    // not use DOM values in the strategy signal, avoiding a new trading rule.
  });

  user.onreconnecting((err) => {
    state.user_hub_connected = false;
    state.last_error = err ? sanitizeError(err) : 'USER_HUB_RECONNECTING';
    atomicWrite();
  });
  market.onreconnecting((err) => {
    state.market_hub_connected = false;
    state.last_error = err ? sanitizeError(err) : 'MARKET_HUB_RECONNECTING';
    atomicWrite();
  });
  user.onreconnected(async () => {
    try {
      await subscribeUser(user);
      state.user_hub_connected = true;
      state.last_error = null;
    } catch (err) {
      state.user_hub_connected = false;
      state.last_error = sanitizeError(err);
    }
    atomicWrite();
  });
  market.onreconnected(async () => {
    try {
      await subscribeMarket(market);
      state.market_hub_connected = true;
      state.last_error = null;
    } catch (err) {
      state.market_hub_connected = false;
      state.last_error = sanitizeError(err);
    }
    atomicWrite();
  });
  user.onclose((err) => {
    state.user_hub_connected = false;
    state.last_error = err ? sanitizeError(err) : 'USER_HUB_CLOSED';
    atomicWrite();
  });
  market.onclose((err) => {
    state.market_hub_connected = false;
    state.last_error = err ? sanitizeError(err) : 'MARKET_HUB_CLOSED';
    atomicWrite();
  });

  await user.start();
  await subscribeUser(user);
  state.user_hub_connected = true;
  atomicWrite();

  await market.start();
  await subscribeMarket(market);
  state.market_hub_connected = true;
  state.last_error = null;
  atomicWrite();

  const heartbeat = setInterval(atomicWrite, 1000);

  async function shutdown(reason) {
    clearInterval(heartbeat);
    state.user_hub_connected = false;
    state.market_hub_connected = false;
    state.last_error = reason;
    atomicWrite();
    await Promise.allSettled([user.stop(), market.stop()]);
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  state.user_hub_connected = false;
  state.market_hub_connected = false;
  state.last_error = sanitizeError(err);
  try { atomicWrite(); } catch { /* best effort only */ }
  console.error(state.last_error);
  process.exit(1);
});
