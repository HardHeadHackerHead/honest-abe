import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRecordingMachine, acquireMic, releaseMic, currentMicOwner } from './recordingMachine';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

function machineWithLog(owner = 'dictation', startResult = true) {
  const log: string[] = [];
  const startGate = deferred();
  const machine = createRecordingMachine(owner, {
    start: async () => {
      log.push('start');
      await startGate.promise;
      log.push('started');
      return startResult;
    },
    stop: async () => {
      log.push('stop');
    },
  });
  return { machine, log, startGate };
}

afterEach(() => {
  const owner = currentMicOwner();
  if (owner) releaseMic(owner);
});

describe('recording machine', () => {
  it('stops after a quick tap released while still starting', async () => {
    const { machine, log, startGate } = machineWithLog();
    machine.request(true);
    machine.request(false); // released before start_recording resolved
    expect(machine.phase).toBe('starting');
    startGate.resolve();
    await machine.settled();
    expect(log).toEqual(['start', 'started', 'stop']);
    expect(machine.phase).toBe('idle');
    expect(currentMicOwner()).toBeNull();
  });

  it('runs one start and one stop for a normal press', async () => {
    const { machine, log, startGate } = machineWithLog();
    startGate.resolve();
    machine.request(true);
    machine.request(true); // repeated press events are harmless
    await machine.settled();
    expect(machine.phase).toBe('recording');
    machine.request(false);
    await machine.settled();
    expect(log).toEqual(['start', 'started', 'stop']);
  });

  it('never calls stop when the start failed', async () => {
    const { machine, log, startGate } = machineWithLog('dictation', false);
    startGate.resolve();
    machine.request(true);
    await machine.settled();
    machine.request(false);
    await machine.settled();
    expect(log).toEqual(['start', 'started']);
    expect(machine.phase).toBe('idle');
    expect(currentMicOwner()).toBeNull();
  });

  it('treats a throwing start as not started', async () => {
    const machine = createRecordingMachine('dictation', {
      start: async () => { throw new Error('no mic'); },
      stop: vi.fn(async () => {}),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    machine.request(true);
    await machine.settled();
    expect(machine.phase).toBe('idle');
    expect(currentMicOwner()).toBeNull();
  });

  it('ignores presses while the last recording is processing', async () => {
    const stopGate = deferred();
    let starts = 0;
    const machine = createRecordingMachine('dictation', {
      start: async () => { starts++; return true; },
      stop: () => stopGate.promise,
    });
    machine.request(true);
    await machine.settled();
    machine.request(false);
    await Promise.resolve();
    expect(machine.phase).toBe('stopping');
    machine.request(true);
    machine.toggle();
    stopGate.resolve();
    await machine.settled();
    expect(starts).toBe(1);
    expect(machine.phase).toBe('idle');
  });

  it('toggles', async () => {
    const { machine, log, startGate } = machineWithLog();
    startGate.resolve();
    machine.toggle();
    await machine.settled();
    expect(machine.phase).toBe('recording');
    machine.toggle();
    await machine.settled();
    expect(machine.phase).toBe('idle');
    expect(log).toEqual(['start', 'started', 'stop']);
  });

  it('keeps dictation and transform from recording at the same time', async () => {
    const onBusy = vi.fn();
    const dictation = createRecordingMachine('dictation', { start: async () => true, stop: async () => {} });
    const transform = createRecordingMachine('transform', { start: async () => true, stop: async () => {}, onBusy });

    dictation.request(true);
    await dictation.settled();
    transform.request(true);
    await transform.settled();
    expect(transform.phase).toBe('idle');
    expect(onBusy).toHaveBeenCalledWith('dictation');

    dictation.request(false);
    await dictation.settled();
    transform.request(true);
    await transform.settled();
    expect(transform.phase).toBe('recording');
  });

  it('mic lock', () => {
    expect(acquireMic('a')).toBe(true);
    expect(acquireMic('a')).toBe(true);
    expect(acquireMic('b')).toBe(false);
    releaseMic('b');
    expect(currentMicOwner()).toBe('a');
    releaseMic('a');
    expect(acquireMic('b')).toBe(true);
  });
});
