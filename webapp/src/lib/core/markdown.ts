export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderSummaryMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed
    .split(/\n{2,}/)
    .map((block) => renderBlock(block.trim()))
    .join('');
}

function renderBlock(block: string): string {
  const lines = block.split(/\n/);
  if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
    const items = lines
      .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
      .map((line) => `<li>${renderInline(line)}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  }

  return `<p>${renderInline(lines.join('\n')).replace(/\n/g, '<br>')}</p>`;
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
      const safeHref = sanitizeHref(href);
      return safeHref ? `<a href="${safeHref}">${label}</a>` : label;
    });
}

function sanitizeHref(href: string): string {
  if (/^(https?:|mailto:)/i.test(href) || href.startsWith('#')) {
    return escapeHtml(href);
  }

  return '';
}
