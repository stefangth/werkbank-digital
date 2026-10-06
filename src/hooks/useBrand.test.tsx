import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuthContext, type AuthContextType } from "@/features/auth/AuthContext";
import type { OrgKind } from "@/lib/orgKind";
import { anOrganization } from "@/test/fixtures";
import { useBrand } from "./useBrand";

// A plugin kind mapped to a test brand. The brand arrives through the manifest exactly as a
// real module's would; the kind is added on top of the real registry because the global test
// setup has already loaded orgKind.ts (with the empty manifest) before this mock registers.
// Everything else stays real.
vi.mock("@/lib/orgKind", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orgKind")>();
  return {
    ...actual,
    ORG_KIND_DEFS: { ...actual.ORG_KIND_DEFS, test_kind: { ...actual.ORG_KIND_DEFS.production, kind: "test_kind", brand: "test_brand" } },
  };
});
vi.mock("@/modules/registry", () => ({
  MODULE_ORG_KINDS: [],
  MODULE_BRANDS: [
    {
      key: "test_brand",
      name: "Test Brand",
      markSvgPath: "/brand/test.svg",
      emailMarkPath: "/email/test-mark.png",
      faviconPath: "/brand/test-favicon.svg",
      appUrl: null,
      hosts: [],
      defaultFrom: null,
    },
  ],
}));

const HINT_KEY = "showflow.brandHint.v1";

function authValue(org: ReturnType<typeof anOrganization> | null): AuthContextType {
  return { currentOrg: org, user: org ? { id: "u1" } : null } as unknown as AuthContextType;
}

function wrapperFor(org: ReturnType<typeof anOrganization> | null) {
  return ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={authValue(org)}>{children}</AuthContext.Provider>
  );
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useBrand", () => {
  it("signed in: the org kind decides", () => {
    const { result } = renderHook(() => useBrand(), { wrapper: wrapperFor(anOrganization({ org_kind: "production" })) });
    expect(result.current.key).toBe("showflow");
  });

  it("re-renders with a new brand when currentOrg changes to a module kind", () => {
    let org = anOrganization({ org_kind: "production" });
    const { result, rerender } = renderHook(() => useBrand(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AuthContext.Provider value={authValue(org)}>{children}</AuthContext.Provider>
      ),
    });
    expect(result.current.name).toBe("ShowFlow");
    org = anOrganization({ org_kind: "test_kind" as unknown as OrgKind });
    rerender();
    expect(result.current.key).toBe("test_brand");
    expect(result.current.name).toBe("Test Brand");
  });

  it("signed out: the stored hint decides", () => {
    sessionStorage.setItem(HINT_KEY, "test_brand");
    const { result } = renderHook(() => useBrand(), { wrapper: wrapperFor(null) });
    expect(result.current.key).toBe("test_brand");
  });

  it("signed out without a hint: falls back to the hostname, then showflow", () => {
    const { result } = renderHook(() => useBrand(), { wrapper: wrapperFor(null) });
    expect(result.current.key).toBe("showflow");
  });

  it("an unknown hint is ignored", () => {
    sessionStorage.setItem(HINT_KEY, "nope");
    const { result } = renderHook(() => useBrand(), { wrapper: wrapperFor(null) });
    expect(result.current.key).toBe("showflow");
  });

  it("survives a throwing sessionStorage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useBrand(), { wrapper: wrapperFor(null) });
    expect(result.current.key).toBe("showflow");
  });

  it("works without an AuthProvider (pre-auth screens)", () => {
    const { result } = renderHook(() => useBrand());
    expect(result.current.key).toBe("showflow");
  });
});
