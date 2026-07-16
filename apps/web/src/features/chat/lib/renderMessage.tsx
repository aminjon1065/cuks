import { Fragment, type ReactNode } from 'react';

/**
 * Render a stored TipTap / ProseMirror JSON message body to React (docs/modules/13 §3/§5). We render
 * the known node/mark set ourselves rather than going through generateHTML + dangerouslySetInnerHTML,
 * so no untrusted string ever reaches the DOM as markup — link hrefs are the only attribute we accept
 * and they are restricted to http(s)/mailto. Unknown nodes degrade to their text content.
 */

interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}
interface TipTapNode {
  type?: string;
  text?: string;
  marks?: TipTapMark[];
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
}

/** Only allow safe link schemes; anything else renders as plain text (no href). */
function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw, window.location.origin);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? raw : null;
  } catch {
    return null;
  }
}

function applyMarks(
  text: ReactNode,
  marks: TipTapMark[] | undefined,
  keyPrefix: string,
): ReactNode {
  if (!marks?.length) return text;
  return marks.reduce<ReactNode>((acc, mark, i) => {
    const key = `${keyPrefix}-m${i}`;
    switch (mark.type) {
      case 'bold':
        return <strong key={key}>{acc}</strong>;
      case 'italic':
        return <em key={key}>{acc}</em>;
      case 'strike':
        return <s key={key}>{acc}</s>;
      case 'code':
        return (
          <code key={key} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">
            {acc}
          </code>
        );
      case 'link': {
        const href = safeHref(mark.attrs?.href);
        return href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {acc}
          </a>
        ) : (
          acc
        );
      }
      default:
        return acc;
    }
  }, text);
}

function renderNode(node: TipTapNode, key: string): ReactNode {
  const children = (node.content ?? []).map((c, i) => renderNode(c, `${key}-${i}`));

  switch (node.type) {
    case 'doc':
      return <Fragment key={key}>{children}</Fragment>;
    case 'paragraph':
      return (
        <p key={key} className="whitespace-pre-wrap break-words">
          {children.length ? children : ' '}
        </p>
      );
    case 'text':
      return <Fragment key={key}>{applyMarks(node.text ?? '', node.marks, key)}</Fragment>;
    case 'mention':
      return (
        <span key={key} className="rounded bg-primary/10 px-1 font-medium text-primary">
          @{String(node.attrs?.label ?? node.attrs?.id ?? '')}
        </span>
      );
    case 'hardBreak':
      return <br key={key} />;
    case 'bulletList':
      return (
        <ul key={key} className="ml-5 list-disc space-y-0.5">
          {children}
        </ul>
      );
    case 'orderedList':
      return (
        <ol key={key} className="ml-5 list-decimal space-y-0.5">
          {children}
        </ol>
      );
    case 'listItem':
      return <li key={key}>{children}</li>;
    case 'blockquote':
      return (
        <blockquote key={key} className="border-l-2 border-border pl-3 text-text-muted">
          {children}
        </blockquote>
      );
    case 'codeBlock':
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-md bg-surface-2 p-2 font-mono text-[0.85em]"
        >
          <code>{children}</code>
        </pre>
      );
    case 'heading':
      return (
        <p key={key} className="font-semibold">
          {children}
        </p>
      );
    default:
      // Unknown node — fall back to its text content so nothing is lost.
      return <Fragment key={key}>{children}</Fragment>;
  }
}

/** Render a message body (TipTap JSON) to React, or `null` for an empty/unparsable body. */
export function renderMessageBody(body: unknown): ReactNode {
  if (!body || typeof body !== 'object') return null;
  return renderNode(body as TipTapNode, 'root');
}
