import { Children, isValidElement, memo, type MouseEvent, type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { openExternalUrl } from "../../app/tauriClient";
import { copyTextToClipboard } from "../../lib/clipboard";
import { normalizeMarkdownForDisplay } from "../../lib/markdown";
import { OpenableImage } from "./MessageAttachments";

interface MarkdownMessageProps {
  className?: string;
  content: string;
  isStreaming?: boolean;
}

interface CodeBlockProps {
  className?: string;
  code: string;
  language?: string;
}

function getCodeText(children: ReactNode) {
  return Children.toArray(children).join("").replace(/\n$/, "");
}

const CodeBlock = memo(function CodeBlock({ className, code, language }: CodeBlockProps) {
  const copiedTimerRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const displayLanguage = language || "code";

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    const didCopy = await copyTextToClipboard(code);

    if (!didCopy) {
      return;
    }

    setCopied(true);

    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }

    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, 1400);
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{displayLanguage}</span>
        <button type="button" aria-label={copied ? "Code copied" : "Copy code"} title={copied ? "Code copied" : "Copy code"} onClick={handleCopy}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        </button>
      </div>
      <pre>
        <code className={className}>{code}</code>
      </pre>
    </div>
  );
});

const markdownComponents: Components = {
  a({ children, href, ...props }) {
    const safeHref = sanitizeMarkdownHref(href);

    function handleClick(event: MouseEvent<HTMLAnchorElement>) {
      if (!safeHref || !isExternalUserLink(safeHref)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void openExternalUrl(safeHref).catch((error) => {
        console.warn("Could not open external link", error);
      });
    }

    if (!safeHref) {
      return <span>{children}</span>;
    }

    return (
      <a {...props} href={safeHref} onClick={handleClick} rel="noreferrer" target="_blank">
        {children}
      </a>
    );
  },
  img({ alt, src }) {
    const safeSrc = sanitizeMarkdownImageSrc(src);

    if (!safeSrc) {
      return null;
    }

    return <OpenableImage alt={alt || "Assistant image"} className="markdown-image-button" src={safeSrc} />;
  },
  table({ children }) {
    return (
      <div className="markdown-table-scroll" role="region" aria-label="Markdown table" tabIndex={0}>
        <table>{children}</table>
      </div>
    );
  },
  pre({ children }) {
    const child = Children.toArray(children)[0];

    if (!isValidElement(child)) {
      return <pre>{children}</pre>;
    }

    const childProps = child.props as { children?: ReactNode; className?: string };
    const className = childProps.className;
    const language = /language-([\w-]+)/.exec(className ?? "")?.[1];

    return <CodeBlock className={className} code={getCodeText(childProps.children)} language={language} />;
  },
  code({ children, className, ...props }) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};
const markdownRemarkPlugins = [remarkGfm];

function isExternalUserLink(href: string) {
  return /^(?:https?:|mailto:)/i.test(href.trim());
}

function sanitizeMarkdownHref(href?: string) {
  const value = href?.trim();
  if (!value) {
    return undefined;
  }

  if (value.startsWith("#")) {
    return value;
  }

  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:") {
      return url.href;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function sanitizeMarkdownImageSrc(src?: string) {
  const value = src?.trim();
  if (!value) {
    return undefined;
  }

  if (value.startsWith("blob:") || value.startsWith("asset:")) {
    return value;
  }

  if (/^data:image\/(?:avif|bmp|gif|jpe?g|png|webp);base64,/i.test(value)) {
    return value;
  }

  return undefined;
}

function MarkdownMessageComponent({ className, content, isStreaming }: MarkdownMessageProps) {
  const deferredContent = useDeferredValue(content);
  const contentForRender = isStreaming ? deferredContent : content;
  const displayContent = useMemo(() => normalizeMarkdownForDisplay(contentForRender, { final: !isStreaming }), [contentForRender, isStreaming]);
  const rootClassName = ["markdown-message", isStreaming ? "markdown-message-streaming" : "", className ?? ""].filter(Boolean).join(" ");

  if (!displayContent.trim()) {
    return null;
  }

  return (
    <div className={rootClassName} data-streaming={Boolean(isStreaming)}>
      <ReactMarkdown components={markdownComponents} remarkPlugins={markdownRemarkPlugins}>
        {displayContent}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownMessage = memo(MarkdownMessageComponent, areMarkdownMessagePropsEqual);

function areMarkdownMessagePropsEqual(previous: MarkdownMessageProps, next: MarkdownMessageProps) {
  return previous.className === next.className && previous.content === next.content && previous.isStreaming === next.isStreaming;
}
