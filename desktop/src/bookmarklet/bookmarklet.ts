// Builds the `javascript:` URL for the Letter Destroyer bookmarklet from destroyer.js's raw text.

import source from "./destroyer.js?raw";

/** The bookmarklet code (one self-running expression). */
export function bookmarkletCode(raw: string = source): string {
  const body = raw.replace(/^export\s+/gm, "");
  return `(()=>{${body}\nletterDestroyer();})()`;
}

/** The URL to save as a bookmark. */
export function bookmarkletUrl(raw: string = source): string {
  return "javascript:" + encodeURIComponent(bookmarkletCode(raw));
}
