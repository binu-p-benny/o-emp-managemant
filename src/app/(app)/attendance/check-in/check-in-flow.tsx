"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { StaticMap } from "@/components/maps";
import { distanceMeters, formatDistance } from "@/lib/geo";
import { cn } from "@/lib/format";

type ProjectOption = {
  id: string;
  projectCode: string;
  projectName: string;
  latitude: number;
  longitude: number;
  attendanceRadius: number;
  outOfRangePolicy: "FLAG" | "BLOCK";
  address: string;
};

type Mode = "CHECK_IN" | "CHECK_OUT";

type Result = { type: Mode; inRange: boolean; distanceMeters: number; radiusMeters: number; projectCode: string; timestamp: string };

// ─── Geolocation ────────────────────────────────────────────────────────────

type GeoState =
  | { status: "locating" }
  | { status: "ok"; lat: number; lng: number; accuracy: number; at: number }
  | { status: "error"; message: string };

function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: "locating" });
  const watchId = useRef<number | null>(null);

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState({ status: "error", message: "This device does not support location." });
      return;
    }
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    setState({ status: "locating" });
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setState((prev) => {
          const next = { status: "ok" as const, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: pos.timestamp };
          // Keep the more accurate reading unless the previous one is stale (>30s).
          if (prev.status === "ok" && prev.accuracy < next.accuracy && next.at - prev.at < 30_000) return prev;
          return next;
        });
      },
      (err) => {
        const message =
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Allow location access for this site in your browser settings, then retry."
            : err.code === err.TIMEOUT
              ? "Getting your location took too long. Move to an open area and retry."
              : "Could not determine your location. Turn on GPS and retry.";
        setState({ status: "error", message });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  }, []);

  useEffect(() => {
    start();
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [start]);

  return { geo: state, retry: start };
}

// ─── Live selfie camera (no file upload) ────────────────────────────────────

function SelfieCamera({
  stampLines,
  captured,
  onCapture,
  onRetake,
}: {
  stampLines: string[];
  captured: string | null;
  onCapture: (dataUrl: string, capturedAt: number) => void;
  onRetake: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("Camera is not available. Use a phone browser over HTTPS.");
      return;
    }
    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus("live");
    } catch (e) {
      setStatus("error");
      setError(
        (e as DOMException)?.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access for this site and try again."
          : "Could not start the camera.",
      );
    }
  }, []);

  useEffect(() => {
    if (!captured) start();
    return stop;
  }, [captured, start, stop]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const size = Math.min(video.videoWidth, video.videoHeight);
    const out = 560;
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, out, out);
    // Burn a timestamp + coordinates into the image as evidence.
    const pad = 10;
    const lineH = 18;
    ctx.fillStyle = "rgba(17,24,39,0.72)";
    ctx.fillRect(0, out - stampLines.length * lineH - pad * 2, out, stampLines.length * lineH + pad * 2);
    ctx.fillStyle = "#fff";
    ctx.font = "600 14px system-ui, sans-serif";
    stampLines.forEach((line, i) => ctx.fillText(line, pad, out - pad - (stampLines.length - 1 - i) * lineH - 4));
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    stop();
    setStatus("idle");
    onCapture(dataUrl, Date.now());
  };

  if (captured) {
    return (
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={captured} alt="Captured selfie" className="aspect-square w-full rounded-xl object-cover" />
        <button type="button" onClick={onRetake} className="btn btn-secondary btn-sm absolute top-3 right-3 shadow">
          <Icon name="refresh" className="h-3.5 w-3.5" /> Retake
        </button>
      </div>
    );
  }

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-ink-900">
      <video ref={videoRef} playsInline muted autoPlay className="h-full w-full -scale-x-100 object-cover" />
      {status !== "live" && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-stone-300">
          {status === "error" ? (
            <div className="space-y-3">
              <p>{error}</p>
              <button type="button" onClick={start} className="btn btn-primary btn-sm">
                Try again
              </button>
            </div>
          ) : (
            <p>Starting camera…</p>
          )}
        </div>
      )}
      {status === "live" && (
        <>
          <div className="pointer-events-none absolute inset-8 rounded-[45%] border-2 border-dashed border-white/50" />
          <div className="absolute inset-x-0 bottom-4 flex justify-center">
            <button
              type="button"
              onClick={capture}
              aria-label="Capture selfie"
              className="grid h-16 w-16 place-items-center rounded-full border-4 border-white bg-brand-500 text-white shadow-lg active:scale-95"
            >
              <Icon name="camera" className="h-6 w-6" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Flow ───────────────────────────────────────────────────────────────────

export function CheckInFlow({
  mode,
  checkedInAt,
  projects,
  defaultProjectId,
  mainProjectId,
}: {
  mode: Mode;
  checkedInAt: string | null;
  projects: ProjectOption[];
  defaultProjectId: string | null;
  mainProjectId: string | null;
}) {
  const router = useRouter();
  const { geo, retry } = useGeolocation();
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [selfie, setSelfie] = useState<{ dataUrl: string; capturedAt: number } | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [secure, setSecure] = useState(true);
  const labelFetched = useRef(false);

  useEffect(() => setSecure(window.isSecureContext), []);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const distance = geo.status === "ok" && project ? distanceMeters(geo.lat, geo.lng, project.latitude, project.longitude) : null;
  const inRange = distance !== null && project !== null && distance <= project.attendanceRadius;
  const blocked = mode === "CHECK_IN" && distance !== null && !inRange && project?.outOfRangePolicy === "BLOCK";

  // Best-effort place name for the "attendance location" (self-location record).
  useEffect(() => {
    if (geo.status !== "ok" || labelFetched.current) return;
    labelFetched.current = true;
    fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${geo.lat}&lon=${geo.lng}`, { headers: { "Accept-Language": "en" } })
      .then((r) => r.json())
      .then((d: { display_name?: string }) => {
        if (d.display_name) setNote((cur) => cur || d.display_name!.split(",").slice(0, 4).join(",").trim());
      })
      .catch(() => undefined);
  }, [geo]);

  const now = new Date();
  const stampLines = [
    `${mode === "CHECK_IN" ? "CHECK-IN" : "CHECK-OUT"} · ${now.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`,
    geo.status === "ok" ? `${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)} ±${Math.round(geo.accuracy)}m` : "Location pending",
    project ? `${project.projectCode}${distance !== null ? ` · ${formatDistance(distance)} from site` : ""}` : "",
  ].filter(Boolean);

  const submit = async () => {
    if (!selfie || geo.status !== "ok" || !project) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: mode,
          projectId: project.id,
          selfie: selfie.dataUrl,
          capturedAt: selfie.capturedAt,
          latitude: geo.lat,
          longitude: geo.lng,
          accuracy: geo.accuracy,
          locationLabel: note || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        if (res.status === 400) setSelfie(null);
        return;
      }
      setResult(data as Result);
      router.refresh();
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    const time = new Date(result.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    return (
      <div className="card p-6 text-center">
        <div className={cn("mx-auto grid h-16 w-16 place-items-center rounded-full", result.inRange ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600")}>
          <Icon name={result.inRange ? "check" : "flag"} className="h-8 w-8" />
        </div>
        <h2 className="mt-4 text-xl font-bold">
          {result.type === "CHECK_IN" ? "Checked in" : "Checked out"} at {time}
        </h2>
        <p className="mt-1 text-sm text-stone-500">{result.projectCode}</p>
        {result.inRange ? (
          <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            On-site · {formatDistance(result.distanceMeters)} from the project location (radius {result.radiusMeters} m).
          </p>
        ) : (
          <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Out of range · {formatDistance(result.distanceMeters)} away (radius {result.radiusMeters} m). This entry has been sent to your manager for review.
          </p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/attendance" className="btn btn-dark">
            View my attendance
          </Link>
          <Link href="/" className="btn btn-secondary">
            Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div className="card p-6 text-center text-sm text-stone-600">
        <Icon name="alert" className="mx-auto mb-2 h-8 w-8 text-amber-500" />
        You are not assigned to any active project yet. Ask HR or your department head to assign your main project.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!secure && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          Camera and GPS need a secure (HTTPS) connection. Open this app over https:// to check in.
        </p>
      )}

      {mode === "CHECK_OUT" && checkedInAt && (
        <p className="rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Checked in at {new Date(checkedInAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · {project?.projectCode}
        </p>
      )}

      {/* Step 1 — project & location */}
      <section className="card overflow-hidden">
        <header className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-900 text-xs font-bold text-white">1</span>
          <h2 className="text-sm font-semibold">Location</h2>
        </header>
        <div className="space-y-3 p-4">
          {mode === "CHECK_IN" && projects.length > 1 && (
            <label className="block">
              <span className="label">Project</span>
              <select className="input" value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.projectCode} — {p.projectName}
                    {p.id === mainProjectId ? " (main)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {project && (
            <StaticMap
              className="h-56 w-full"
              circles={[{ lat: project.latitude, lng: project.longitude, radius: project.attendanceRadius }]}
              markers={[
                { lat: project.latitude, lng: project.longitude, color: "#134332", popup: `${project.projectCode}\n${project.address}` },
                ...(geo.status === "ok" ? [{ lat: geo.lat, lng: geo.lng, kind: "dot" as const, popup: "You are here" }] : []),
              ]}
            />
          )}
          {geo.status === "locating" && (
            <p className="flex items-center gap-2 text-sm text-stone-600">
              <span className="h-2 w-2 animate-ping rounded-full bg-brand-500" /> Getting your GPS location…
            </p>
          )}
          {geo.status === "error" && (
            <div className="flex items-start justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              <span>{geo.message}</span>
              <button type="button" onClick={retry} className="btn btn-secondary btn-sm shrink-0">
                Retry
              </button>
            </div>
          )}
          {geo.status === "ok" && project && distance !== null && (
            <div
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm",
                inRange ? "bg-emerald-50 text-emerald-900" : blocked ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-900",
              )}
            >
              <span className="flex items-center gap-2">
                <Icon name={inRange ? "check" : "alert"} />
                {inRange ? "Within site radius" : blocked ? "Outside site radius — check-in blocked" : "Outside site radius — will be flagged for review"}
              </span>
              <span className="text-right text-xs tabular-nums">
                {formatDistance(distance)} / {project.attendanceRadius} m
                <br />
                GPS ±{Math.round(geo.accuracy)} m
              </span>
            </div>
          )}
          <label className="block">
            <span className="label">Your location (recorded with this entry)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Site office, Block A" />
          </label>
        </div>
      </section>

      {/* Step 2 — selfie */}
      <section className="card overflow-hidden">
        <header className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-900 text-xs font-bold text-white">2</span>
          <h2 className="text-sm font-semibold">Live selfie</h2>
        </header>
        <div className="p-4">
          <SelfieCamera
            stampLines={stampLines}
            captured={selfie?.dataUrl ?? null}
            onCapture={(dataUrl, capturedAt) => setSelfie({ dataUrl, capturedAt })}
            onRetake={() => setSelfie(null)}
          />
          <p className="mt-2 text-xs text-stone-500">Photos are taken live with the camera — uploads from the gallery aren&apos;t accepted.</p>
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!selfie || geo.status !== "ok" || !project || blocked || submitting}
        className={cn("btn w-full py-3 text-base", mode === "CHECK_IN" ? "btn-primary" : "btn-dark")}
      >
        <Icon name={mode === "CHECK_IN" ? "login" : "logout"} className="h-5 w-5" />
        {submitting ? "Saving…" : mode === "CHECK_IN" ? "Confirm check-in" : "Confirm check-out"}
      </button>
    </div>
  );
}
