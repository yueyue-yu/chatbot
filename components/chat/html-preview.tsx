"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";

const sandboxContentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const sandboxHead = `
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${sandboxContentSecurityPolicy}" />
`;

function buildSandboxedHtmlDocument(content: string) {
  if (!content.trim()) {
    return `<!doctype html><html><head>${sandboxHead}</head><body></body></html>`;
  }

  if (/<head[\s>]/i.test(content)) {
    return content.replace(
      /<head(\s[^>]*)?>/i,
      (match) => `${match}${sandboxHead}`
    );
  }

  if (/<html[\s>]/i.test(content)) {
    return content.replace(
      /<html(\s[^>]*)?>/i,
      (match) => `${match}<head>${sandboxHead}</head>`
    );
  }

  return `${sandboxHead}${content}`;
}

function PureHtmlPreview({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const srcDoc = useMemo(() => buildSandboxedHtmlDocument(content), [content]);

  return (
    <iframe
      className={cn("size-full border-0 bg-white", className)}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      title="HTML preview"
    />
  );
}

export const HtmlPreview = memo(PureHtmlPreview);
