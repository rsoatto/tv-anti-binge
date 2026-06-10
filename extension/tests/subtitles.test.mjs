import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSubtitles, spokenCues } from "../lib/subtitles.js";

const SRT = `1
00:00:05,000 --> 00:00:07,500
<i>Hello there.</i>

2
00:00:08,000 --> 00:00:10,000
- General Kenobi!
- You are bold.

3
00:00:30,000 --> 00:00:31,000
[dramatic music]
`;

const VTT = `WEBVTT

NOTE this is a comment

00:05.000 --> 00:07.500
Hello there.

00:01:08.000 --> 00:01:10.000
<v Speaker>Second line</v>
`;

test("parses SRT with tags, dashes, indices", () => {
  const cues = parseSubtitles(SRT);
  assert.equal(cues.length, 3);
  assert.equal(cues[0].start, 5);
  assert.equal(cues[0].end, 7.5);
  assert.equal(cues[0].text, "Hello there.");
  assert.equal(cues[1].text, "General Kenobi! You are bold.");
  assert.equal(cues[2].text, ""); // sound effect cleaned away
});

test("spokenCues drops sound-effect-only cues", () => {
  const cues = spokenCues(parseSubtitles(SRT));
  assert.equal(cues.length, 2);
});

test("parses WebVTT incl. short timestamps and voice tags", () => {
  const cues = parseSubtitles(VTT);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 5);
  assert.equal(cues[1].start, 68);
  assert.equal(cues[1].text, "Second line");
});

test("garbage input yields empty list", () => {
  assert.deepEqual(parseSubtitles("not a subtitle file"), []);
  assert.deepEqual(parseSubtitles(""), []);
});
