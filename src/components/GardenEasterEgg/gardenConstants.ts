export interface GardenStage {
  threshold: number;
  name: string;
  description: string;
}

// DEV_MODE: Set to true for low thresholds during testing
export const DEV_MODE = false;

export const GARDEN_STAGES: GardenStage[] = DEV_MODE
  ? [
      { threshold: 0, name: 'Empty Plot', description: 'Every journey begins somewhere...' },
      { threshold: 5, name: 'Planted Seed', description: 'A seed of potential!' },
      { threshold: 15, name: 'Tiny Sprout', description: 'Life finds a way.' },
      { threshold: 30, name: 'First Flower', description: 'Beauty is blooming!' },
      { threshold: 50, name: 'Garden Patch', description: 'Growing stronger each day.' },
      { threshold: 80, name: 'Lush Garden', description: 'A testament to your voice.' },
      { threshold: 100, name: 'Paradise Garden', description: 'Legendary transcriber!' },
    ]
  : [
      { threshold: 0, name: 'Empty Plot', description: 'Every journey begins somewhere...' },
      { threshold: 100, name: 'Planted Seed', description: 'A seed of potential!' },
      { threshold: 500, name: 'Tiny Sprout', description: 'Life finds a way.' },
      { threshold: 2000, name: 'First Flower', description: 'Beauty is blooming!' },
      { threshold: 10000, name: 'Garden Patch', description: 'Growing stronger each day.' },
      { threshold: 50000, name: 'Lush Garden', description: 'A testament to your voice.' },
      { threshold: 100000, name: 'Paradise Garden', description: 'Legendary transcriber!' },
    ];

export function getStageForWords(totalWords: number): number {
  for (let i = GARDEN_STAGES.length - 1; i >= 0; i--) {
    if (totalWords >= GARDEN_STAGES[i].threshold) {
      return i;
    }
  }
  return 0;
}

export function getProgressToNextStage(totalWords: number, currentStage: number): number {
  if (currentStage >= GARDEN_STAGES.length - 1) {
    return 100;
  }

  const currentThreshold = GARDEN_STAGES[currentStage].threshold;
  const nextThreshold = GARDEN_STAGES[currentStage + 1].threshold;
  const progress = ((totalWords - currentThreshold) / (nextThreshold - currentThreshold)) * 100;

  return Math.min(Math.max(progress, 0), 100);
}

export function getWordsToNextStage(totalWords: number, currentStage: number): number | null {
  if (currentStage >= GARDEN_STAGES.length - 1) {
    return null;
  }

  return GARDEN_STAGES[currentStage + 1].threshold - totalWords;
}
