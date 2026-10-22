/**
 * Recording state machine shared by dictation and transform (F2, F6).
 *
 * Hotkey presses and releases only set what the user wants (recording or not).
 * One loop at a time then moves the real state towards it, awaiting each step,
 * so a quick tap can never leave the microphone on: if the key is released
 * while recording is still starting, the stop runs as soon as the start is done.
 *
 * The microphone has one owner at a time. Dictation, transform and the
 * onboarding mic test can't record at the same time.
 */

export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'stopping';

export interface RecordingMachineHandlers {
  /** Open the mic. Return false (or throw) if recording didn't start. Must clean up after itself on failure. */
  start(): Promise<boolean>;
  /** Close the mic and handle the result. Called only after a successful start. */
  stop(): Promise<void>;
  /** Called on every phase change */
  onPhase?(phase: RecordingPhase): void;
  /** Called when a start was refused because another recorder holds the mic */
  onBusy?(owner: string): void;
}

export interface RecordingMachine {
  /** Ask for recording on or off. Requests to start while still stopping are ignored. */
  request(want: boolean): void;
  /** Toggle-mode press: start when idle, stop when starting or recording */
  toggle(): void;
  readonly phase: RecordingPhase;
  /** Resolves once the machine is idle and nothing more is queued */
  settled(): Promise<void>;
}

let micOwner: string | null = null;

/** Claim the microphone. Returns false if someone else has it. */
export function acquireMic(owner: string): boolean {
  if (micOwner !== null && micOwner !== owner) return false;
  micOwner = owner;
  return true;
}

export function releaseMic(owner: string): void {
  if (micOwner === owner) micOwner = null;
}

export function currentMicOwner(): string | null {
  return micOwner;
}

export function createRecordingMachine(owner: string, handlers: RecordingMachineHandlers): RecordingMachine {
  let phase: RecordingPhase = 'idle';
  let want = false;
  let running: Promise<void> | null = null;

  const setPhase = (next: RecordingPhase) => {
    phase = next;
    handlers.onPhase?.(next);
  };

  const step = async (): Promise<boolean> => {
    if (want && phase === 'idle') {
      if (!acquireMic(owner)) {
        want = false;
        handlers.onBusy?.(micOwner ?? 'unknown');
        return false;
      }
      setPhase('starting');
      let started = false;
      try {
        started = await handlers.start();
      } catch (error) {
        console.error(`[${owner}] Failed to start recording:`, error);
      }
      if (started) {
        setPhase('recording');
      } else {
        want = false;
        releaseMic(owner);
        setPhase('idle');
      }
      return true;
    }
    if (!want && phase === 'recording') {
      setPhase('stopping');
      try {
        await handlers.stop();
      } catch (error) {
        console.error(`[${owner}] Failed to stop recording:`, error);
      } finally {
        releaseMic(owner);
        setPhase('idle');
      }
      return true;
    }
    return false;
  };

  const pump = () => {
    if (running) return;
    running = (async () => {
      try {
        while (await step()) {
          // keep going until the state matches what was asked for
        }
      } finally {
        running = null;
      }
    })();
  };

  const request = (next: boolean) => {
    // A press while the last recording is still being processed is dropped,
    // rather than starting a new recording out of the blue once it finishes
    if (next && phase === 'stopping') return;
    want = next;
    pump();
  };

  return {
    request,
    toggle() {
      if (phase === 'stopping') return;
      request(phase === 'idle');
    },
    get phase() {
      return phase;
    },
    async settled() {
      while (running) await running;
    },
  };
}
