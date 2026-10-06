import { json, preflight } from "../_shared/http.ts";
import { type Deps, realDeps } from "../_shared/deps.ts";
import { mintInvitationActionLink } from "../_shared/invitations.ts";
import { brandForKind } from "../_shared/brand.ts";
import { resolveOrgKind } from "../_shared/orgKind.ts";

const COOLDOWN_SECONDS = 60;

type Body = { token?: unknown; app_origin?: unknown };
type Claim = { status?: unknown; email?: unknown; claimed_at?: unknown; retry_after_seconds?: unknown };

async function releaseFailedClaim(
  deps: Deps,
  token: string,
  claimedAt: string,
): Promise<void> {
  try {
    const { error } = await deps.admin
      .from("org_invitations")
      .update({ last_auth_exchange_at: null })
      .eq("token", token)
      .eq("last_auth_exchange_at", claimedAt);
    if (error) throw error;
  } catch {
    console.error("exchange-invitation: failed claim could not be released");
  }
}

/**
 * The inviting org's brand key, so the accept-invite page can render under it before
 * sign-in. Best effort and silent: any failure omits the brand and the exchange still
 * succeeds, and nothing about the lookup ever reaches an error response.
 */
async function brandKeyForInvitation(deps: Deps, token: string): Promise<string | undefined> {
  try {
    const { data, error } = await deps.admin
      .from("org_invitations")
      .select("org_id")
      .eq("token", token)
      .maybeSingle();
    const orgId = (data as { org_id?: unknown } | null)?.org_id;
    if (error || typeof orgId !== "string" || !orgId) return undefined;
    return brandForKind(await resolveOrgKind(deps.admin, orgId)).key;
  } catch {
    return undefined;
  }
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") {
    const response = json({ error: "Method not allowed" }, 405);
    response.headers.set("Allow", "POST, OPTIONS");
    return response;
  }

  try {
    const body = await req.json().catch(() => null) as Body | null;
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const appOrigin = typeof body?.app_origin === "string" ? body.app_origin.trim() : "";
    if (!token || !appOrigin) return json({ error: "Invalid payload" }, 400);

    const { data, error } = await deps.admin.rpc("claim_invitation_auth_exchange", {
      p_token: token,
      p_cooldown_seconds: COOLDOWN_SECONDS,
    });
    if (error) {
      console.error("exchange-invitation: claim failed");
      return json({ error: "Internal error" }, 500);
    }

    const claim = data as Claim | null;
    if (claim?.status === "unavailable") {
      return json({ error: "Invitation unavailable" }, 410);
    }
    if (claim?.status === "throttled") {
      const rawRetry = typeof claim.retry_after_seconds === "number" ? claim.retry_after_seconds : 1;
      const retryAfterSeconds = Math.max(1, Math.ceil(rawRetry));
      const response = json({
        error: "Please wait before trying again",
        retry_after_seconds: retryAfterSeconds,
      }, 429);
      response.headers.set("Retry-After", String(retryAfterSeconds));
      return response;
    }
    if (
      claim?.status !== "ok" || typeof claim.email !== "string" || !claim.email.trim() ||
      typeof claim.claimed_at !== "string" || !claim.claimed_at
    ) {
      console.error("exchange-invitation: invalid claim result");
      return json({ error: "Internal error" }, 500);
    }

    let actionUrl: string;
    try {
      actionUrl = await mintInvitationActionLink(deps, { email: claim.email, appOrigin });
    } catch {
      await releaseFailedClaim(deps, token, claim.claimed_at);
      console.error("exchange-invitation: action link mint failed");
      return json({ error: "Internal error" }, 500);
    }
    if (!actionUrl) {
      await releaseFailedClaim(deps, token, claim.claimed_at);
      console.error("exchange-invitation: action link mint failed");
      return json({ error: "Internal error" }, 500);
    }
    const brand = await brandKeyForInvitation(deps, token);
    return json(brand ? { action_url: actionUrl, brand } : { action_url: actionUrl });
  } catch {
    console.error("exchange-invitation: unexpected failure");
    return json({ error: "Internal error" }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
