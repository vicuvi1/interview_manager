/** Raw-fetch Google OAuth 2.0 (authorization-code, offline). No SDK. Server-only. */
import {
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
} from "@/lib/google/config";

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
  scope?: string;
}

export function buildAuthUrl(state: string, redirect: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirect,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on re-consent
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCode(code: string, redirect: string): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store",
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error_description || json?.error || `Token exchange failed (${res.status})`);
  return json as GoogleTokens;
}

/** Returns null if the refresh token is invalid/revoked (invalid_grant), so callers can disable the account. */
export async function refreshToken(refresh: string): Promise<GoogleTokens | null> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store",
    body: new URLSearchParams({
      refresh_token: refresh,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json?.error === "invalid_grant") return null; // revoked / expired — caller disables the account
    throw new Error(json?.error_description || json?.error || `Token refresh failed (${res.status})`);
  }
  return json as GoogleTokens;
}

/** Decode the email + sub from a Google id_token (JWT) without verifying signature (issued directly by Google over TLS). */
export function decodeIdToken(idToken: string): { sub?: string; email?: string } {
  try {
    const payload = idToken.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return { sub: json.sub, email: json.email };
  } catch {
    return {};
  }
}

/** Fallback identity fetch if the id_token is absent. */
export async function fetchUserInfo(accessToken: string): Promise<{ sub?: string; email?: string }> {
  try {
    const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return {};
    return { sub: json.sub, email: json.email };
  } catch {
    return {};
  }
}
