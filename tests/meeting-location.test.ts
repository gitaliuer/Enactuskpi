import { describe, expect, it, vi } from "vitest";
import { locateMeeting } from "../src/lib/meeting-location";
const position = (accuracy = 20, timestamp = Date.now()) =>
  ({
    coords: { latitude: 45.015, longitude: 78.373, accuracy },
    timestamp,
  }) as GeolocationPosition;

describe("one-shot meeting location", () => {
  it("requests a fresh high-accuracy point without watching", async () => {
    const getCurrentPosition = vi.fn<Geolocation["getCurrentPosition"]>(
      (success) => success(position()),
    );
    const result = await locateMeeting({ getCurrentPosition });
    expect(result.latitude).toBe(45.015);
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    });
  });
  it("does not retry denied permission", async () => {
    const getCurrentPosition = vi.fn((_success, reject) => reject({ code: 1 }));
    await expect(locateMeeting({ getCurrentPosition })).rejects.toThrow(
      "GEO_PERMISSION_DENIED",
    );
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });
  it("retries timeout once, then returns a useful error", async () => {
    const getCurrentPosition = vi.fn((_success, reject) => reject({ code: 3 }));
    await expect(locateMeeting({ getCurrentPosition })).rejects.toThrow(
      "GEO_TIMEOUT",
    );
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });
  it("accepts accuracy of exactly 100 m", async () => {
    await expect(
      locateMeeting({
        getCurrentPosition: (success) => success(position(100)),
      }),
    ).resolves.toHaveProperty("accuracy", 100);
  });
  it("rejects inaccurate or stale points after one retry", async () => {
    await expect(
      locateMeeting({
        getCurrentPosition: (success) => success(position(101)),
      }),
    ).rejects.toThrow("GEO_INACCURATE");
    await expect(
      locateMeeting({
        getCurrentPosition: (success) =>
          success(position(20, Date.now() - 31000)),
      }),
    ).rejects.toThrow("GEO_STALE");
  });
  it("handles unsupported geolocation", async () => {
    await expect(locateMeeting(undefined)).rejects.toThrow("GEO_UNAVAILABLE");
  });
});
