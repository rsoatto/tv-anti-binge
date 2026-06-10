// Player guard state machine (pure logic, no DOM — tested in node; driven by
// content.js against the real <video> element).
//
// armed ──t≥stopAt──> triggered ──[+5 min]──> snoozed ──t≥until──> triggered
//                        │
//                        ├─[finish episode]─> finishing ──t≥endBlockAt──> end-blocked
//                        └─[done tonight]───> done

export const END_BLOCK_SECONDS = 15; // pause this close to the end to beat autoplay

export class EpisodeGuard {
  constructor({ durationSeconds, stopAtSeconds }) {
    this.duration = durationSeconds;
    this.stopAt = Math.min(stopAtSeconds, durationSeconds - END_BLOCK_SECONDS);
    this.endBlockAt = durationSeconds - END_BLOCK_SECONDS;
    this.state = "armed";
    this.snoozeUntil = null;
  }

  // Call with the player's currentTime. Returns an action to perform now:
  // null | "stop-point" | "episode-end".
  check(t) {
    switch (this.state) {
      case "armed":
        if (t >= this.stopAt) {
          this.state = "triggered";
          return "stop-point";
        }
        return null;
      case "snoozed":
        if (t >= this.snoozeUntil) {
          this.state = "triggered";
          return "stop-point";
        }
        return null;
      case "finishing":
        if (t >= this.endBlockAt) {
          this.state = "end-blocked";
          return "episode-end";
        }
        return null;
      default:
        return null;
    }
  }

  snooze(t, seconds = 300) {
    // Never snooze past the end-block point — the guard still beats autoplay.
    this.snoozeUntil = Math.min(t + seconds, this.endBlockAt);
    this.state = "snoozed";
  }

  finishEpisode() {
    this.state = "finishing";
  }

  done() {
    this.state = "done";
  }

  secondsUntilStop(t) {
    if (this.state === "armed") return Math.max(0, this.stopAt - t);
    if (this.state === "snoozed") return Math.max(0, this.snoozeUntil - t);
    if (this.state === "finishing") return Math.max(0, this.endBlockAt - t);
    return null;
  }
}
