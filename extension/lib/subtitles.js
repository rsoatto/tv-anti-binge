// Subtitle parsing: SRT and WebVTT -> normalized cues [{start, end, text}]
// (seconds). Cues are the timestamp backbone for finding scene breaks.

function parseTimestamp(ts) {
  // 00:01:02,345 (SRT) | 00:01:02.345 (VTT) | 01:02.345 (VTT short)
  const m = ts.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})$/);
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return (
    (parseInt(h || "0", 10) * 3600 +
      parseInt(min, 10) * 60 +
      parseInt(s, 10)) +
    parseInt(ms, 10) / 1000
  );
}

function cleanText(text) {
  return text
    .replace(/<[^>]+>/g, " ") // formatting tags
    .replace(/\{\\[^}]*\}/g, " ") // ASS-style tags that leak into SRT
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ") // [MUSIC], (sighs) etc.
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse SRT or WebVTT content. Returns cues sorted by start time; cues whose
// text is empty after cleaning (pure sound effects) are kept with text "" so
// timing gaps are still computed from speech, not noise.
export function parseSubtitles(content) {
  const text = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const cues = [];
  const timeLine = /(\S+)\s+--+>\s+(\S+)/;

  for (const block of text.split(/\n\n+/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) continue;
    let i = 0;
    if (/^WEBVTT/.test(lines[0]) || /^NOTE/.test(lines[0]) || /^STYLE/.test(lines[0])) continue;
    if (/^\d+$/.test(lines[0].trim())) i = 1; // SRT index line
    const tm = lines[i] && lines[i].match(timeLine);
    if (!tm) continue;
    const start = parseTimestamp(tm[1]);
    const end = parseTimestamp(tm[2]);
    if (start == null || end == null) continue;
    const body = cleanText(
      lines
        .slice(i + 1)
        .map((l) => l.replace(/^\s*[-–]\s*/, "")) // per-line dialogue dashes
        .join(" ")
    );
    cues.push({ start, end, text: body });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

// Cues with spoken text only (drops pure sound-effect/music lines).
export function spokenCues(cues) {
  return cues.filter((c) => c.text.length > 0);
}
