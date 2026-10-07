import { describe, it, expect, vi } from "vitest";
import { fetchAllPages } from "./fetchAllPages";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

describe("fetchAllPages", () => {
  it("pages until a short batch and returns all rows", async () => {
    const batches = [rows(1000), rows(1000), rows(5)];
    const page = vi.fn(async () => ({ data: batches.shift() ?? [], error: null }));
    const all = await fetchAllPages(page);
    expect(all).toHaveLength(2005);
    expect(page.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops after the first empty batch", async () => {
    const page = vi.fn(async () => ({ data: [], error: null }));
    expect(await fetchAllPages(page)).toEqual([]);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("treats null data as empty", async () => {
    const page = vi.fn(async () => ({ data: null, error: null }));
    expect(await fetchAllPages(page)).toEqual([]);
  });

  it("rethrows the first error", async () => {
    const boom = new Error("boom");
    const page = vi.fn(async () => ({ data: null, error: boom }));
    await expect(fetchAllPages(page)).rejects.toBe(boom);
  });
});
