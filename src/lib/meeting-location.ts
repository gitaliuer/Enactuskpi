// One-shot lookup for setting a meeting point, never attendance or tracking.
export async function locateMeeting(
  geolocation: Pick<Geolocation, "getCurrentPosition"> | undefined,
): Promise<GeolocationCoordinates> {
  if (!geolocation) throw new Error("GEO_UNAVAILABLE");
  for (let attempt = 0; attempt < 2; attempt++) {
    let position: GeolocationPosition;
    try {
      position = await new Promise<GeolocationPosition>((resolve, reject) =>
        geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15000,
        }),
      );
    } catch (error) {
      const code = (error as GeolocationPositionError).code;
      if (code === 1) throw new Error("GEO_PERMISSION_DENIED");
      if (attempt === 0) continue;
      throw new Error(code === 3 ? "GEO_TIMEOUT" : "GEO_UNAVAILABLE");
    }
    const c = position.coords;
    if (
      !Number.isFinite(c.latitude) ||
      Math.abs(c.latitude) > 90 ||
      !Number.isFinite(c.longitude) ||
      Math.abs(c.longitude) > 180 ||
      !Number.isFinite(c.accuracy) ||
      c.accuracy < 0
    )
      throw new Error("GEO_UNAVAILABLE");
    if (
      !Number.isFinite(position.timestamp) ||
      Date.now() - position.timestamp > 30000 ||
      position.timestamp > Date.now() + 5000
    ) {
      if (attempt === 0) continue;
      throw new Error("GEO_STALE");
    }
    if (c.accuracy > 100) {
      if (attempt === 0) continue;
      throw new Error("GEO_INACCURATE");
    }
    return c;
  }
  throw new Error("GEO_UNAVAILABLE");
}
