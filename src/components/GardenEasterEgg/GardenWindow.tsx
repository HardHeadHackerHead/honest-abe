import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import { useGardenStats } from './useGardenStats';
import GardenVisualization from './GardenVisualization';
import StageIndicator from './StageIndicator';
import WateringAnimation from './WateringAnimation';
import { DEV_MODE, GARDEN_STAGES, getStageForWords, getProgressToNextStage, getWordsToNextStage } from './gardenConstants';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function GardenWindowContent() {
  const { stats, isLoading, error, refetch } = useGardenStats();
  const [showWatering, setShowWatering] = useState(false);
  const [previousStage, setPreviousStage] = useState<number | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);

  // DEV MODE: Override word count for testing
  const [testWordCount, setTestWordCount] = useState<number | null>(null);
  const isTestMode = DEV_MODE && testWordCount !== null;

  // Calculate test stats when in test mode
  const displayStats = isTestMode && testWordCount !== null
    ? (() => {
        const currentStage = getStageForWords(testWordCount);
        const stage = GARDEN_STAGES[currentStage];
        const isMaxStage = currentStage >= GARDEN_STAGES.length - 1;
        return {
          totalWords: testWordCount,
          currentStage,
          stageName: stage.name,
          stageDescription: stage.description,
          wordsToNextStage: getWordsToNextStage(testWordCount, currentStage),
          progressPercent: getProgressToNextStage(testWordCount, currentStage),
          isMaxStage,
          nextStageName: isMaxStage ? null : GARDEN_STAGES[currentStage + 1].name,
          transcriptionCount: 0,
        };
      })()
    : stats;

  // Listen for transcription events to trigger watering animation
  useEffect(() => {
    const unlisten = listen('transcription-added', () => {
      setShowWatering(true);
      refetch();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refetch]);

  // Hide the celebration after 3 seconds
  useEffect(() => {
    if (!showCelebration) return;
    const timer = setTimeout(() => setShowCelebration(false), 3000);
    return () => clearTimeout(timer);
  }, [showCelebration]);

  // Check for stage-up celebration
  useEffect(() => {
    if (displayStats && previousStage !== null && displayStats.currentStage > previousStage) {
      setShowCelebration(true);
    }
    if (displayStats) {
      setPreviousStage(displayStats.currentStage);
    }
  }, [displayStats?.currentStage]);

  const handleWateringComplete = () => {
    setShowWatering(false);
  };

  if (isLoading) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 animate-pulse">Loading your garden...</div>
      </div>
    );
  }

  if (error || !displayStats) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-400 mb-4">Failed to load garden data</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-900 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-semibold text-white text-center">
          Your Transcription Garden
          {isTestMode && <span className="text-yellow-400 text-xs ml-2">(TEST MODE)</span>}
        </h1>
        <p className="text-sm text-gray-400 text-center mt-1">
          {displayStats.totalWords.toLocaleString()} words transcribed
        </p>
      </header>

      {/* DEV MODE: Test Controls */}
      {DEV_MODE && (
        <div className="px-4 py-2 bg-yellow-900/30 border-b border-yellow-800/50">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <span className="text-yellow-400 text-xs">Test:</span>
            <button
              onClick={() => setTestWordCount(0)}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-white"
            >
              Reset (0)
            </button>
            <button
              onClick={() => setTestWordCount((prev) => (prev ?? displayStats.totalWords) + 10)}
              className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 rounded text-white"
            >
              +10 words
            </button>
            <button
              onClick={() => {
                setTestWordCount((prev) => (prev ?? displayStats.totalWords) + 10);
                setShowWatering(true);
              }}
              className="px-2 py-1 text-xs bg-green-700 hover:bg-green-600 rounded text-white"
            >
              +10 & Water
            </button>
            {isTestMode && (
              <button
                onClick={() => setTestWordCount(null)}
                className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 rounded text-white"
              >
                Use Real Data
              </button>
            )}
          </div>
        </div>
      )}

      {/* Garden visualization */}
      <main className="flex-1 relative overflow-hidden">
        <GardenVisualization
          stage={displayStats.currentStage}
          totalWords={displayStats.totalWords}
          progressPercent={displayStats.progressPercent}
        />

        {showWatering && (
          <WateringAnimation onComplete={handleWateringComplete} />
        )}

        {showCelebration && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="text-4xl animate-bounce">
              <span className="text-green-400">Level Up!</span>
            </div>
          </div>
        )}
      </main>

      {/* Stage indicator */}
      <footer className="p-4 border-t border-gray-800">
        <StageIndicator
          stageName={displayStats.stageName}
          stageDescription={displayStats.stageDescription}
          progressPercent={displayStats.progressPercent}
          wordsToNextStage={displayStats.wordsToNextStage}
          nextStageName={displayStats.nextStageName}
          isMaxStage={displayStats.isMaxStage}
        />
      </footer>
    </div>
  );
}

export default function GardenWindow() {
  return (
    <QueryClientProvider client={queryClient}>
      <GardenWindowContent />
    </QueryClientProvider>
  );
}
