/**
 * StreakFit Push Worker — Cloudflare Workers
 *
 * Environment variables (set via `wrangler secret put`):
 *   VAPID_PUBLIC   — base64url public key (from web-push generate-vapid-keys)
 *   VAPID_PRIVATE  — base64url private key
 *   VAPID_SUBJECT  — your email, e.g. you@gmail.com
 *
 * KV binding: KV  (namespace created with `wrangler kv:namespace create STREAKFIT_PUSH`)
 *
 * Cron: "* * * * *"  (every minute — checks and fires due reminders)
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ─── base64url helpers ────────────────────────────────────────────────────────
const b64uEncode = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

const b64uDecode = (str) => {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
};

// ─── HMAC-SHA-256 wrappers ────────────────────────────────────────────────────
async function hmac(keyBytes, data) {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

// HKDF-Extract: HMAC(salt, ikm)
const hkdfExtract = (salt, ikm) => hmac(salt, ikm);

// HKDF-Expand (single 32-byte block): HMAC(prk, info || 0x01).slice(0, len)
async function hkdfExpand(prk, info, len) {
  const infoBytes = typeof info === "string" ? new TextEncoder().encode(info) : info;
  const input = new Uint8Array([...infoBytes, 0x01]);
  return (await hmac(prk, input)).slice(0, len);
}

// ─── VAPID JWT (ES256) ────────────────────────────────────────────────────────
async function importVapidPrivateKey(privateB64u, publicB64u) {
  const pub = b64uDecode(publicB64u); // 65-byte uncompressed point
  const jwk = {
    kty: "EC", crv: "P-256",
    d: privateB64u,
    x: b64uEncode(pub.slice(1, 33)),
    y: b64uEncode(pub.slice(33, 65)),
    key_ops: ["sign"],
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function makeVapidJWT(audience, env) {
  const enc = (obj) => b64uEncode(new TextEncoder().encode(JSON.stringify(obj)));
  const header  = enc({ typ: "JWT", alg: "ES256" });
  const payload = enc({ aud: audience, exp: Math.floor(Date.now() / 1000) + 43200, sub: `mailto:${env.VAPID_SUBJECT}` });
  const unsigned = `${header}.${payload}`;
  const key = await importVapidPrivateKey(env.VAPID_PRIVATE, env.VAPID_PUBLIC);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64uEncode(sig)}`;
}

// ─── Web Push payload encryption (RFC 8291 + RFC 8188 aes128gcm) ─────────────
async function encryptPush(subscription, payload) {
  const uaPublicBytes = b64uDecode(subscription.keys.p256dh); // 65-byte uncompressed P-256
  const uaAuth        = b64uDecode(subscription.keys.auth);   // 16-byte auth secret
  const plaintext     = new TextEncoder().encode(JSON.stringify(payload));

  // Ephemeral server ECDH key pair
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));

  // ECDH shared secret
  const uaKey = await crypto.subtle.importKey("raw", uaPublicBytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhBits = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, ephemeral.privateKey, 256));

  // RFC 8291 IKM derivation
  // prk = HKDF-Extract(salt=ua_auth, IKM=ecdh_secret)
  const prk1 = await hkdfExtract(uaAuth, ecdhBits);
  // key_info = "WebPush: info" || 0x00 || ua_public || as_public
  const keyInfo = new Uint8Array([...new TextEncoder().encode("WebPush: info\0"), ...uaPublicBytes, ...asPublicBytes]);
  // ikm = HKDF-Expand(prk, key_info, 32)
  const ikm = await hkdfExpand(prk1, keyInfo, 32);

  // RFC 8188 aes128gcm
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk2 = await hkdfExtract(salt, ikm);
  const cek   = await hkdfExpand(prk2, "Content-Encoding: aes128gcm\0", 16);
  const nonce = await hkdfExpand(prk2, "Content-Encoding: nonce\0", 12);

  // AES-128-GCM encrypt (append 0x02 = final-record delimiter)
  const cekKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = new Uint8Array([...plaintext, 0x02]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, padded));

  // aes128gcm content-encoding header: salt(16) + rs(4) + idlen(1) + keyid
  const header = new Uint8Array(21 + asPublicBytes.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false); // record size
  header[20] = asPublicBytes.length;                       // idlen = 65
  header.set(asPublicBytes, 21);

  return new Uint8Array([...header, ...ciphertext]);
}

// ─── Send one push ────────────────────────────────────────────────────────────
async function sendPush(env, subscription, notification) {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await makeVapidJWT(audience, env);

  let body, contentType, contentEncoding;
  try {
    const encrypted = await encryptPush(subscription, notification);
    body = encrypted;
    contentType = "application/octet-stream";
    contentEncoding = "aes128gcm";
  } catch (e) {
    // Fallback: push without payload (SW will show a default message)
    body = null;
    contentType = "text/plain";
    contentEncoding = null;
  }

  const headers = {
    Authorization: `vapid t=${jwt},k=${env.VAPID_PUBLIC}`,
    "Content-Type": contentType,
    TTL: "86400",
    Urgency: "normal",
  };
  if (contentEncoding) headers["Content-Encoding"] = contentEncoding;

  const res = await fetch(subscription.endpoint, { method: "POST", headers, body });
  if (res.status === 410 || res.status === 404) return "expired";
  return res.ok ? "ok" : `error:${res.status}`;
}

// ─── Cron: check all subscriptions and fire due reminders ────────────────────
async function checkAndFire(env) {
  const utcNow = new Date();
  const { keys } = await env.KV.list({ prefix: "sub:" });

  await Promise.all(keys.map(async ({ name }) => {
    const raw = await env.KV.get(name);
    if (!raw) return;
    const { subscription, reminders = [], tzOffset = 0 } = JSON.parse(raw);

    // Convert UTC time to device's local time using stored offset
    const localNow  = new Date(utcNow.getTime() + tzOffset * 60000);
    const localTime = `${String(localNow.getUTCHours()).padStart(2, "0")}:${String(localNow.getUTCMinutes()).padStart(2, "0")}`;
    const localDate = localNow.toISOString().slice(0, 10);

    for (const r of reminders) {
      if (!r.enabled || r.time !== localTime) continue;

      const firedKey = `fired:${localDate}:${name}:${r.id}`;
      if (await env.KV.get(firedKey)) continue; // already fired today

      const result = await sendPush(env, subscription, { title: "StreakFit", body: r.label, tag: r.id });

      if (result === "expired") {
        await env.KV.delete(name);
      } else if (result === "ok") {
        await env.KV.put(firedKey, "1", { expirationTtl: 172800 }); // expire after 2 days
      }
    }
  }));
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────
async function handleSubscribe(request, env) {
  const { deviceId, subscription, reminders, tzOffset } = await request.json();
  if (!deviceId || !subscription?.endpoint) {
    return new Response("Bad request", { status: 400, headers: CORS });
  }
  await env.KV.put(`sub:${deviceId}`, JSON.stringify({ subscription, reminders, tzOffset }));
  return new Response("OK", { headers: CORS });
}

async function handleTestPush(request, env) {
  const { deviceId } = await request.json();
  const raw = await env.KV.get(`sub:${deviceId}`);
  if (!raw) return new Response("No subscription found for this device.", { status: 404, headers: CORS });
  const { subscription } = JSON.parse(raw);
  const result = await sendPush(env, subscription, { title: "StreakFit", body: "🔔 Test — background notifications work!" });
  return new Response(result, { headers: CORS });
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const { pathname } = new URL(request.url);

    if (pathname === "/vapid-public")
      return new Response(env.VAPID_PUBLIC, { headers: { ...CORS, "Content-Type": "text/plain" } });

    if (pathname === "/subscribe" && request.method === "POST")
      return handleSubscribe(request, env);

    if (pathname === "/test-push" && request.method === "POST")
      return handleTestPush(request, env);

    return new Response("StreakFit Push Worker is running.", { headers: CORS });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(checkAndFire(env));
  },
};
