import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ArchiveSwitch } from "./ArchiveSwitch";

describe("ArchiveSwitch", () => {
  it("reports the toggled value", () => {
    const onCheckedChange = vi.fn();
    render(<ArchiveSwitch checked={false} onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Show archived" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
