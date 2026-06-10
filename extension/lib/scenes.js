// Scene segmentation from subtitle timing.
//
// Long silences between spoken lines are where scene cuts, location changes,
// and act breaks live — they are measured from the episode itself. A "scene"
// here is a run of dialogue between two such silences.

import { spokenCues } from "./subtitles.js";

// Minimum dialogue silence treated as a scene boundary. This is a signal-
// processing parameter (how big a silence counts as a break), not a content
// assumption about where stops belong.
export const SCENE_GAP_SECONDS = 8;

// Returns scenes: [{start, end, text, gapBefore}], ordered. gapBefore is the
// dialogue silence (seconds) separating this scene from the previous one.
export function segmentScenes(cues, gapSeconds = SCENE_GAP_SECONDS) {
  const spoken = spokenCues(cues);
  if (!spoken.length) return [];

  const scenes = [];
  let current = {
    start: spoken[0].start,
    end: spoken[0].end,
    parts: [spoken[0].text],
    gapBefore: 0,
  };

  for (let i = 1; i < spoken.length; i++) {
    const cue = spoken[i];
    const gap = cue.start - current.end;
    if (gap >= gapSeconds) {
      scenes.push(finish(current));
      current = { start: cue.start, end: cue.end, parts: [cue.text], gapBefore: gap };
    } else {
      current.end = Math.max(current.end, cue.end);
      current.parts.push(cue.text);
    }
  }
  scenes.push(finish(current));
  return scenes;

  function finish(s) {
    return { start: s.start, end: s.end, gapBefore: s.gapBefore, text: s.parts.join(" ") };
  }
}

// Candidate stopping boundaries, one per scene transition:
// {time (end of previous scene), nextSceneStart, gapSeconds}.
export function boundaries(scenes) {
  const out = [];
  for (let i = 1; i < scenes.length; i++) {
    out.push({
      time: scenes[i - 1].end,
      nextSceneStart: scenes[i].start,
      gapSeconds: scenes[i].gapBefore,
      sceneIndex: i,
    });
  }
  return out;
}
