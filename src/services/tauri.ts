import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

/** Returned by stop_recording. The audio itself stays in Rust for transcribe_recording. */
export interface CaptureInfo {
  originalDurationSeconds: number;
  trimmedDurationSeconds: number;
  silenceTrimmedSeconds: number;
}

// Tauri command wrappers
export const tauriCommands = {
  async stopRecording(): Promise<CaptureInfo> {
    return await invoke<CaptureInfo>('stop_recording');
  },

  // Clipboard/selection
  async getSelectedText(): Promise<string> {
    return await invoke('get_selected_text');
  },

  // System audio control (reduce other apps' volume while recording)
  async reduceOtherAppsVolume(volumePercent: number): Promise<void> {
    await invoke('reduce_other_apps_volume', { volumePercent });
  },

  async restoreOtherAppsVolume(): Promise<void> {
    await invoke('restore_other_apps_volume');
  },

  // Open (or focus) the history window. Rust builds it from tauri.conf.json on first use.
  async openHistoryWindow(): Promise<void> {
    try {
      await invoke('open_window', { label: 'history' });
    } catch (error) {
      console.error('Error opening history window:', error);
    }
  },

  // Open (or focus) the garden easter egg window
  async openGardenWindow(): Promise<void> {
    try {
      await invoke('open_window', { label: 'garden' });
    } catch (error) {
      console.error('Error opening garden window:', error);
    }
  },
};

// Update utilities. Only official release builds include the updater (cargo
// feature `updater`); source builds and forks report it as unavailable and the
// update UI stays hidden.
let pendingUpdate: Update | null = null;
let updaterEnabled: Promise<boolean> | null = null;

export const updater = {
  isEnabled(): Promise<boolean> {
    if (!updaterEnabled) {
      updaterEnabled = invoke<boolean>('is_updater_enabled').catch(() => false);
    }
    return updaterEnabled;
  },

  async checkForUpdates(): Promise<{ available: boolean; version?: string; notes?: string; error?: string }> {
    if (!(await this.isEnabled())) return { available: false };
    try {
      const update = await check();
      pendingUpdate = update;
      if (update) {
        return { available: true, version: update.version, notes: update.body };
      }
      return { available: false };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn('[Updater] Update check failed:', errorMsg);
      return { available: false, error: errorMsg };
    }
  },

  async installUpdateAndRestart(): Promise<void> {
    const update = pendingUpdate ?? (await check());
    if (!update) throw new Error('No update available');
    await update.downloadAndInstall();
    await relaunch();
  },
};
