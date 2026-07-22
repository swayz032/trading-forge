/**
 * Duplicate-aware cookie reader for the OPS-owned Slumhouse surfaces.
 *
 * WHY THIS EXISTS
 * The historical idiom `header.match(/(?:^|;\s*)NAME=([^;]+)/)` is a NON-GLOBAL
 * match, so it returns the FIRST occurrence of NAME. RFC 6265 does not forbid a
 * `Cookie:` header from carrying the same name twice, so a request of the form
 *     Cookie: slumhouse_sid=FORGED; slumhouse_sid=LEGIT
 * makes each of those call sites read FORGED — a forged value placed first beats
 * the legitimate one. (Defence-in-depth: reaching this needs a SEPARATE
 * cookie-injection primitive to place the forged cookie first; on its own it
 * changes nothing. This is hardening, not a live hole.)
 *
 * POLICY — reject on duplicate (fail closed)
 * If NAME appears more than once we treat the request as malformed and return
 * null. A duplicate cookie name is never something a legitimate client sends
 * here, so rejecting it costs nothing real and — unlike "first wins" or a silent
 * "last wins" — leaves no ambiguity about which value was trusted. Which
 * duplicate wins is a security decision, not a detail, so it is made explicit.
 *
 * It also fails closed on a value that is not valid percent-encoding, so a
 * garbage / oversized cookie can no longer throw out of a call site, and returns
 * the DECODED value so callers need no decodeURIComponent of their own.
 *
 * The header is parsed in FULL — split on ';', trim each pair, match the name
 * EXACTLY, and split the value on the FIRST '=' only (cookie values legitimately
 * contain '=', e.g. base64 / signature payloads) — never a single non-global
 * regex.
 *
 * Any same-name pair counts toward the duplicate check, including one with an
 * empty value: `NAME=; NAME=x` is rejected. A single empty-valued cookie yields
 * "" (as absent as null for every caller here — each treats a falsy/invalid
 * token as no cookie).
 */
export function readSlumhouseCookie(
  header: string | undefined | null,
  name: string,
): string | null {
  if (!header) return null;

  let found: string | null = null;
  for (const part of header.split(";")) {
    const pair = part.trim();
    const eq = pair.indexOf("=");
    if (eq <= 0) continue; // no '=', or an empty cookie name
    if (pair.slice(0, eq) !== name) continue;
    if (found !== null) return null; // duplicate same-name cookie -> fail closed
    found = pair.slice(eq + 1);
  }

  if (found === null) return null;

  try {
    return decodeURIComponent(found);
  } catch {
    return null; // malformed percent-encoding -> fail closed
  }
}
