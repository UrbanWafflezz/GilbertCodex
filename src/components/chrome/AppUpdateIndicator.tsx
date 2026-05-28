import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, RefreshCw, RotateCcw } from "lucide-react";
import { checkForAppUpdate, installAppUpdate, type AppUpdateCheckResponse } from "../../app/tauriClient";
import { DialogShell } from "../dialogs/AppDialog";

type AppUpdateStage = "idle" | "checking" | "available" | "not-available" | "feed-missing" | "downloading" | "installing" | "restarting" | "error";

interface AppUpdateProgress {
  contentLength: number | null;
  downloaded: number;
}

export interface AppUpdateController {
  busy: boolean;
  checkNow: () => void;
  error: string | null;
  installNow: () => void;
  percent: number | null;
  stage: AppUpdateStage;
  update: AppUpdateCheckResponse | null;
}

const STARTUP_CHECK_DELAY_MS = 900;
const FOCUS_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const TRANSIENT_STATUS_MS = 4_500;

export function useAppUpdateController(desktopRuntime: boolean): AppUpdateController {
  const [stage, setStage] = useState<AppUpdateStage>("idle");
  const [update, setUpdate] = useState<AppUpdateCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AppUpdateProgress>({
    contentLength: null,
    downloaded: 0,
  });
  const lastCheckRef = useRef(0);
  const busyRef = useRef(false);

  const percent = useMemo(() => {
    if (!progress.contentLength || progress.contentLength <= 0) {
      return null;
    }

    return Math.min(100, Math.max(0, Math.round((progress.downloaded / progress.contentLength) * 100)));
  }, [progress]);

  const runCheck = useCallback(
    async (silent: boolean) => {
      if (!desktopRuntime || busyRef.current) {
        return;
      }

      busyRef.current = true;
      lastCheckRef.current = Date.now();
      setError(null);

      if (!silent) {
        setStage("checking");
      }

      try {
        const result = await checkForAppUpdate();
        setUpdate(result.available || result.feedStatus === "missing" ? result : null);
        setStage(result.available ? "available" : silent ? "idle" : result.feedStatus === "missing" ? "feed-missing" : "not-available");
      } catch (checkError) {
        const missingFeedMessage = getMissingFeedMessage(checkError);
        setUpdate(null);
        if (missingFeedMessage) {
          setUpdate({
            available: false,
            currentVersion: "unknown",
            feedStatus: "missing",
            message: missingFeedMessage,
          });
          setStage(silent ? "idle" : "feed-missing");
          busyRef.current = false;
          return;
        }

        if (!silent) {
          setError(checkError instanceof Error ? checkError.message : "Update check failed.");
          setStage("error");
        } else {
          setStage("idle");
        }
      } finally {
        busyRef.current = false;
      }
    },
    [desktopRuntime],
  );

  const checkNow = useCallback(() => {
    void runCheck(false);
  }, [runCheck]);

  const installNow = useCallback(() => {
    if (!desktopRuntime || busyRef.current || !update?.available) {
      return;
    }

    busyRef.current = true;
    setError(null);
    setProgress({ contentLength: null, downloaded: 0 });
    setStage("downloading");

    void installAppUpdate((event) => {
      if (event.event === "started") {
        setProgress({
          contentLength: event.data.contentLength ?? null,
          downloaded: 0,
        });
      } else if (event.event === "progress") {
        setProgress({
          contentLength: event.data.contentLength ?? null,
          downloaded: event.data.downloaded,
        });
      } else if (event.event === "finished") {
        setStage("installing");
      }
    }).catch((installError) => {
      busyRef.current = false;
      setError(installError instanceof Error ? installError.message : "Update install failed.");
      setStage("error");
    });
  }, [desktopRuntime, update]);

  useEffect(() => {
    if (!desktopRuntime) {
      return;
    }

    const timer = window.setTimeout(() => {
      void runCheck(false);
    }, STARTUP_CHECK_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [desktopRuntime, runCheck]);

  useEffect(() => {
    if (!desktopRuntime) {
      return;
    }

    function handleFocus() {
      if (Date.now() - lastCheckRef.current >= FOCUS_CHECK_INTERVAL_MS) {
        void runCheck(true);
      }
    }

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [desktopRuntime, runCheck]);

  useEffect(() => {
    if (stage !== "not-available" && stage !== "feed-missing") {
      return;
    }

    const timer = window.setTimeout(() => setStage("idle"), TRANSIENT_STATUS_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

  return {
    busy: stage === "checking" || stage === "downloading" || stage === "installing" || stage === "restarting",
    checkNow,
    error,
    installNow,
    percent,
    stage,
    update,
  };
}

interface AppUpdateIndicatorProps {
  controller: AppUpdateController;
}

export function AppUpdateIndicator({ controller }: AppUpdateIndicatorProps) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  useEffect(() => {
    if (controller.stage !== "available") {
      setConfirmationOpen(false);
    }
  }, [controller.stage]);

  if (controller.stage === "idle") {
    return null;
  }

  const label = getUpdateLabel(controller);
  const title = getUpdateTitle(controller);
  const actionAvailable = controller.stage === "available";
  const releaseNotes = summarizeUpdateBody(controller.update?.body);
  const Icon =
    controller.stage === "not-available"
      ? CheckCircle2
      : controller.stage === "feed-missing"
        ? AlertCircle
        : controller.stage === "installing" || controller.stage === "restarting"
          ? RotateCcw
          : controller.stage === "checking"
            ? RefreshCw
            : Download;

  return (
    <>
      <button
        className="app-update-indicator"
        type="button"
        aria-label={title}
        title={title}
        data-stage={controller.stage}
        data-busy={controller.busy}
        data-actionable={actionAvailable}
        disabled={controller.busy || controller.stage === "not-available"}
        onClick={actionAvailable ? () => setConfirmationOpen(true) : controller.checkNow}
      >
        <Icon size={14} aria-hidden="true" />
        <span>{label}</span>
        {controller.stage === "downloading" && controller.percent !== null ? <em>{controller.percent}%</em> : null}
      </button>

      <DialogShell
        description="Review the update before Gilbert Codex downloads the signed package and hands off to the platform installer."
        icon={Download}
        onClose={() => setConfirmationOpen(false)}
        open={confirmationOpen}
        title="Install update?"
        actions={
          <>
            <button className="dialog-button" type="button" onClick={() => setConfirmationOpen(false)}>
              Not now
            </button>
            <button
              className="dialog-button dialog-button-primary"
              type="button"
              onClick={() => {
                setConfirmationOpen(false);
                controller.installNow();
              }}
            >
              Install update
            </button>
          </>
        }
      >
        <div className="app-update-dialog">
          <dl className="dialog-detail-list">
            <div>
              <dt>Current</dt>
              <dd>{controller.update?.currentVersion ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Update</dt>
              <dd>{controller.update?.version ?? "Ready"}</dd>
            </div>
            {controller.update?.date ? (
              <div>
                <dt>Published</dt>
                <dd>{formatUpdateDate(controller.update.date)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Installer</dt>
              <dd>After download, the platform installer opens and Gilbert Codex closes.</dd>
            </div>
            <div>
              <dt>Relaunch</dt>
              <dd>The installer can reopen the app from its finish page when the operating system allows it.</dd>
            </div>
          </dl>

          {releaseNotes ? (
            <section className="app-update-release-notes" aria-label="Release notes">
              <strong>Release notes</strong>
              <p>{releaseNotes}</p>
            </section>
          ) : null}
        </div>
      </DialogShell>
    </>
  );
}

function getUpdateLabel(controller: AppUpdateController) {
  if (controller.stage === "checking") {
    return "Checking";
  }

  if (controller.stage === "available") {
    return "Update available";
  }

  if (controller.stage === "not-available") {
    return "Up to date";
  }

  if (controller.stage === "feed-missing") {
    return "No update feed";
  }

  if (controller.stage === "downloading") {
    return "Updating";
  }

  if (controller.stage === "installing") {
    return "Opening installer";
  }

  if (controller.stage === "restarting") {
    return "Restarting";
  }

  return "Update failed";
}

function getUpdateTitle(controller: AppUpdateController) {
  if (controller.stage === "available") {
    const version = controller.update?.version ? ` ${controller.update.version}` : "";
    return `Install Gilbert Codex update${version}`;
  }

  if (controller.stage === "error") {
    return controller.error ?? "Update failed. Click to check again.";
  }

  if (controller.stage === "feed-missing") {
    return controller.update?.message ?? "No signed update feed is published yet.";
  }

  if (controller.stage === "downloading") {
    return controller.percent === null ? "Downloading update" : `Downloading update ${controller.percent}%`;
  }

  if (controller.stage === "installing") {
    return "Opening the platform installer. Gilbert Codex will close while the installer takes over.";
  }

  return getUpdateLabel(controller);
}

function getMissingFeedMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) {
    return null;
  }

  if (/valid release JSON|release JSON|latest\.json|ReleaseNotFound|404|Not Found/i.test(message)) {
    return "No signed update feed is published yet. Publish a release with latest.json and signed updater artifacts before desktop installs can update automatically.";
  }

  return null;
}

function formatUpdateDate(date: string) {
  const timestamp = Date.parse(date);
  if (Number.isNaN(timestamp)) {
    return date;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function summarizeUpdateBody(body?: string | null) {
  const text = body
    ?.replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>\-[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return null;
  }

  return text.length > 360 ? `${text.slice(0, 357).trim()}...` : text;
}
