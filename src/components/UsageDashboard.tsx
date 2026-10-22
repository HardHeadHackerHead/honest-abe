import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { localStats, UsageBucket } from '../services/localStats';
import { localHistory } from '../services/localHistory';
import { sessionHistory, SavedSession } from '../services/sessionHistory';
import { TRANSCRIPTION_PRICES_AS_OF } from '../constants';
import { FileText, Clock, Gauge, Hash, Sparkles, TrendingUp, Timer, CheckCircle, History, ChevronLeft } from 'lucide-react';

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const totalMinutes = seconds / 60;
  if (totalMinutes < 60) {
    const mins = Math.floor(totalMinutes);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const totalHours = totalMinutes / 60;
  if (totalHours < 24) {
    const hrs = Math.floor(totalHours);
    const mins = Math.round(totalMinutes % 60);
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  const days = Math.floor(totalHours / 24);
  const hrs = Math.round(totalHours % 24);
  return hrs > 0 ? `${days}d ${hrs}h` : `${days}d`;
}

type UsageTab = 'session' | 'month' | 'allTime';

// Typing speed used to estimate time saved
const TYPING_WPM = 40;

function bucketStats(bucket: UsageBucket | undefined) {
  const words = bucket?.words ?? 0;
  const seconds = bucket?.seconds ?? 0;
  const minutes = seconds / 60;
  return {
    totalWords: words,
    timeSavedMinutes: Math.max(0, words / TYPING_WPM - minutes),
    wordsPerMinute: minutes > 0 ? words / minutes : 0,
    transcriptionCount: bucket?.count ?? 0,
    totalSeconds: seconds,
  };
}

interface UsageDashboardProps {
  sessionStart: string;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent?: 'tertiary' | 'primary';
}

function MetricCard({ label, value, sub, icon: Icon, accent = 'tertiary' }: MetricCardProps) {
  const valueColor = accent === 'tertiary' ? 'text-tertiary' : 'text-primary';
  const iconColor = accent === 'tertiary' ? 'text-tertiary/[0.03]' : 'text-primary/[0.03]';
  const bgClass = accent === 'tertiary'
    ? 'bg-surface-container hover:bg-surface-container-high'
    : 'bg-surface-container-low hover:bg-surface-container ghost-border';

  return (
    <div className={`${bgClass} rounded-lg p-3 transition-all group relative overflow-hidden`}>
      <Icon className={`absolute -right-2 -top-2 w-12 h-12 ${iconColor} pointer-events-none group-hover:scale-110 transition-transform`} />
      <p className="label-style text-on-surface-variant mb-1 text-[10px]">{label}</p>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-xl font-extrabold ${valueColor}`}>{value}</span>
        {sub && <span className="text-[9px] text-on-surface-variant">{sub}</span>}
      </div>
    </div>
  );
}

function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatSessionTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatSessionRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const sameDay = s.toDateString() === e.toDateString();
  if (sameDay) {
    return `${formatSessionTime(start)} – ${formatSessionTime(end)}`;
  }
  return `${formatSessionDate(start)} ${formatSessionTime(start)} – ${formatSessionDate(end)} ${formatSessionTime(end)}`;
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatPriceDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function UsageDashboard({ sessionStart }: UsageDashboardProps) {
  const [activeTab, setActiveTab] = useState<UsageTab>('session');
  const [showPreviousSessions, setShowPreviousSessions] = useState(false);
  const [selectedSession, setSelectedSession] = useState<SavedSession | null>(null);

  const { data: history } = useQuery({
    queryKey: ['transcription-history'],
    queryFn: () => localHistory.getHistory(),
  });

  // Local aggregates (month and all time). Invalidated via ['usage'] after each transcription/transform.
  const { data: usage } = useQuery({
    queryKey: ['usage'],
    queryFn: () => {
      const stats = localStats.get();
      return { month: localStats.getMonth(), allTime: stats.total };
    },
  });

  const { data: savedSessions } = useQuery({
    queryKey: ['session-history'],
    queryFn: () => sessionHistory.getSessions(),
  });

  // Session stats from local history (transcriptions since app opened)
  const sessionRecords = history?.filter(record =>
    new Date(record.timestamp) >= new Date(sessionStart)
  ) || [];

  const sessionStats = {
    totalWords: sessionRecords.reduce((sum, r) => sum + (r.wordCount || 0), 0),
    totalSeconds: sessionRecords.reduce((sum, r) => sum + (r.durationSeconds || 0), 0),
    transcriptionCount: sessionRecords.length,
  };
  const sessionMinutes = sessionStats.totalSeconds / 60;
  const sessionWPM = sessionMinutes > 0 ? sessionStats.totalWords / sessionMinutes : 0;
  const sessionTimeSavedMinutes = Math.max(0, (sessionStats.totalWords / TYPING_WPM) - sessionMinutes);

  // Get stats based on active tab
  const getDisplayStats = () => {
    if (activeTab === 'session' && selectedSession) {
      const mins = selectedSession.totalSeconds / 60;
      const wpm = mins > 0 ? selectedSession.totalWords / mins : 0;
      const timeSaved = Math.max(0, (selectedSession.totalWords / TYPING_WPM) - mins);
      return {
        totalWords: selectedSession.totalWords,
        timeSavedMinutes: timeSaved,
        wordsPerMinute: wpm,
        transcriptionCount: selectedSession.transcriptionCount,
        totalSeconds: selectedSession.totalSeconds,
      };
    }
    if (activeTab === 'session') {
      return {
        totalWords: sessionStats.totalWords,
        timeSavedMinutes: sessionTimeSavedMinutes,
        wordsPerMinute: sessionWPM,
        transcriptionCount: sessionStats.transcriptionCount,
        totalSeconds: sessionStats.totalSeconds,
      };
    }
    return bucketStats(activeTab === 'month' ? usage?.month : usage?.allTime);
  };

  const displayStats = getDisplayStats();

  // Estimated provider cost; previous sessions don't record it
  const costUsd = activeTab === 'session'
    ? (selectedSession ? undefined : sessionRecords.reduce((sum, r) => sum + (r.costUsd || 0), 0))
    : (activeTab === 'month' ? usage?.month : usage?.allTime)?.costUsd ?? 0;

  // Transform stats come from the local aggregates (sessions don't track transforms)
  const transformBucket = activeTab === 'month' ? usage?.month : usage?.allTime;
  const transformUsage = activeTab === 'session' ? undefined : transformBucket && {
    transformCount: transformBucket.transforms,
    totalWordsTransformed: transformBucket.transformWords,
    timeSavedMinutes: transformBucket.transformWords / TYPING_WPM,
  };

  return (
    <div className="space-y-3">
      {/* Header + Segmented Control */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold tracking-tight text-on-surface">Usage</h2>
        <div className="bg-surface-container-low p-0.5 rounded-md flex items-center gap-0.5">
          {(['session', 'month', 'allTime'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSelectedSession(null); setShowPreviousSessions(false); }}
              className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-all ${
                activeTab === tab
                  ? 'bg-surface-container-high text-primary shadow-ambient-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {tab === 'session' ? 'Session' : tab === 'month' ? 'Month' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Selected previous session banner */}
      {activeTab === 'session' && selectedSession && (
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2">
          <button
            onClick={() => { setSelectedSession(null); setShowPreviousSessions(false); }}
            className="p-0.5 rounded hover:bg-surface-container-high transition-colors text-on-surface-variant hover:text-on-surface"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-on-surface truncate">
              {formatSessionDate(selectedSession.startTime)}
            </p>
            <p className="text-[10px] text-on-surface-variant">
              {formatSessionRange(selectedSession.startTime, selectedSession.endTime)}
            </p>
          </div>
        </div>
      )}

      {/* Transcription Section */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-4 bg-tertiary rounded-full" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Transcription</h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            label="Total Words"
            value={displayStats.totalWords.toLocaleString()}
            icon={FileText}
          />
          <MetricCard
            label="Time Saved"
            value={formatDuration(displayStats.timeSavedMinutes * 60)}
            icon={Clock}
          />
          <MetricCard
            label="Avg WPM"
            value={Math.round(displayStats.wordsPerMinute)}
            sub="words/min"
            icon={Gauge}
          />
          <MetricCard
            label="Count"
            value={displayStats.transcriptionCount}
            sub="transcripts"
            icon={Hash}
          />
        </div>
        {costUsd !== undefined && (
          <div className="mt-2 flex items-center justify-between gap-3 bg-surface-container rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-[11px] text-on-surface">Estimated provider cost</p>
              <p className="text-[9px] text-outline leading-tight">
                An estimate from list prices as of {formatPriceDate(TRANSCRIPTION_PRICES_AS_OF)}. Your provider's bill is
                what counts. Local transcription is free; custom servers aren't estimated.
              </p>
            </div>
            <span className="text-sm font-bold text-on-surface font-mono flex-shrink-0">{formatCost(costUsd)}</span>
          </div>
        )}
      </section>

      {/* Transformation Section */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-4 bg-primary rounded-full" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Transformation</h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            label="Words Transformed"
            value={(transformUsage?.totalWordsTransformed || 0).toLocaleString()}
            icon={Sparkles}
            accent="primary"
          />
          <MetricCard
            label="Time Saved"
            value={formatDuration((transformUsage?.timeSavedMinutes || 0) * 60)}
            icon={TrendingUp}
            accent="primary"
          />
          <MetricCard
            label="Transforms"
            value={transformUsage?.transformCount || 0}
            icon={Timer}
            accent="primary"
          />
          <MetricCard
            label="Avg Words"
            value={transformUsage?.transformCount
              ? Math.round((transformUsage.totalWordsTransformed || 0) / transformUsage.transformCount)
              : 0}
            sub="per transform"
            icon={CheckCircle}
            accent="primary"
          />
        </div>
      </section>

      {/* Previous Sessions — only on Session tab */}
      {activeTab === 'session' && !selectedSession && (
        <section>
          {!showPreviousSessions ? (
            <button
              onClick={() => setShowPreviousSessions(true)}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors"
            >
              <History className="w-3.5 h-3.5 text-on-surface-variant" />
              <span className="text-xs font-bold text-on-surface-variant">Previous Sessions</span>
              {savedSessions && savedSessions.length > 0 && (
                <span className="text-[10px] text-outline">({savedSessions.length})</span>
              )}
            </button>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowPreviousSessions(false)}
                    className="p-0.5 rounded hover:bg-surface-container-high transition-colors text-on-surface-variant hover:text-on-surface"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Previous Sessions</h3>
                </div>
              </div>
              {(!savedSessions || savedSessions.length === 0) ? (
                <p className="text-xs text-outline text-center py-4">No previous sessions yet</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-hide">
                  {savedSessions.map((session) => {
                    const mins = session.totalSeconds / 60;
                    const wpm = mins > 0 ? Math.round(session.totalWords / mins) : 0;
                    const timeSaved = Math.max(0, (session.totalWords / TYPING_WPM) - mins);
                    return (
                    <button
                      key={session.id}
                      onClick={() => setSelectedSession(session)}
                      className="w-full text-left bg-surface-container hover:bg-surface-container-high rounded-lg px-3 py-2 transition-all group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-on-surface">
                            {formatSessionDate(session.startTime)}
                          </p>
                          <p className="text-[10px] text-on-surface-variant">
                            {formatSessionRange(session.startTime, session.endTime)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="text-right">
                            <p className="text-xs font-bold text-tertiary">{session.totalWords.toLocaleString()}</p>
                            <p className="text-[9px] text-outline">words</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold text-on-surface-variant">{session.transcriptionCount}</p>
                            <p className="text-[9px] text-outline">transcripts</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold text-on-surface-variant">{formatDuration(timeSaved * 60)}</p>
                            <p className="text-[9px] text-outline">saved</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold text-on-surface-variant">{wpm}</p>
                            <p className="text-[9px] text-outline">wpm</p>
                          </div>
                        </div>
                      </div>
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
