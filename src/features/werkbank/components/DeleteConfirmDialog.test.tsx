import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

const base = { open: true, onOpenChange: vi.fn(), title: "Delete it?", body: "Gone for good.", onConfirm: vi.fn(), pending: false };

describe("DeleteConfirmDialog", () => {
  it("names what is deleted and confirms", () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmDialog {...base} onConfirm={onConfirm} />);
    expect(screen.getByText("Delete it?")).toBeInTheDocument();
    expect(screen.getByText("Gone for good.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables the confirm button while pending", () => {
    render(<DeleteConfirmDialog {...base} pending />);
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
});
