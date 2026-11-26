/**
 * Cold-start timing diagnostics.
 *
 * One timeline per stream request: `begin()` stamps t0 and every `mark()`
 * logs the elapsed time since then, so a single grep for `[timing]` shows
 * where a slow start spends its time (slot, P2P wake, first frame, muxer).
 * A stage is logged once per timeline unless marked `repeat` (codec or
 * parameter-set switches can happen several times in one session).
 */
export class StageTimeline {
  private t0 = 0;
  private label = "";
  private readonly seen = new Set<string>();

  constructor(
    private readonly log: (message: string) => void,
    private readonly maxAgeMs = 120_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** True while a timeline is open and younger than `maxAgeMs`. */
  isActive(): boolean {
    return this.t0 > 0 && this.now() - this.t0 < this.maxAgeMs;
  }

  /**
   * Open a timeline. If one is already open, the call is logged as a stage
   * of that timeline instead (a second viewer joining a start in progress).
   */
  begin(label: string): void {
    if (this.isActive()) {
      this.mark(label, undefined, { repeat: true });
      return;
    }
    this.t0 = this.now();
    this.label = label;
    this.seen.clear();
    this.log(`⏱️ [timing] +0ms ${label}`);
  }

  mark(
    stage: string,
    detail?: string,
    { repeat = false }: { repeat?: boolean } = {},
  ): void {
    if (!this.isActive()) return;
    if (!repeat && this.seen.has(stage)) return;
    this.seen.add(stage);
    const suffix = detail ? ` ${detail}` : "";
    this.log(`⏱️ [timing] +${this.now() - this.t0}ms ${stage}${suffix}`);
  }

  /** Close the timeline; later marks are dropped until the next `begin()`. */
  end(reason: string): void {
    if (!this.isActive()) {
      this.t0 = 0;
      return;
    }
    this.mark("end", `${reason} (${this.label})`, { repeat: true });
    this.t0 = 0;
  }
}
