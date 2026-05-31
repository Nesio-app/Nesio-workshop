import sanitizeHtmlLib from "sanitize-html";

const BIO_OPTIONS: sanitizeHtmlLib.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "em",
    "b",
    "i",
    "ul",
    "ol",
    "li",
    "h2",
    "h3",
    "blockquote",
    "span",
  ],
  allowedAttributes: {
    span: ["class"],
  },
  disallowedTagsMode: "discard",
};

export function sanitizeHtml(input: string, maxLen = 50000): string {
  const cleaned = sanitizeHtmlLib(input.trim(), BIO_OPTIONS);
  return cleaned.slice(0, maxLen);
}
