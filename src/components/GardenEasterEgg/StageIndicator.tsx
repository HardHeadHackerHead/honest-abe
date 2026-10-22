interface StageIndicatorProps {
  stageName: string;
  stageDescription: string;
  progressPercent: number;
  wordsToNextStage: number | null;
  nextStageName: string | null;
  isMaxStage: boolean;
}

export default function StageIndicator({
  stageName,
  stageDescription,
  progressPercent,
  wordsToNextStage,
  nextStageName,
  isMaxStage,
}: StageIndicatorProps) {
  return (
    <div className="space-y-4">
      {/* Current stage with icon */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 mb-1">
          <span className="text-xl">{getStageEmoji(stageName)}</span>
          <h2 className="text-xl font-bold bg-gradient-to-r from-green-400 to-emerald-300 bg-clip-text text-transparent">
            {stageName}
          </h2>
        </div>
        <p className="text-sm text-gray-400 italic">&ldquo;{stageDescription}&rdquo;</p>
      </div>

      {/* Progress bar */}
      {!isMaxStage && (
        <div className="space-y-2">
          {/* Progress bar container */}
          <div className="relative h-3 bg-gray-800 rounded-full overflow-hidden border border-gray-700">
            {/* Background pattern */}
            <div className="absolute inset-0 opacity-20">
              <div className="h-full w-full bg-gradient-to-r from-transparent via-gray-600 to-transparent" />
            </div>

            {/* Progress fill */}
            <div
              className="relative h-full rounded-full transition-all duration-700 ease-out overflow-hidden"
              style={{ width: `${progressPercent}%` }}
            >
              {/* Main gradient */}
              <div className="absolute inset-0 bg-gradient-to-r from-green-600 via-green-500 to-emerald-400" />

              {/* Shine effect */}
              <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent" />

              {/* Animated shimmer */}
              <div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"
                style={{ backgroundSize: '200% 100%' }}
              />
            </div>

            {/* Glow at the end of progress */}
            {progressPercent > 5 && (
              <div
                className="absolute top-0 bottom-0 w-2 bg-emerald-300 blur-sm"
                style={{ left: `calc(${progressPercent}% - 4px)` }}
              />
            )}
          </div>

          {/* Progress text */}
          <div className="flex justify-between items-center text-xs">
            <span className="text-emerald-400 font-medium">
              {Math.round(progressPercent)}% complete
            </span>
            <span className="text-gray-500">
              <span className="text-gray-400 font-medium">{wordsToNextStage?.toLocaleString()}</span>
              {' '}words to{' '}
              <span className="text-emerald-400">{nextStageName}</span>
            </span>
          </div>
        </div>
      )}

      {/* Max stage celebration */}
      {isMaxStage && (
        <div className="text-center py-3">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-yellow-900/30 to-amber-900/30 border border-yellow-700/50">
            <span className="text-lg animate-bounce">&#127942;</span>
            <span className="text-yellow-400 font-medium">
              Legendary Transcriber!
            </span>
            <span className="text-lg animate-bounce" style={{ animationDelay: '0.1s' }}>&#127942;</span>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            You&apos;ve reached the highest level
          </p>
        </div>
      )}

      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .animate-shimmer {
          animation: shimmer 2s linear infinite;
        }
      `}</style>
    </div>
  );
}

function getStageEmoji(stageName: string): string {
  const emojis: Record<string, string> = {
    'Empty Plot': '\u{1FAA8}', // Rock emoji (closest to dirt)
    'Planted Seed': '\u{1F331}', // Seedling
    'Tiny Sprout': '\u{1F33F}', // Herb
    'First Flower': '\u{1F337}', // Tulip
    'Garden Patch': '\u{1F33B}', // Sunflower
    'Lush Garden': '\u{1F490}', // Bouquet
    'Paradise Garden': '\u{1F3C6}', // Trophy
  };
  return emojis[stageName] || '\u{1F331}';
}
