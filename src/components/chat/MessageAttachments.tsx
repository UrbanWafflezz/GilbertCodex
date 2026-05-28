import { ChevronLeft, ChevronRight, Download, ExternalLink, Eye, File, FileText, Image as ImageIcon, Maximize2, Minus, Plus, Video, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { formatAttachmentSize, isImageAttachment, isVideoAttachment } from "../../lib/chatAttachments";
import type { ChatArtifact, ChatAttachment, ChatImageAttachment } from "../../types/chat";

interface MessageAttachmentsProps {
  attachments?: ChatAttachment[];
}

interface OpenableImageProps {
  alt?: string;
  caption?: string;
  className?: string;
  downloadName?: string;
  showViewerCaption?: boolean;
  src: string;
}

export function MessageAttachments({ attachments }: MessageAttachmentsProps) {
  if (!attachments?.length) {
    return null;
  }

  const imageAttachments = attachments.filter(isImageAttachment);
  const videoAttachments = attachments.filter(isVideoAttachment);
  const fileAttachments = attachments.filter((attachment) => attachment.kind === "file");

  return (
    <div className="message-attachments" aria-label="Message attachments">
      {imageAttachments.length > 0 ? (
        <div className="message-image-grid" data-count={Math.min(imageAttachments.length, 4)}>
          {imageAttachments.map((attachment) => (
            <MessageImageTile key={attachment.id} attachment={attachment} />
          ))}
        </div>
      ) : null}
      {videoAttachments.length > 0 || fileAttachments.length > 0 ? (
        <div className="message-file-list">
          {videoAttachments.map((attachment) => (
            <a key={attachment.id} className="message-file-pill" href={attachment.dataUrl} download={attachment.name}>
              <Video size={16} aria-hidden="true" />
              <span>
                <strong>{attachment.name}</strong>
                <small>{formatAttachmentSize(attachment.size)}</small>
              </span>
            </a>
          ))}
          {fileAttachments.map((attachment) => {
            const body = (
              <>
                <File size={16} aria-hidden="true" />
                <span>
                  <strong>{attachment.name}</strong>
                  <small>{formatAttachmentSize(attachment.size)}</small>
                </span>
              </>
            );

            return attachment.dataUrl ? (
              <a key={attachment.id} className="message-file-pill" href={attachment.dataUrl} download={attachment.name}>
                {body}
              </a>
            ) : (
              <div key={attachment.id} className="message-file-pill">
                {body}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function MessageArtifacts({ artifacts }: { artifacts?: ChatArtifact[] }) {
  const [previewArtifact, setPreviewArtifact] = useState<ChatArtifact | null>(null);

  if (!artifacts?.length) {
    return null;
  }

  const imageArtifacts = artifacts.filter((artifact) => isImageArtifact(artifact) && artifact.url);
  const otherArtifacts = artifacts.filter((artifact) => !imageArtifacts.includes(artifact));

  return (
    <>
      <div className="message-artifacts" aria-label="Generated artifacts" data-has-images={imageArtifacts.length > 0}>
        {imageArtifacts.length > 0 ? <GeneratedImageGrid artifacts={imageArtifacts} /> : null}
        {otherArtifacts.map((artifact, index) => (
          <ArtifactCard
            artifact={artifact}
            key={artifact.id ?? `${artifact.title}-${index}`}
            onPreview={() => setPreviewArtifact(artifact)}
          />
        ))}
      </div>
      {previewArtifact && typeof document !== "undefined"
        ? createPortal(<ArtifactPreview artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />, document.body)
        : null}
    </>
  );
}

function ArtifactCard({ artifact, onPreview }: { artifact: ChatArtifact; onPreview: () => void }) {
  const isPdf = isPdfArtifact(artifact);
  const isImage = isImageArtifact(artifact);
  const detail = artifact.detail ?? formatArtifactKind(artifact.kind);

  if (isImage && artifact.url) {
    return <GeneratedImageTile artifact={artifact} />;
  }

  return (
    <article className="message-artifact-card" data-kind={isPdf ? "pdf" : artifact.kind ?? "file"}>
      <div className="message-artifact-icon" aria-hidden="true">
        {isImage ? <ImageIcon size={20} /> : <FileText size={20} />}
      </div>
      <div className="message-artifact-body">
        <div>
          <strong>{artifact.title}</strong>
          <small>{detail}</small>
        </div>
        <div className="message-artifact-actions">
          {isPdf ? (
            <button type="button" onClick={onPreview} title="View PDF">
              <Eye size={15} aria-hidden="true" />
              <span>View</span>
            </button>
          ) : null}
          {artifact.url ? (
            <a href={artifact.url} download={artifact.title} title="Download">
              <Download size={15} aria-hidden="true" />
              <span>Download</span>
            </a>
          ) : null}
          {artifact.url && !artifact.url.startsWith("data:") ? (
            <a href={artifact.url} rel="noreferrer" target="_blank" title="Open">
              <ExternalLink size={15} aria-hidden="true" />
              <span>Open</span>
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function GeneratedImageGrid({ artifacts }: { artifacts: ChatArtifact[] }) {
  return (
    <div className="generated-image-grid" data-count={Math.min(artifacts.length, 4)} aria-label="Generated images">
      {artifacts.map((artifact, index) => (
        <GeneratedImageTile artifact={artifact} key={artifact.id ?? `${artifact.title}-${index}`} />
      ))}
    </div>
  );
}

function GeneratedImageTile({ artifact }: { artifact: ChatArtifact }) {
  if (!artifact.url) {
    return null;
  }

  const aspect = artifact.width && artifact.height
    ? `${artifact.width} / ${artifact.height}`
    : undefined;
  const style = aspect
    ? ({ "--generated-image-aspect": aspect } as CSSProperties)
    : undefined;

  return (
    <figure className="generated-image-tile" style={style}>
      <OpenableImage
        alt="Generated image"
        className="generated-image-preview"
        downloadName={artifact.title}
        showViewerCaption={false}
        src={artifact.url}
      />
      <a className="generated-image-download" href={artifact.url} download={artifact.title} aria-label="Download generated image" title="Download">
        <Download size={17} aria-hidden="true" />
      </a>
    </figure>
  );
}

function ArtifactPreview({ artifact, onClose }: { artifact: ChatArtifact; onClose: () => void }) {
  const pages = useMemo(() => createNativePdfPages(artifact), [artifact]);
  const [activePage, setActivePage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const pageCount = Math.max(pages.length, 1);
  const clampedActivePage = Math.min(activePage, pageCount - 1);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowLeft") {
        setActivePage((page) => Math.max(page - 1, 0));
      } else if (event.key === "ArrowRight") {
        setActivePage((page) => Math.min(page + 1, pageCount - 1));
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, pageCount]);

  useEffect(() => {
    setActivePage(0);
    setZoom(1);
  }, [artifact.id, artifact.title]);

  const pageStyle: CSSProperties = {
    fontSize: `${Math.round(14 * zoom)}px`,
    minHeight: `${Math.round(930 * zoom)}px`,
    width: `${Math.round(720 * zoom)}px`,
  };

  return (
    <div className="artifact-viewer-backdrop" role="dialog" aria-modal="true" aria-label={`View ${artifact.title}`} onClick={onClose}>
      <div className="artifact-viewer" onClick={(event) => event.stopPropagation()}>
        <header className="artifact-viewer-toolbar">
          <div className="artifact-viewer-title">
            <FileText size={18} aria-hidden="true" />
            <span>
              <strong>{artifact.title}</strong>
              <small>{artifact.detail ?? "PDF artifact"}</small>
            </span>
          </div>
          <div className="artifact-viewer-controls">
            <button
              type="button"
              aria-label="Previous page"
              title="Previous page"
              disabled={clampedActivePage === 0}
              onClick={() => setActivePage((page) => Math.max(page - 1, 0))}
            >
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
            <span className="artifact-page-count">{clampedActivePage + 1} / {pageCount}</span>
            <button
              type="button"
              aria-label="Next page"
              title="Next page"
              disabled={clampedActivePage >= pageCount - 1}
              onClick={() => setActivePage((page) => Math.min(page + 1, pageCount - 1))}
            >
              <ChevronRight size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              disabled={zoom <= 0.75}
              onClick={() => setZoom((value) => Math.max(0.75, Number((value - 0.1).toFixed(2))))}
            >
              <Minus size={16} aria-hidden="true" />
            </button>
            <span className="artifact-zoom-count">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in"
              disabled={zoom >= 1.5}
              onClick={() => setZoom((value) => Math.min(1.5, Number((value + 0.1).toFixed(2))))}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
            {artifact.url ? (
              <a href={artifact.url} download={artifact.title} aria-label="Download PDF" title="Download">
                <Download size={17} aria-hidden="true" />
              </a>
            ) : null}
            <button type="button" aria-label="Close PDF viewer" title="Close" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="artifact-viewer-stage">
          {pages.length > 0 ? (
            <div className="pdf-native-viewer">
              <aside className="pdf-native-thumbnails" aria-label="PDF pages">
                {pages.map((page, index) => (
                  <button
                    type="button"
                    className={index === clampedActivePage ? "active" : ""}
                    key={`${artifact.id ?? artifact.title}-page-${index}`}
                    onClick={() => setActivePage(index)}
                  >
                    <span className="pdf-native-thumbnail-page">
                      {page.slice(0, 12).map((line, lineIndex) => (
                        <i key={`${index}-${lineIndex}`}>{line.replace(/^#+\s*/, "") || " "}</i>
                      ))}
                    </span>
                    <span>Page {index + 1}</span>
                  </button>
                ))}
              </aside>
              <section className="pdf-native-stage" aria-label={`Page ${clampedActivePage + 1} of ${pageCount}`}>
                <article className="pdf-native-page" style={pageStyle}>
                  {renderNativePdfPage(pages[clampedActivePage] ?? [])}
                </article>
              </section>
            </div>
          ) : (
            <div className="pdf-native-empty">
              <FileText size={26} aria-hidden="true" />
              <strong>Native preview unavailable</strong>
              <span>This PDF can still be downloaded. New Gilbert-generated PDFs include source text for the in-app viewer.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const PDF_PREVIEW_LINES_PER_PAGE = 44;
const PDF_PREVIEW_WRAP_AT = 92;

function createNativePdfPages(artifact: ChatArtifact) {
  const source = artifact.sourceText?.trim() || extractGeneratedPdfText(artifact.url).trim();

  if (!source) {
    return [];
  }

  const titledSource = artifact.sourceText && artifact.title
    ? `# ${artifact.title.replace(/\.pdf$/i, "")}\n\n${source}`
    : source;
  const sourcePages = titledSource.replace(/\r\n/g, "\n").split(/\n?\f\n?/);
  const pages: string[][] = [];

  for (const sourcePage of sourcePages) {
    const expandedLines = sourcePage
      .split("\n")
      .map(normalizeNativePdfPreviewLine)
      .filter((line): line is string => line !== null)
      .flatMap((line) => wrapPreviewLine(line, PDF_PREVIEW_WRAP_AT));

    for (let index = 0; index < expandedLines.length; index += PDF_PREVIEW_LINES_PER_PAGE) {
      pages.push(expandedLines.slice(index, index + PDF_PREVIEW_LINES_PER_PAGE));
    }
  }

  return pages.length > 0 ? pages : [[artifact.title]];
}

function normalizeNativePdfPreviewLine(value: string): string | null {
  const line = value
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, "\"")
    .replace(/[\u2032\u2035]/g, "'")
    .replace(/[\u2033\u2036]/g, "\"")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, "-")
    .replace(/[\u2500-\u257F]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\u00B0/g, " degrees")
    .replace(/\u00B1/g, "+/-")
    .replace(/\u00D7/g, "x")
    .replace(/\u00F7/g, "/")
    .replace(/\u2264/g, "<=")
    .replace(/\u2265/g, ">=")
    .replace(/\u2192/g, "->")
    .replace(/\u2190/g, "<-")
    .replace(/[\u2713\u2714]/g, "check")
    .replace(/[\u2715\u2716]/g, "x")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const compact = line.trim().replace(/\s+/g, "");

  if (compact.length >= 3 && (/^[\-=*_~.?#|\\/]{3,}$/.test(compact) || compact.replace(/[A-Za-z0-9]/g, "").length / compact.length > 0.86)) {
    return null;
  }

  return line.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " ").replace(/[ \t]{2,}/g, " ").trimEnd();
}

function wrapPreviewLine(line: string, maxLength: number) {
  if (line.length <= maxLength || /^#{1,3}\s/.test(line)) {
    return [line];
  }

  const wrapped: string[] = [];
  const indent = line.match(/^\s*/)?.[0] ?? "";
  let current = line.trim();

  while (current.length > maxLength) {
    const slice = current.slice(0, maxLength);
    const breakAt = Math.max(slice.lastIndexOf(" "), Math.floor(maxLength * 0.65));
    wrapped.push(`${wrapped.length > 0 ? indent : ""}${current.slice(0, breakAt).trimEnd()}`);
    current = current.slice(breakAt).trimStart();
  }

  wrapped.push(`${wrapped.length > 0 ? indent : ""}${current}`);
  return wrapped;
}

function renderNativePdfPage(lines: string[]) {
  return lines.map((line, index) => {
    const trimmed = line.trim();
    const key = `${index}-${trimmed.slice(0, 20)}`;

    if (!trimmed) {
      return <div className="pdf-line blank" key={key} aria-hidden="true" />;
    }

    if (/^#{1,3}\s/.test(trimmed)) {
      const level = trimmed.match(/^#+/)?.[0].length ?? 1;
      return (
        <div className={`pdf-line heading heading-${Math.min(level, 3)}`} key={key}>
          {trimmed.replace(/^#{1,3}\s*/, "")}
        </div>
      );
    }

    if (/^[-_=]{3,}$/.test(trimmed)) {
      return <div className="pdf-line rule" key={key} />;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      return (
        <div className="pdf-line bullet" key={key}>
          <span aria-hidden="true">•</span>
          <p>{trimmed.replace(/^[-*]\s+/, "")}</p>
        </div>
      );
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const marker = trimmed.match(/^\d+[.)]/)?.[0] ?? "";
      return (
        <div className="pdf-line numbered" key={key}>
          <span>{marker}</span>
          <p>{trimmed.replace(/^\d+[.)]\s+/, "")}</p>
        </div>
      );
    }

    if (/^\s{2,}/.test(line) || /[{}\[\];]|^\w+:\s/.test(trimmed)) {
      return <pre className="pdf-line mono" key={key}>{trimmed}</pre>;
    }

    return <p className="pdf-line" key={key}>{trimmed}</p>;
  });
}

function extractGeneratedPdfText(url?: string) {
  if (!url?.startsWith("data:application/pdf;base64,")) {
    return "";
  }

  try {
    const binary = atob(url.slice("data:application/pdf;base64,".length));
    const pages = binary
      .split(/\nendstream/g)
      .map((stream) => {
        const lines: string[] = [];
        const matcher = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
        let match: RegExpExecArray | null;

        while ((match = matcher.exec(stream))) {
          lines.push(unescapeGeneratedPdfString(match[1]));
        }

        return lines.join("\n");
      })
      .filter(Boolean);

    return pages.join("\n\f\n");
  } catch {
    return "";
  }
}

function unescapeGeneratedPdfString(value: string) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function isPdfArtifact(artifact: ChatArtifact) {
  return artifact.title.toLowerCase().endsWith(".pdf") || artifact.url?.startsWith("data:application/pdf") || /pdf/i.test(artifact.detail ?? "");
}

function isImageArtifact(artifact: ChatArtifact) {
  const title = artifact.title.toLowerCase();
  const mimeType = artifact.mimeType?.toLowerCase() ?? "";
  const url = artifact.url?.toLowerCase() ?? "";

  return artifact.kind === "image"
    || mimeType.startsWith("image/")
    || url.startsWith("data:image/")
    || /\.(?:png|jpe?g|webp|gif|avif|svg)$/.test(title);
}

function formatArtifactKind(kind?: ChatArtifact["kind"]) {
  if (kind === "document") {
    return "Generated document";
  }

  if (kind === "image") {
    return "Generated image";
  }

  if (kind === "code") {
    return "Generated code";
  }

  return "Generated artifact";
}

export function OpenableImage({
  alt = "Image attachment",
  caption,
  className,
  downloadName,
  showViewerCaption = true,
  src,
}: OpenableImageProps) {
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    if (!viewerOpen || typeof document === "undefined") {
      return;
    }

    document.documentElement.classList.add("image-viewer-open");

    return () => {
      document.documentElement.classList.remove("image-viewer-open");
    };
  }, [viewerOpen]);

  return (
    <>
      <button className={className ?? "message-image-button"} type="button" aria-label={`Open ${alt}`} onClick={() => setViewerOpen(true)}>
        <img alt={alt} decoding="async" loading="lazy" referrerPolicy="no-referrer" src={src} />
        <span className="message-image-open">
          <Maximize2 size={15} aria-hidden="true" />
        </span>
      </button>
      {viewerOpen && typeof document !== "undefined"
        ? createPortal(
          <ImageLightbox
            alt={alt}
            caption={caption}
            downloadName={downloadName}
            showCaption={showViewerCaption}
            src={src}
            onClose={() => setViewerOpen(false)}
          />,
          document.body,
        )
        : null}
    </>
  );
}

function MessageImageTile({ attachment }: { attachment: ChatImageAttachment }) {
  const details = [
    attachment.width && attachment.height ? `${attachment.width} x ${attachment.height}` : null,
    formatAttachmentSize(attachment.size),
  ]
    .filter(Boolean)
    .join(" - ");

  return <OpenableImage alt={attachment.name} caption={details ? `${attachment.name} - ${details}` : attachment.name} src={attachment.dataUrl} />;
}

function ImageLightbox({
  alt,
  caption,
  downloadName,
  onClose,
  showCaption = true,
  src,
}: {
  alt: string;
  caption?: string;
  downloadName?: string;
  onClose: () => void;
  showCaption?: boolean;
  src: string;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="image-viewer-backdrop" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <div className="image-viewer" onClick={(event) => event.stopPropagation()}>
        <header className="image-viewer-toolbar" data-compact={!showCaption}>
          {showCaption ? (
            <span>
              <ImageIcon size={16} aria-hidden="true" />
              {caption || alt}
            </span>
          ) : (
            <span className="sr-only">{alt}</span>
          )}
          <div>
            <a href={src} download={downloadName || alt || "image"} aria-label="Download image" title="Download image">
              <Download size={17} aria-hidden="true" />
            </a>
            <button type="button" aria-label="Close image viewer" title="Close" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="image-viewer-stage">
          <img alt={alt} decoding="async" referrerPolicy="no-referrer" src={src} />
        </div>
      </div>
    </div>
  );
}
