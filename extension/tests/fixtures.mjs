// Shared synthetic episode: 42 minutes, six scenes with distinct vocabulary,
// cue density resembling real captions. The "correct" natural stop is the
// 40-second scene break at 2300s, right before the closing-hook scene.

export const DURATION = 2520;

export const SCENE_SPECS = [
  {
    start: 0,
    end: 300,
    lines: [
      "Marta, the bakery can't survive another month like this.",
      "The flour supplier doubled his prices again, Marta.",
      "I will not close this bakery, not after twenty years.",
    ],
  },
  {
    start: 320,
    end: 700,
    lines: [
      "Detective Reyes, the warehouse was emptied overnight.",
      "Any witnesses to the robbery downtown?",
      "Reyes, the security footage is gone too.",
    ],
  },
  {
    start: 715,
    end: 1200,
    lines: [
      "Wait... there's a ledger hidden beneath the counter.",
      "Marta, these numbers... the supplier is laundering through us.",
      "This ledger links him to the warehouse robbery.",
    ],
  },
  {
    start: 1230,
    end: 1800,
    lines: [
      "It's over. Reyes has the ledger, we recovered everything.",
      "You confronted the supplier alone? He could have hurt you.",
      "The evidence is solid. He's done.",
    ],
  },
  {
    start: 1820,
    end: 2300,
    lines: [
      "To Marta! The bakery reopens, the whole neighborhood is here!",
      "I couldn't have done it without all of you celebrating with me.",
      "Best bread in the city, everyone says so.",
    ],
  },
  {
    start: 2340,
    end: 2480,
    lines: [
      "Who is that out there in the parked car?",
      "He's been watching the bakery all night, holding a photograph.",
    ],
  },
];

export const SUMMARY =
  "Marta struggles to keep her bakery open while arguing with her flour " +
  "supplier over prices. Meanwhile, Detective Reyes investigates a warehouse " +
  "robbery downtown with no witnesses. While cleaning, Marta finds a hidden " +
  "ledger beneath the counter linking the supplier to the robbery. Reyes " +
  "confronts the supplier and recovers the evidence. The neighborhood " +
  "celebrates the bakery's reopening. The episode ends as a stranger watches " +
  "the bakery from a parked car, holding a photograph.";

// Each line becomes two cues (line + filler back-channel) so cue counts and
// in-scene spacing resemble real caption tracks.
export function makeCues(specs = SCENE_SPECS) {
  const cues = [];
  for (const s of specs) {
    const step = (s.end - s.start) / s.lines.length;
    s.lines.forEach((text, i) => {
      const a = s.start + i * step;
      const mid = a + step / 2;
      cues.push({ start: a, end: mid - 1, text });
      cues.push({
        start: mid,
        end: Math.min(s.end, a + step - 1),
        text: "Yeah. Okay.",
      });
    });
  }
  return cues;
}
