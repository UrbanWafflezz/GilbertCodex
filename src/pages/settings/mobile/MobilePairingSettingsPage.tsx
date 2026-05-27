import { Copy, QrCode, RefreshCw, ShieldCheck, Smartphone, Wifi } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import {
  getMobileBridgeStatus,
  resetMobileBridgePairing,
  startMobileBridge,
  stopMobileBridge,
  type MobileBridgeStatus,
} from "../../../app/tauriClient";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

export function MobilePairingSettingsPage() {
  const [status, setStatus] = useState<MobileBridgeStatus | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [busy, setBusy] = useState<"reset" | "start" | "stop" | null>(null);
  const [message, setMessage] = useState<SettingsStatusMessage | null>(null);
  const pairingPayload = status?.pairingPayload ?? "";
  const primaryUrl = status?.baseUrl || status?.lanUrls?.[0] || "";
  const lastSyncLabel = useMemo(() => formatSyncTime(status?.lastMobileSyncAt), [status?.lastMobileSyncAt]);

  useEffect(() => {
    let disposed = false;

    void startMobileBridge()
      .then((nextStatus) => {
        if (!disposed) {
          setStatus(nextStatus);
        }
      })
      .catch((error) => {
        if (!disposed) {
          setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not start mobile pairing." });
        }
      });

    const timer = window.setInterval(() => {
      void getMobileBridgeStatus()
        .then((nextStatus) => {
          if (!disposed) {
            setStatus(nextStatus);
          }
        })
        .catch(() => undefined);
    }, 3_000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    if (!pairingPayload) {
      setQrDataUrl("");
      return;
    }

    void QRCode.toDataURL(pairingPayload, {
      color: {
        dark: "#111827",
        light: "#ffffff",
      },
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    })
      .then((dataUrl) => {
        if (!disposed) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!disposed) {
          setQrDataUrl("");
          setMessage({ kind: "error", text: "Could not render the pairing QR code." });
        }
      });

    return () => {
      disposed = true;
    };
  }, [pairingPayload]);

  async function refreshStatus() {
    setMessage(null);
    try {
      setStatus(await getMobileBridgeStatus());
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not refresh mobile bridge status." });
    }
  }

  async function handleStart() {
    setBusy("start");
    setMessage(null);
    try {
      const nextStatus = await startMobileBridge();
      setStatus(nextStatus);
      setMessage({ kind: "success", text: "Mobile pairing is ready." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not start mobile pairing." });
    } finally {
      setBusy(null);
    }
  }

  async function handleStop() {
    setBusy("stop");
    setMessage(null);
    try {
      const nextStatus = await stopMobileBridge();
      setStatus(nextStatus);
      setMessage({ kind: "warning", text: "Mobile pairing stopped. Existing mobile data remains on each device." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not stop mobile pairing." });
    } finally {
      setBusy(null);
    }
  }

  async function handleResetPairing() {
    setBusy("reset");
    setMessage(null);
    try {
      const nextStatus = await resetMobileBridgePairing();
      setStatus(nextStatus);
      setMessage({ kind: "success", text: "Pairing code reset. Scan the new QR code on mobile." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not reset pairing." });
    } finally {
      setBusy(null);
    }
  }

  async function copyPairingPayload() {
    if (!pairingPayload) {
      return;
    }

    try {
      await navigator.clipboard.writeText(pairingPayload);
      setMessage({ kind: "success", text: "Pairing payload copied." });
    } catch {
      setMessage({ kind: "error", text: "Could not copy the pairing payload." });
    }
  }

  return (
    <>
      <SettingsSectionHeading detail="Pair Android, sync local data, and queue desktop-only actions behind desktop permissions." icon={Smartphone} title="Mobile" />
      <div className="settings-section-grid">
        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <QrCode size={19} aria-hidden="true" />
            <div>
              <h2>Pair Gilbert Codex Mobile</h2>
              <p>Open Android settings, scan this QR code, then keep both devices on the same network for Wi-Fi sync.</p>
            </div>
          </div>
          <div className="settings-mobile-pairing">
            <div className="settings-mobile-qr">
              {qrDataUrl ? <img alt="Gilbert Codex Mobile pairing QR code" src={qrDataUrl} /> : <QrCode size={72} aria-hidden="true" />}
            </div>
            <div className="settings-row-list">
              <div className="settings-row">
                <span>Bridge</span>
                <strong>{status?.running ? "Running" : "Stopped"}</strong>
              </div>
              <div className="settings-row">
                <span>Primary URL</span>
                <strong>{primaryUrl || "Start pairing to create a URL"}</strong>
              </div>
              <div className="settings-row">
                <span>Last mobile sync</span>
                <strong>{lastSyncLabel}</strong>
              </div>
              <div className="settings-row">
                <span>Queued desktop approvals</span>
                <strong>{status?.queuedMobileRequests ?? 0}</strong>
              </div>
            </div>
          </div>
          <div className="settings-button-row">
            <button className="settings-ghost-button" type="button" disabled={busy !== null} onClick={status?.running ? handleStop : handleStart}>
              <Wifi size={16} aria-hidden="true" />
              {busy === "start" ? "Starting" : busy === "stop" ? "Stopping" : status?.running ? "Stop bridge" : "Start bridge"}
            </button>
            <button className="settings-ghost-button" type="button" disabled={!status?.running || busy !== null} onClick={handleResetPairing}>
              <RefreshCw size={16} aria-hidden="true" />
              {busy === "reset" ? "Resetting" : "Reset QR"}
            </button>
            <button className="settings-ghost-button" type="button" disabled={!pairingPayload} onClick={copyPairingPayload}>
              <Copy size={16} aria-hidden="true" />
              Copy payload
            </button>
          </div>
          {message ? (
            <div className="settings-status-banner" data-kind={message.kind}>
              {message.text}
            </div>
          ) : null}
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <h2>Permission boundary</h2>
              <p>Mobile can request desktop-only actions, but desktop keeps enforcing workspace approvals and local privileges.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <div className="settings-row">
              <span>Synced data</span>
              <strong>Projects, chats, pinned state, settings, tasks, tools, and plugin metadata</strong>
            </div>
            <div className="settings-row">
              <span>Desktop-only actions</span>
              <strong>Terminal, browser preview, broad file changes, Git writes, and native app launches</strong>
            </div>
            <div className="settings-row">
              <span>Network paths</span>
              <strong>{(status?.lanUrls ?? []).join(", ") || "No active bridge URLs"}</strong>
            </div>
          </div>
          <div className="settings-button-row">
            <button className="settings-ghost-button" type="button" onClick={refreshStatus}>
              <RefreshCw size={16} aria-hidden="true" />
              Refresh
            </button>
          </div>
        </article>
      </div>
    </>
  );
}

function formatSyncTime(value: number | null | undefined) {
  if (!value) {
    return "Not yet";
  }

  return new Date(value).toLocaleString();
}
