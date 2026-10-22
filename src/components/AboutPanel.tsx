import { useState, useEffect } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Heart, Github, Globe, Bug, RefreshCw } from 'lucide-react';
import { getAppVersion, openIssueReport } from '../services/appInfo';
import { updater } from '../services/tauri';
import { DONATE_URL, GITHUB_REPO_URL, WEBSITE_URL } from '../constants';

type UpdateState =
  | { status: 'idle' | 'checking' | 'up-to-date' | 'installing' }
  | { status: 'available'; version?: string }
  | { status: 'error'; message: string };

export default function AboutPanel() {
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });
  const [updaterEnabled, setUpdaterEnabled] = useState(false);

  useEffect(() => {
    getAppVersion().then(setVersion);
    updater.isEnabled().then(setUpdaterEnabled);
  }, []);

  const handleCheckForUpdate = async () => {
    setUpdate({ status: 'checking' });
    const result = await updater.checkForUpdates();
    if (result.available) {
      setUpdate({ status: 'available', version: result.version });
    } else if (result.error) {
      setUpdate({ status: 'error', message: 'Update check failed' });
    } else {
      setUpdate({ status: 'up-to-date' });
    }
  };

  const handleInstallUpdate = async () => {
    setUpdate({ status: 'installing' });
    try {
      await updater.installUpdateAndRestart();
    } catch (err) {
      console.error('[About] Update install failed:', err);
      setUpdate({ status: 'error', message: 'Update failed' });
    }
  };

  const linkClass = 'w-full flex items-center gap-2 py-2 px-3 bg-surface-container-high/50 rounded-xl hover:bg-surface-container-high transition-colors text-xs text-on-surface';

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-on-surface">About</h2>
        <p className="text-on-surface-variant text-sm">Free, open-source voice typing</p>
      </div>

      <div className="bg-surface-container rounded-xl p-3 space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-bold text-primary">Abe</span>
          <span className="text-xs font-mono text-on-surface-variant">v{version}</span>
        </div>
        <p className="text-[11px] text-on-surface-variant">
          Licensed under AGPL-3.0-or-later. No accounts, no servers, no telemetry.
        </p>
        {/* Only official release builds ship the updater */}
        {updaterEnabled && (
          <div className="pt-1">
            {update.status === 'available' ? (
              <button
                onClick={handleInstallUpdate}
                className="text-[11px] text-primary hover:underline"
              >
                Install v{update.version} and restart
              </button>
            ) : (
              <button
                onClick={handleCheckForUpdate}
                disabled={update.status === 'checking' || update.status === 'installing'}
                className="flex items-center gap-1 text-[11px] text-on-surface-variant hover:text-on-surface disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${update.status === 'checking' ? 'animate-spin' : ''}`} />
                {update.status === 'checking' ? 'Checking...' :
                 update.status === 'installing' ? 'Installing...' :
                 update.status === 'up-to-date' ? "You're up to date" :
                 update.status === 'error' ? update.message :
                 'Check for updates'}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="bg-surface-container rounded-xl p-3 space-y-2">
        <p className="text-xs text-on-surface-variant">
          Abe is built in the open and funded by people who use it. If it saves you time, consider chipping in.
        </p>
        <button
          onClick={() => openUrl(DONATE_URL)}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-xl gradient-primary text-on-primary font-bold text-sm hover:brightness-110 transition-all"
        >
          <Heart className="w-4 h-4" />
          Support Abe
        </button>
      </div>

      <div className="bg-surface-container rounded-xl p-3 space-y-1.5">
        <button onClick={() => openUrl(GITHUB_REPO_URL)} className={linkClass}>
          <Github className="w-3.5 h-3.5 text-primary" />
          Source code on GitHub
        </button>
        <button onClick={() => openUrl(WEBSITE_URL)} className={linkClass}>
          <Globe className="w-3.5 h-3.5 text-primary" />
          getabe.app
        </button>
        <button onClick={() => openIssueReport()} className={linkClass}>
          <Bug className="w-3.5 h-3.5 text-primary" />
          Report an issue
        </button>
      </div>
    </div>
  );
}
