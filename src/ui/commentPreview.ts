const COMMENT_PREVIEW_MAX = 16;

export function formatCommentPreview(comment: string | null | undefined): string | null {
  const text = comment?.replace(/\s+/g, " ").trim();
  if (!text) {
    return null;
  }
  const chars = [...text];
  const clipped =
    chars.length > COMMENT_PREVIEW_MAX
      ? `${chars.slice(0, COMMENT_PREVIEW_MAX).join("")}…`
      : text;
  return `（${clipped}）`;
}
