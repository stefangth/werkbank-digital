import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  completeAssignment, createVisitReport, fetchAssignment, fetchAssignments, fetchTechnicianOrgs, lockVisitReport, removeVisitPhoto,
  signVisitReport, startAssignment, updateVisitReport, uploadVisitPhoto, visitObjectUrls,
} from "./technicianApp";

const asClient = (fake: unknown) => fake as SupabaseClient<Database>;
const R = (n: string) => `rpc:werkbank.${n}`;

function withStorage(seed: Parameters<typeof createFakeSupabase>[0] = {}, opts: { uploadError?: unknown; removeError?: unknown } = {}) {
  const fake = createFakeSupabase(seed);
  const upload = vi.fn().mockResolvedValue({ data: {}, error: opts.uploadError ?? null });
  const remove = vi.fn().mockResolvedValue({ data: [], error: opts.removeError ?? null });
  const createSignedUrls = vi.fn().mockResolvedValue({
    data: [{ path: "a/b", signedUrl: "https://s/b", error: null }, { path: "a/c", signedUrl: null, error: "x" }], error: null,
  });
  const from = vi.fn(() => ({ upload, remove, createSignedUrls }));
  return { fake, client: asClient({ ...fake, storage: { from } }), upload, remove, createSignedUrls, from };
}

describe("reads", () => {
  it("fetchTechnicianOrgs returns the org ids", async () => {
    const fake = createFakeSupabase({ [R("my_technician_orgs")]: { data: ["o1", "o2"], error: null } });
    expect(await fetchTechnicianOrgs(asClient(fake))).toEqual(["o1", "o2"]);
  });
  it("fetchAssignments passes the org", async () => {
    const fake = createFakeSupabase({ [R("my_assignments")]: { data: [{ id: "x" }], error: null } });
    expect(await fetchAssignments(asClient(fake), "o1")).toEqual([{ id: "x" }]);
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: R("my_assignments"), args: [{ p_org: "o1" }] }));
  });
  it("fetchAssignments returns [] for no data and throws an error", async () => {
    expect(await fetchAssignments(asClient(createFakeSupabase()), "o1")).toEqual([]);
    const error = new Error("x");
    await expect(fetchAssignments(asClient(createFakeSupabase({ [R("my_assignments")]: { data: null, error } })), "o1")).rejects.toBe(error);
  });
  it("fetchAssignment passes the order", async () => {
    const fake = createFakeSupabase({ [R("my_assignment")]: { data: { order: { id: "x" } }, error: null } });
    expect(await fetchAssignment(asClient(fake), "x")).toEqual({ order: { id: "x" } });
    expect(fake.calls).toContainEqual(expect.objectContaining({ table: R("my_assignment"), args: [{ p_order: "x" }] }));
  });
});

describe("rpc writes", () => {
  it("start, complete and lock call their rpcs and throw errors", async () => {
    const fake = createFakeSupabase();
    await startAssignment(asClient(fake), "x");
    await completeAssignment(asClient(fake), "x");
    await lockVisitReport(asClient(fake), "r1");
    expect(fake.calls.map((c) => [c.table, c.args[0]])).toEqual([
      [R("start_assignment"), { p_order: "x" }], [R("complete_assignment"), { p_order: "x" }], [R("lock_visit_report"), { p_report: "r1" }],
    ]);
    const error = new Error("invalid_transition");
    await expect(completeAssignment(asClient(createFakeSupabase({ [R("complete_assignment")]: { data: null, error } })), "x")).rejects.toBe(error);
  });
  it("createVisitReport returns the id, with or without a date", async () => {
    const fake = createFakeSupabase({ [R("create_visit_report")]: { data: "r1", error: null } });
    expect(await createVisitReport(asClient(fake), "x", "2026-10-08")).toBe("r1");
    expect(fake.calls[0].args[0]).toEqual({ p_order: "x", p_visit_date: "2026-10-08" });
    await createVisitReport(asClient(fake), "x");
    expect(fake.calls[1].args[0]).toEqual({ p_order: "x", p_visit_date: undefined });
  });
  it("updateVisitReport passes body and date", async () => {
    const fake = createFakeSupabase();
    await updateVisitReport(asClient(fake), "r1", "text", "2026-10-08");
    expect(fake.calls[0].args[0]).toEqual({ p_report: "r1", p_body: "text", p_visit_date: "2026-10-08" });
  });
});

describe("uploadVisitPhoto", () => {
  const input = { orgId: "o1", orderId: "x", reportId: "r1", file: new Blob(["a"]), caption: "Zähler" };
  it("uploads to <org>/<order>/<report>/<uuid>.jpg without upsert, then registers it", async () => {
    const { client, fake, upload, from } = withStorage({ [R("add_visit_photo")]: { data: "p1", error: null } });
    expect(await uploadVisitPhoto(client, input)).toBe("p1");
    expect(from).toHaveBeenCalledWith("werkbank-visits");
    const [path, , opts] = upload.mock.calls[0];
    expect(path).toMatch(/^o1\/x\/r1\/[0-9a-f-]{36}\.jpg$/);
    expect(opts).toEqual({ contentType: "image/jpeg", upsert: false });
    expect(fake.calls[0].args[0]).toEqual({ p_report: "r1", p_path: path, p_caption: "Zähler" });
  });
  it("does not register when the upload fails", async () => {
    const error = new Error("net");
    const { client, fake } = withStorage({}, { uploadError: error });
    await expect(uploadVisitPhoto(client, input)).rejects.toBe(error);
    expect(fake.calls).toEqual([]);
  });
  it("uses a new path on every attempt", async () => {
    const { client, upload } = withStorage({ [R("add_visit_photo")]: { data: "p1", error: null } });
    await uploadVisitPhoto(client, input);
    await uploadVisitPhoto(client, input);
    expect(upload.mock.calls[0][0]).not.toBe(upload.mock.calls[1][0]);
  });
  it("throws a registration error after removing the unregistered upload", async () => {
    const error = new Error("photo_limit");
    const { client, upload, remove } = withStorage({ [R("add_visit_photo")]: { data: null, error } });
    await expect(uploadVisitPhoto(client, input)).rejects.toBe(error);
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
  });
  it("keeps the registration error when the cleanup fails", async () => {
    const error = new Error("photo_limit");
    const { client, remove } = withStorage({ [R("add_visit_photo")]: { data: null, error } });
    remove.mockRejectedValueOnce(new Error("offline"));
    await expect(uploadVisitPhoto(client, input)).rejects.toBe(error);
  });
});

describe("removeVisitPhoto", () => {
  it("removes the row first, then the returned path", async () => {
    const { client, fake, remove } = withStorage({ [R("remove_visit_photo")]: { data: "o1/x/r1/a.jpg", error: null } });
    await removeVisitPhoto(client, "p1");
    expect(fake.calls[0].args[0]).toEqual({ p_photo: "p1" });
    expect(remove).toHaveBeenCalledWith(["o1/x/r1/a.jpg"]);
  });
  it("ignores a failed object delete", async () => {
    const { client, remove } = withStorage({ [R("remove_visit_photo")]: { data: "o1/x/r1/a.jpg", error: null } });
    remove.mockRejectedValueOnce(new Error("offline"));
    await expect(removeVisitPhoto(client, "p1")).resolves.toBeUndefined();
  });
  it("does not touch storage when the rpc fails", async () => {
    const error = new Error("report_locked");
    const { client, remove } = withStorage({ [R("remove_visit_photo")]: { data: null, error } });
    await expect(removeVisitPhoto(client, "p1")).rejects.toBe(error);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("signVisitReport", () => {
  const input = { orgId: "o1", orderId: "x", reportId: "r1", signerName: "Frau Meier", png: new Blob(["s"]) };
  it("uploads signature.png without upsert, then signs", async () => {
    const { client, fake, upload } = withStorage();
    await signVisitReport(client, input);
    expect(upload).toHaveBeenCalledWith("o1/x/r1/signature.png", input.png, { contentType: "image/png", upsert: false });
    expect(fake.calls[0]).toEqual(expect.objectContaining({
      table: R("sign_visit_report"), args: [{ p_report: "r1", p_signer_name: "Frau Meier", p_signature_path: "o1/x/r1/signature.png" }],
    }));
  });
  it("replaces a stale signature with the fresh drawing, then signs", async () => {
    for (const uploadError of [{ message: "The resource already exists", statusCode: "409" }, { message: "Duplicate", statusCode: 409 }]) {
      const { client, fake, upload, remove } = withStorage();
      upload.mockResolvedValueOnce({ data: null, error: uploadError });
      remove.mockResolvedValueOnce({ data: [{ name: "signature.png" }], error: null });
      await signVisitReport(client, input);
      expect(remove).toHaveBeenCalledWith(["o1/x/r1/signature.png"]);
      expect(upload).toHaveBeenCalledTimes(2);
      expect(fake.calls).toHaveLength(1);
    }
  });
  it("fails as report_locked without signing when the stale signature cannot be removed", async () => {
    const { client, fake } = withStorage({}, { uploadError: { message: "The resource already exists", statusCode: "409" } });
    await expect(signVisitReport(client, input)).rejects.toThrow("report_locked");
    expect(fake.calls).toEqual([]);
  });
  it("rethrows other upload errors without signing", async () => {
    const error = { message: "Payload too large", statusCode: "413" };
    const { client, fake } = withStorage({}, { uploadError: error });
    await expect(signVisitReport(client, input)).rejects.toBe(error);
    expect(fake.calls).toEqual([]);
  });
  it("throws a signing error", async () => {
    const error = new Error("report_locked");
    const { client } = withStorage({ [R("sign_visit_report")]: { data: null, error } });
    await expect(signVisitReport(client, input)).rejects.toBe(error);
  });
});

describe("visitObjectUrls", () => {
  it("maps paths to signed urls valid for 300 seconds and skips failed entries", async () => {
    const { client, createSignedUrls } = withStorage();
    expect(await visitObjectUrls(client, ["a/b", "a/c"])).toEqual({ "a/b": "https://s/b" });
    expect(createSignedUrls).toHaveBeenCalledWith(["a/b", "a/c"], 300);
  });
  it("makes no request for no paths", async () => {
    const { client, from } = withStorage();
    expect(await visitObjectUrls(client, [])).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });
});
