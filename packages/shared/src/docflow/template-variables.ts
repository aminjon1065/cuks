import type { DocumentContent, DocumentContentNode } from './content';

/**
 * Template variable rendering (docs/modules/11 §12.7, plan §6.3). A template body may
 * contain `{{document.subject}}`-style placeholders which are replaced with values from a
 * fixed, server-supplied context.
 *
 * This is substitution, never evaluation: there is no expression language, no property
 * path traversal into arbitrary objects and no fallback to `eval`. A placeholder that is
 * not on the allow-list is left in place rather than resolved or blanked, so an author
 * sees their typo instead of silently shipping a document with a hole in it.
 */

/** Variable namespaces a template may read. Anything outside them is not a variable. */
export const TEMPLATE_VARIABLE_NAMESPACES = ['document', 'author', 'org', 'correspondent'] as const;
export type TemplateVariableNamespace = (typeof TEMPLATE_VARIABLE_NAMESPACES)[number];

/**
 * Every variable a template may use. An explicit list, not `namespace.*`: the context is
 * assembled from database rows, and a wildcard would expose whatever column happens to be
 * on them next — including ones nobody meant to publish.
 */
export const TEMPLATE_VARIABLES = [
  'document.subject',
  'document.regNumber',
  'document.regDate',
  'document.dueDate',
  'document.responseDueAt',
  'document.typeCode',
  'author.fullName',
  'author.shortName',
  'author.position',
  'org.name',
  'org.shortName',
  'correspondent.name',
  'correspondent.shortName',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export type TemplateContext = Partial<Record<TemplateVariable, string | null>>;

/** `{{ document.subject }}` — whitespace tolerated, nothing else. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z]+\.[a-zA-Z]+)\s*\}\}/g;

/** True when `name` is a variable the renderer will resolve. */
export function isTemplateVariable(name: string): name is TemplateVariable {
  return (TEMPLATE_VARIABLES as readonly string[]).includes(name);
}

/**
 * Replace the allow-listed placeholders in one string. An unknown placeholder is returned
 * verbatim; a known one with no value renders as an empty string, because «no correspondent
 * on this document» is a legitimate state, unlike «this variable does not exist».
 */
export function renderTemplateText(text: string, context: TemplateContext): string {
  return text.replace(PLACEHOLDER, (match, name: string) =>
    isTemplateVariable(name) ? (context[name] ?? '') : match,
  );
}

/** The variables a template actually uses, in first-appearance order — powers the preview
 *  and lets the admin page warn about a placeholder that will never resolve. */
export function collectTemplateVariables(content: unknown): {
  known: TemplateVariable[];
  unknown: string[];
} {
  const known: TemplateVariable[] = [];
  const unknown: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as DocumentContentNode;
    if (typeof n.text === 'string') {
      for (const match of n.text.matchAll(PLACEHOLDER)) {
        const name = match[1]!;
        if (isTemplateVariable(name)) {
          if (!known.includes(name)) known.push(name);
        } else if (!unknown.includes(name)) {
          unknown.push(name);
        }
      }
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(content);
  return { known, unknown };
}

/**
 * Render a whole template body against a context. Only `text` leaves are substituted —
 * a placeholder inside a link href or a node attribute is never resolved, so a template
 * cannot be used to assemble a URL out of values at render time.
 */
export function renderTemplateContent(
  content: DocumentContent,
  context: TemplateContext,
): DocumentContent {
  const renderNode = (node: DocumentContentNode): DocumentContentNode => ({
    ...node,
    ...(typeof node.text === 'string' ? { text: renderTemplateText(node.text, context) } : {}),
    ...(Array.isArray(node.content) ? { content: node.content.map(renderNode) } : {}),
  });
  return {
    ...content,
    ...(Array.isArray(content.content) ? { content: content.content.map(renderNode) } : {}),
  };
}
