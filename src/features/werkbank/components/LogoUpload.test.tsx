import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { LogoUpload } from "./LogoUpload";

const upload = vi.fn();
const createSignedUrl = vi.fn();

function renderUpload(onChange = vi.fn(), value = "") {
  Object.assign(client, { storage: { from: () => ({ upload, createSignedUrl }) } });
  renderWithProviders(<LogoUpload value={value} onChange={onChange} />, {
    authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never },
  });
  return onChange;
}

function pick(file: File) {
  fireEvent.change(screen.getByLabelText("Logo"), { target: { files: [file] } });
}

const fileOf = (name: string, type: string, size: number) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("LogoUpload", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    upload.mockResolvedValue({ error: null });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed/logo" }, error: null });
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("rejects a 2 MB file", async () => {
    const onChange = renderUpload();
    pick(fileOf("logo.png", "image/png", 2 * 1024 * 1024));
    expect(await screen.findByText("Das Logo ist größer als 1 MB")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects a GIF", async () => {
    renderUpload();
    pick(fileOf("logo.gif", "image/gif", 1000));
    expect(await screen.findByText("Nimm eine PNG- oder JPEG-Datei")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads a valid PNG under the org id and reports the path", async () => {
    const onChange = renderUpload();
    pick(fileOf("logo.png", "image/png", 5000));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0][0]).toMatch(/^org-1\/logo-\d+\.png$/);
    expect(onChange.mock.calls[0][0]).toBe(upload.mock.calls[0][0]);
  });

  it("shows a preview of the stored logo and can remove it", async () => {
    const onChange = renderUpload(vi.fn(), "org-1/logo-1.png");
    const img = await screen.findByAltText("Dein Logo");
    expect(img).toHaveAttribute("src", "https://signed/logo");
    fireEvent.click(screen.getByRole("button", { name: "Logo entfernen" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
