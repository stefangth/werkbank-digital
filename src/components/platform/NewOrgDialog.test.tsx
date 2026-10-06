import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { NewOrgDialog } from "./NewOrgDialog";
import * as platform from "@/data/platform";
import { toast } from "sonner";

describe("NewOrgDialog modules section", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults every module off and submits the chosen features", async () => {
    const provision = vi.spyOn(platform, "provisionOrgWithWarnings").mockResolvedValue({ orgId: "o1", warnings: [] });
    renderWithProviders(<NewOrgDialog />);
    fireEvent.click(screen.getByRole("button", { name: /new organization/i }));

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/first admin email/i), { target: { value: "a@acme.com" } });

    const bookingEngine = screen.getByLabelText("Booking engine");
    const hireOrders = screen.getByLabelText("Hire orders");
    expect(bookingEngine).not.toBeChecked();
    expect(hireOrders).not.toBeChecked();

    fireEvent.click(bookingEngine); // turn one module on

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(provision).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          features: { booking_flow: true, hire_orders: false, language_packages: false },
        }),
      ),
    );
  });
});

describe("NewOrgDialog workspace type", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const fillRequiredFields = () => {
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/^slug$/i), { target: { value: "acme" } });
    fireEvent.change(screen.getByLabelText(/first admin email/i), { target: { value: "a@acme.com" } });
  };

  it("submits orgKind: production by default", async () => {
    const provision = vi.spyOn(platform, "provisionOrgWithWarnings").mockResolvedValue({ orgId: "o1", warnings: [] });
    renderWithProviders(<NewOrgDialog />);
    fireEvent.click(screen.getByRole("button", { name: /new organization/i }));
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(provision).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ orgKind: "production" }),
      ),
    );
  });

  it("submits the picked workspace type", async () => {
    const provision = vi.spyOn(platform, "provisionOrgWithWarnings").mockResolvedValue({ orgId: "o1", warnings: [] });
    renderWithProviders(<NewOrgDialog />);
    fireEvent.click(screen.getByRole("button", { name: /new organization/i }));
    fillRequiredFields();

    fireEvent.click(screen.getByRole("combobox", { name: /workspace type/i }));
    fireEvent.click(await screen.findByRole("option", { name: /staffing agency/i }));

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(provision).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ orgKind: "staffing" }),
      ),
    );
  });
});

describe("NewOrgDialog provisioning warnings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("warns the super-admin when some defaults could not be seeded", async () => {
    vi.spyOn(platform, "provisionOrgWithWarnings").mockResolvedValue({ orgId: "o1", warnings: ["kind_settings"] });
    renderWithProviders(<NewOrgDialog />);
    fireEvent.click(screen.getByRole("button", { name: /new organization/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/first admin email/i), { target: { value: "a@acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("kind_settings")));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
