/*
 * SignDetector – simple start/stop detector for a stream of key‑point frames.
 *
 * The algorithm looks at the Euclidean distance between consecutive frames.
 * When motion exceeds a threshold for a few frames we consider a sign "started".
 * When motion stays below the threshold for a few frames we consider the sign "ended".
 *
 * The thresholds work well with the default WORD_FRAME_SIZE (258) and the
 * 30‑frame word model used in this project. Adjust them if your data is noisier
 * or the sign gesture is slower.
 */
export class SignDetector {
  private readonly motionThreshold: number;
  private readonly motionFrames: number;
  private readonly stillFrames: number;
  private motionCounter = 0;
  private stillCounter = 0;
  private isActive = false;

  /**
   * @param motionThreshold Normalised distance > this starts a sign.
   * @param motionFrames    Consecutive frames above threshold to trigger start.
   * @param stillFrames     Consecutive frames below threshold to trigger stop.
   */
  constructor(motionThreshold = 0.05, motionFrames = 3, stillFrames = 5) {
    this.motionThreshold = motionThreshold;
    this.motionFrames = motionFrames;
    this.stillFrames = stillFrames;
  }

  /**
   * Feed a new frame and get a boolean indicating whether the sign has just ended.
   */
  public feed(frame: Float32Array, previous: Float32Array | null): boolean {
    if (!previous) {
      // No previous frame – cannot compute motion yet.
      return false;
    }
    // Normalised L2 distance between the two frames.
    let diff = 0;
    for (let i = 0; i < frame.length; i++) {
      const d = frame[i] - previous[i];
      diff += d * d;
    }
    const distance = Math.sqrt(diff) / frame.length;

    if (distance > this.motionThreshold) {
      this.motionCounter++;
      this.stillCounter = 0;
    } else {
      this.stillCounter++;
      this.motionCounter = 0;
    }

    // Transition to active (sign started).
    if (!this.isActive && this.motionCounter >= this.motionFrames) {
      this.isActive = true;
      this.motionCounter = 0;
    }

    // Transition to inactive (sign ended).
    if (this.isActive && this.stillCounter >= this.stillFrames) {
      this.isActive = false;
      this.stillCounter = 0;
      return true; // Sign just finished.
    }
    return false;
  }

  /** Return true while a sign is being recorded. */
  public get active(): boolean {
    return this.isActive;
  }
}

