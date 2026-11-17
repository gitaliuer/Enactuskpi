"use client";
import { useEffect, useRef, useState } from "react";
import { LocateFixed, LoaderCircle } from "lucide-react";
import { locateMeeting } from "@/lib/meeting-location";
import { ru, ui } from "@/lib/i18n";

export function MeetingLocationFields({
  latitude = "",
  longitude = "",
}: {
  latitude?: number | string;
  longitude?: number | string;
}) {
  const [lat, setLat] = useState(String(latitude));
  const [lon, setLon] = useState(String(longitude));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  function manualChange(value: string, latitude: boolean) {
    request.current++;
    setBusy(false);
    setMessage("");
    setFailed(false);
    if (latitude) setLat(value);
    else setLon(value);
  }
  async function locate() {
    const current = ++request.current;
    setBusy(true);
    setFailed(false);
    setMessage(ui.meetingLocationLoading);
    try {
      const point = await locateMeeting(navigator.geolocation);
      if (current !== request.current) return;
      setLat(point.latitude.toFixed(6));
      setLon(point.longitude.toFixed(6));
      setMessage(
        ui.meetingLocationAccuracy.replace(
          "{meters}",
          String(Math.ceil(point.accuracy)),
        ),
      );
    } catch (error) {
      if (current !== request.current) return;
      setFailed(true);
      const code = (error as Error).message as keyof typeof ru.errors;
      setMessage(ru.errors[code] ?? ru.errors.GEO_UNAVAILABLE);
    } finally {
      if (current === request.current) setBusy(false);
    }
  }
  return (
    <section className="meeting-location" aria-label={ui.meetingLocationTitle}>
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() => void locate()}
      >
        {busy ? (
          <LoaderCircle size={18} aria-hidden="true" />
        ) : (
          <LocateFixed size={18} aria-hidden="true" />
        )}
        {busy ? ui.meetingLocationLoading : ui.meetingLocationUse}
      </button>
      <p className="footnote">{ui.meetingLocationHelp}</p>
      <p
        className="footnote"
        role={failed ? "alert" : "status"}
        aria-live="polite"
      >
        {message}
      </p>
      <div className="form-row">
        <label className="field">
          <span>{ui.s194}</span>
          <input
            name="latitude"
            type="number"
            min={-90}
            max={90}
            step="any"
            required
            value={lat}
            onChange={(event) => manualChange(event.target.value, true)}
          />
        </label>
        <label className="field">
          <span>{ui.s195}</span>
          <input
            name="longitude"
            type="number"
            min={-180}
            max={180}
            step="any"
            required
            value={lon}
            onChange={(event) => manualChange(event.target.value, false)}
          />
        </label>
      </div>
    </section>
  );
}
