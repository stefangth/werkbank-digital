import { preflight, json } from "../_shared/http.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { ensureInvitedAccount, formatExpiresOn, resolveArtistOffersExpected, sendOrgInvitationEmail, SYSTEM_INVITER_NAME } from "../_shared/invitations.ts";
import { resolveInviteRoleLabel } from "../_shared/roles.ts";
import { resolveOrgSetting } from "../_shared/settings.ts";
import { FEATURE_KEYS, FEATURE_REGISTRY, type FeatureKey } from "../_shared/entitlements.ts";
import { BOOKING_FLOW_TEMPLATE_DEFAULTS, normalizeBookingFlowTemplates } from "../_shared/bookingFlow.ts";
import type { Json } from "../_shared/database.types.ts";
import { isOrgKind, DEFAULT_ORG_KIND, type OrgKind } from "../_shared/orgKind.ts";
import { MODULE_PROVISIONING, type ProvisioningDefaults } from "../_shared/modules.ts";
import { resolveEmailCopy, type EmailCopyOverride } from "../_shared/transactional-email-templates/_shell/emailCopy.ts";

type Body = {
  name: string;
  slug: string;
  admin_email: string;
  role?: "admin" | "producer" | "artist";
  app_origin: string;
  entitlements?: Record<string, boolean>;
  org_kind?: string;
};

/**
 * Resolve the entitlement to seed per feature. Precedence: the kind's provisioning
 * defaults, then an explicit request (non-boolean values are ignored), then the platform
 * value. Features are taken from `platform`, which the caller fills for every feature.
 */
/** Best-effort seeding steps that can fail without undoing the org; reported to the caller. */
export type ProvisioningWarning = "entitlements" | "booking_flow" | "kind_settings";

export function mergeEntitlements(
  platform: Record<FeatureKey, boolean>,
  requested: Record<string, boolean> | null,
  kindDefaults: Partial<Record<FeatureKey, boolean>> | undefined,
): Record<FeatureKey, boolean> {
  const merged = {} as Record<FeatureKey, boolean>;
  for (const feature of Object.keys(platform) as FeatureKey[]) {
    const fromKind = kindDefaults?.[feature];
    const fromRequest = requested?.[feature];
    merged[feature] = typeof fromKind === "boolean"
      ? fromKind
      : typeof fromRequest === "boolean" ? fromRequest : platform[feature];
  }
  return merged;
}

/**
 * The "Invited by" name on a new org's first invitation. A kind may seed its own
 * `email_copy` (provisioning defaults); its `org-invitation.inviterFallback` then names the
 * sender, so the invite reads under that kind's brand. Without one this is exactly
 * SYSTEM_INVITER_NAME.
 */
export function firstInviterName(kindDefaults: ProvisioningDefaults | undefined): string {
  const seeded = kindDefaults?.settings.email_copy;
  if (typeof seeded !== "object" || seeded === null || Array.isArray(seeded)) return SYSTEM_INVITER_NAME;
  return resolveEmailCopy(seeded as EmailCopyOverride)["org-invitation.inviterFallback"];
}

export async function handle(
  req: Request,
  deps: Deps,
  provisioning: Partial<Record<OrgKind, ProvisioningDefaults>> = MODULE_PROVISIONING,
): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const auth = await requireSuperAdmin(deps, req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as Body | null;
    const name = body?.name?.trim();
    const slug = body?.slug?.trim().toLowerCase();
    const email = body?.admin_email?.trim().toLowerCase();
    const role = body?.role ?? "admin";
    const appOrigin = body?.app_origin?.replace(/\/$/, "");
    if (!name || !slug || !email || !appOrigin) return json({ error: "Invalid payload" }, 400);
    if (!["admin", "producer", "artist"].includes(role)) return json({ error: "Invalid role" }, 400);
    const orgKind = body?.org_kind ?? DEFAULT_ORG_KIND;
    if (!isOrgKind(orgKind)) return json({ error: "Invalid workspace type" }, 400);

    // Atomic DB work runs as the caller (auth.uid() = the super-admin) so provision_org's
    // internal is_super_admin check passes; SECURITY DEFINER does the privileged inserts.
    const authHeader = req.headers.get("Authorization")!;
    const { data, error } = await deps.userClient(authHeader)
      .rpc("provision_org", { p_name: name, p_slug: slug, p_admin_email: email, p_role: role, p_org_kind: orgKind });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return json({ error: "That slug is already taken" }, 409);
      return json({ error: (error as Error).message ?? "Could not provision org" }, 500);
    }
    const { org_id, token } = data as { org_id: string; token: string };

    // Seed org_entitlements. An explicit `entitlements` body from the picker wins per
    // feature (validated against FEATURE_KEYS — unknown keys are ignored); any feature it
    // omits falls back to the platform default_entitlements setting (falls back in turn to
    // each feature's registry default when that platform setting is unset). Best-effort: a
    // seeding failure must not undo the org that was just created, so log and continue —
    // same resilience posture as the invite delivery below.
    const kindDefaults = provisioning[orgKind];
    // Seeding stays best effort, but the caller learns which defaults are missing so a
    // super-admin can fix them instead of an org silently starting with the wrong setup.
    const warnings: ProvisioningWarning[] = [];
    try {
      const fallbackDefaults = Object.fromEntries(
        FEATURE_KEYS.map((key) => [key, FEATURE_REGISTRY[key].defaultEnabled]),
      ) as Record<FeatureKey, boolean>;
      const defaultEntitlements = await resolveOrgSetting<Record<FeatureKey, boolean>>(
        deps.admin, null, "default_entitlements", fallbackDefaults,
      );
      const platformEntitlements = Object.fromEntries(
        FEATURE_KEYS.map((feature) => [feature, defaultEntitlements[feature] ?? FEATURE_REGISTRY[feature].defaultEnabled]),
      ) as Record<FeatureKey, boolean>;
      const entitlements = mergeEntitlements(platformEntitlements, body?.entitlements ?? null, kindDefaults?.entitlements);
      const entitlementRows = FEATURE_KEYS.map((feature) => ({ org_id, feature, enabled: entitlements[feature] }));
      const { error: entitlementsError } = await deps.admin.from("org_entitlements").insert(entitlementRows);
      if (entitlementsError) {
        console.error("provision-org: entitlement seeding failed", entitlementsError.message);
        warnings.push("entitlements");
      }

      // Land every new organization's booking_flow in the "off" state so it doesn't start
      // dispatching offers before someone configures it. Best-effort, same posture as above.
      // Only seed the off-flow row if the entitlement insert actually landed — otherwise the
      // two writes could disagree (an off flow row for an org whose entitlements never wrote).
      if (!entitlementsError && !kindDefaults?.skipBookingFlowSeed) {
        try {
          const templates = normalizeBookingFlowTemplates(await resolveOrgSetting(
            deps.admin, null, "booking_flow_templates", BOOKING_FLOW_TEMPLATE_DEFAULTS,
          ));
          const off = templates.off;
          const { error: flowErr } = await deps.admin.from("app_settings")
            .upsert([
              { org_id, key: "booking_flow", value: off.flow as unknown as Json },
              { org_id, key: "booking_flow_template", value: "off" as unknown as Json },
              { org_id, key: "offer_response_window_hours", value: off.times.windowHours as unknown as Json },
              { org_id, key: "offer_digest_hour_berlin", value: off.times.offerDigestHour as unknown as Json },
              { org_id, key: "confirmation_digest_hour_berlin", value: off.times.confirmationDigestHour as unknown as Json },
            ], { onConflict: "org_id,key" });
          if (flowErr) {
            console.error("provision-org: off-flow seed failed", flowErr.message);
            warnings.push("booking_flow");
          }
        } catch (e) {
          console.error("provision-org: off-flow seed failed", (e as Error).message);
          warnings.push("booking_flow");
        }
      }
    } catch (e) {
      console.error("provision-org: entitlement seeding failed", (e as Error).message);
      if (!warnings.includes("entitlements")) warnings.push("entitlements");
    }

    // The kind's own app_settings defaults. Independent of the entitlement seeding above so
    // a transient failure there cannot leave a kind org without its defaults; runs after
    // the booking-flow seed so a kind's settings win. Best-effort, same posture as above.
    const kindSettings = Object.entries(kindDefaults?.settings ?? {});
    if (kindSettings.length > 0) {
      try {
        const { error: settingsErr } = await deps.admin.from("app_settings")
          .upsert(kindSettings.map(([key, value]) => ({ org_id, key, value })), { onConflict: "org_id,key" });
        if (settingsErr) {
          console.error("provision-org: kind settings seed failed", settingsErr.message);
          warnings.push("kind_settings");
        }
      } catch (e) {
        console.error("provision-org: kind settings seed failed", (e as Error).message);
        warnings.push("kind_settings");
      }
    }

    // Resolve the invitation id created inside provision_org (it returns only {org_id, token}),
    // then create the first-admin's account + membership NOW, before the branded email.
    // Best-effort/logged: the org + invitation already exist and claim_my_invitations
    // self-heals on the admin's first sign-in, so a link failure must not undo the org.
    try {
      const { data: invRow } = await deps.admin
        .from("org_invitations").select("id, expires_at").eq("token", token).maybeSingle();
      const invitationId = (invRow as { id?: string } | null)?.id;
      const { userId } = await ensureInvitedAccount(deps, { email, appOrigin });
      if (invitationId && userId) {
        const { error: memErr } = await deps.admin.rpc("ensure_invitation_membership", {
          p_invitation: invitationId, p_user: userId,
        });
        if (memErr) console.error("provision-org: membership link failed", (memErr as { message?: string }).message);
      }
      // The durable invitation email contains no short-lived Auth action link. The first
      // admin of a brand-new org is a total stranger to the super-admin
      // provisioning it, so "Invited by" always reads a generic, org-neutral line here
      // (the platform team, or the kind's brand when its defaults seed one, firstInviterName):
      // never the platform operator's own display name or personal inbox address. A
      // stranger has no more context for "Jordan Owner" than for owner@platform.test,
      // so forwarding either would read as no more trustworthy than a spam sender's,
      // not less anonymous. This is DIFFERENT from create-invitation/resend-invitation,
      // which do resolve and forward a real name (falling back to email): their inviter
      // is a colleague within the SAME org the recipient is already joining, where an
      // intra-org name or address reads as legitimate. There is nothing to resolve here
      // (no profiles read, no Admin API call), so there is also no failure mode to
      // guard against.
      // Only relevant when the first invitee is an artist (role defaults to 'admin' and
      // usually is, but the Body type does allow 'artist'). resolveArtistOffersExpected
      // reads the org's booking_flow live (including the offFlow seed just written
      // above, when it landed), so a fresh org still starting in the "off" preset
      // correctly resolves to false rather than the module's usual defaults; it also
      // already fails closed to false on any error, so no extra .catch is needed here.
      const offersExpected = role === "artist"
        ? await resolveArtistOffersExpected(deps.admin, org_id)
        : undefined;
      await sendOrgInvitationEmail(deps, {
        email, orgName: name, role: await resolveInviteRoleLabel(deps.admin, org_id, role), roleKey: role, token,
        inviterName: firstInviterName(kindDefaults),
        expiresOn: formatExpiresOn((invRow as { expires_at?: string } | null)?.expires_at),
        offersExpected,
        appOrigin, idempotencyKey: `org-invitation-${org_id}`, orgId: org_id,
      });
    } catch (e) {
      console.error("provision-org: invite delivery failed", (e as Error).message);
    }

    return json(warnings.length > 0 ? { org_id, warnings } : { org_id });
  } catch (e) {
    console.error("provision-org error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
