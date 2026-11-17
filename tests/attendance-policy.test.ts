import { describe, expect, it } from "vitest";
import {
  arrivalAllowed,
  departureAllowed,
  isLate,
} from "../src/lib/attendance-policy";
const start = "2026-11-17T17:00:00+05:00";
const ms = (time: string) => Date.parse(`2026-11-17T${time}+05:00`);
describe("simple meeting timing policy", () => {
  it("allows arrival exactly ten minutes early, not a millisecond before", () => {
    const meeting = { status: "OPEN", starts_at: start };
    expect(arrivalAllowed(meeting, ms("16:50:00") - 1)).toBe(false);
    expect(arrivalAllowed(meeting, ms("16:50:00"))).toBe(true);
    expect(arrivalAllowed(meeting, ms("20:00:00"))).toBe(true);
    for (const status of ["DRAFT", "SCHEDULED", "CLOSED", "CANCELLED"])
      expect(arrivalAllowed({ ...meeting, status }, ms("17:00:00"))).toBe(
        false,
      );
  });
  it("is late strictly after fifteen minutes", () => {
    expect(isLate(new Date(ms("17:15:00") - 1), start)).toBe(false);
    expect(isLate(new Date(ms("17:15:00")), start)).toBe(false);
    expect(isLate(new Date(ms("17:15:00") + 1), start)).toBe(true);
  });
  it("permits departure after closure but not cancellation or drafts", () => {
    expect(departureAllowed("OPEN")).toBe(true);
    expect(departureAllowed("CLOSED")).toBe(true);
    for (const status of ["DRAFT", "SCHEDULED", "CANCELLED"])
      expect(departureAllowed(status)).toBe(false);
  });
});
