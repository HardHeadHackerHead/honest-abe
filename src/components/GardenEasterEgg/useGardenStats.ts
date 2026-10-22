import { useQuery } from '@tanstack/react-query';
import { localStats } from '../../services/localStats';
import { GARDEN_STAGES, getStageForWords, getProgressToNextStage, getWordsToNextStage } from './gardenConstants';

export interface GardenStats {
  totalWords: number;
  currentStage: number;
  stageName: string;
  stageDescription: string;
  wordsToNextStage: number | null;
  progressPercent: number;
  isMaxStage: boolean;
  nextStageName: string | null;
  transcriptionCount: number;
}

export function useGardenStats() {
  const query = useQuery({
    queryKey: ['garden-stats'],
    queryFn: () => {
      const { total } = localStats.get();
      return { totalWords: total.words, transcriptionCount: total.count };
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 30 * 1000, // Auto-refresh every 30 seconds
  });

  const stats: GardenStats | null = query.data
    ? (() => {
        const totalWords = query.data.totalWords || 0;
        const currentStage = getStageForWords(totalWords);
        const stage = GARDEN_STAGES[currentStage];
        const isMaxStage = currentStage >= GARDEN_STAGES.length - 1;

        return {
          totalWords,
          currentStage,
          stageName: stage.name,
          stageDescription: stage.description,
          wordsToNextStage: getWordsToNextStage(totalWords, currentStage),
          progressPercent: getProgressToNextStage(totalWords, currentStage),
          isMaxStage,
          nextStageName: isMaxStage ? null : GARDEN_STAGES[currentStage + 1].name,
          transcriptionCount: query.data.transcriptionCount || 0,
        };
      })()
    : null;

  return {
    stats,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
