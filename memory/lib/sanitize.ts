import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: "discard",
};

export function sanitizeText(input: string, maxLen = 2000): string {
  const cleaned = sanitizeHtml(input.trim(), OPTIONS);
  return cleaned.slice(0, maxLen);
}

export function sanitizeShort(input: string, maxLen = 120): string {
  return sanitizeText(input, maxLen);
}
