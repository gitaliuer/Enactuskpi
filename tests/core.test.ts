import { describe, it, expect, beforeAll } from "vitest";
import {
  distance,
  validateGeo,
  makeQR,
  verifyQR,
  csv,
} from "../src/server/core";
beforeAll(() => {
  process.env.QR_SECRET = "a".repeat(40);
});
describe("200m geofence, accuracy and freshness are independent", () => {
  const point = { latitude: 0, longitude: 0 };
  for (const meters of [0, 199.9, 200])
    it(`accepts ${meters}m inclusively`, () => {
      const geo = {
        latitude: ((meters / 6371000) * 180) / Math.PI,
        longitude: 0,
        accuracy: 100,
        timestamp: 100000,
      };
      expect(validateGeo(geo, point, 100000).distance).toBeCloseTo(meters, 6);
    });
  for (const meters of [200.1, 250])
    it(`rejects ${meters}m`, () =>
      expect(() =>
        validateGeo(
          {
            latitude: ((meters / 6371000) * 180) / Math.PI,
            longitude: 0,
            accuracy: 1,
            timestamp: 100000,
          },
          point,
          100000,
        ),
      ).toThrow("GEO_OUTSIDE_RADIUS"));
  it("validates ranges, finite numbers, accuracy and measurement age", () => {
    for (const geo of [
      { latitude: 91 },
      { longitude: 181 },
      { latitude: NaN },
      { accuracy: -1 },
    ])
      expect(() =>
        validateGeo(
          { latitude: 0, longitude: 0, accuracy: 1, timestamp: 100000, ...geo },
          point,
          100000,
        ),
      ).toThrow("GEO_UNAVAILABLE");
    expect(() =>
      validateGeo(
        { latitude: 0, longitude: 0, accuracy: 100.1, timestamp: 100000 },
        point,
        100000,
      ),
    ).toThrow("GEO_INACCURATE");
    expect(() =>
      validateGeo(
        { latitude: 0, longitude: 0, accuracy: 1, timestamp: 69999 },
        point,
        100000,
      ),
    ).toThrow("GEO_STALE");
    expect(() =>
      validateGeo(
        { latitude: 0, longitude: 0, accuracy: 1, timestamp: 106000 },
        point,
        100000,
      ),
    ).toThrow("GEO_STALE");
  });
  it("computes equivalent coordinates", () =>
    expect(distance(45, 78, 45, 78)).toBe(0));
});
describe("QR HMAC, intervals and version", () => {
  it("same interval is compatible across screens and participants", () => {
    const a = makeQR("meeting", 1, 180001),
      b = makeQR("meeting", 1, 359999);
    expect(a.token).toBe(b.token);
    expect(() => verifyQR(a.token, "meeting", 1, 359999)).not.toThrow();
    expect(() => verifyQR(a.token, "meeting", 1, 359999)).not.toThrow();
  });
  it("expires at exactly 180 second boundary, no hidden grace", () => {
    const a = makeQR("meeting", 1, 180001);
    expect(() => verifyQR(a.token, "meeting", 1, 360000)).toThrow("QR_EXPIRED");
  });
  it("rejects changed payload, meeting, version and future interval", () => {
    const a = makeQR("meeting", 1, 180001);
    for (const args of [
      [a.token, "other", 1, 180001],
      [a.token, "meeting", 2, 180001],
      [a.token, "meeting", 1, 179999],
      ["fake." + a.token, "meeting", 1, 180001],
    ] as const)
      expect(() => verifyQR(args[0], args[1], args[2], args[3])).toThrow(
        "QR_INVALID",
      );
  });
});
it("CSV uses BOM, quotes, multiline and formula neutralisation", () => {
  const s = csv([
    { name: "=1+1", comment: 'Привет, "Али"\nстрока', other: " \t@SUM(A1)" },
  ]);
  expect(s.startsWith("\uFEFF")).toBe(true);
  expect(s).toContain('"\'=1+1"');
  expect(s).toContain('"Привет, ""Али""\nстрока"');
  expect(s).toContain('"\' \t@SUM(A1)"');
});
