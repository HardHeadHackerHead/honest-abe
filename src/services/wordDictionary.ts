/**
 * Word Dictionary service for auto-correcting commonly mistranscribed words.
 *
 * Stores replacement mappings locally (localStorage). When a transcription comes in,
 * applyReplacements() swaps known mistranscriptions for their corrected forms.
 */

export interface DictionaryEntry {
  /** The mistranscribed word/phrase (stored lowercase for matching) */
  from: string;
  /** The correct replacement */
  to: string;
  /** ISO timestamp when entry was added */
  createdAt: string;
}

const STORAGE_KEY = 'abe_word_dictionary';

/**
 * Transfer the capitalization pattern from the original matched text onto the replacement.
 * - ALL CAPS → ALL CAPS replacement
 * - Title Case → Title Case replacement
 * - lowercase → replacement as-is (dictionary stores the preferred form)
 */
function matchCapitalization(original: string, replacement: string): string {
  // All uppercase: "HELLO" → "WORLD"
  if (original === original.toUpperCase() && original !== original.toLowerCase()) {
    return replacement.toUpperCase();
  }
  // First letter uppercase (title case): "Hello" → "World"
  if (
    original[0] === original[0].toUpperCase() &&
    original[0] !== original[0].toLowerCase() &&
    original.slice(1) === original.slice(1).toLowerCase()
  ) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  // Otherwise return as stored in dictionary
  return replacement;
}

/**
 * Replace every dictionary word in one pass, so a replacement is never
 * replaced again by a later entry (F11). Longer entries win over shorter ones
 * they overlap.
 *
 * A word starts and ends where no letter, digit or underscore continues it, in
 * any script: `\b` only knows ASCII, so "café" and "c++" never matched. The
 * leading boundary is a capture group because older WebKit has no lookbehind.
 */
export function applyDictionary(text: string, entries: DictionaryEntry[]): string {
  const byKey = new Map(
    entries.filter(e => e.from.length > 0).map(e => [e.from.toLowerCase(), e.to] as const),
  );
  if (byKey.size === 0 || !text) return text;

  const alternatives = [...byKey.keys()]
    .sort((a, b) => b.length - a.length)
    // Escape only syntax characters: the `u` flag rejects other escapes like `\-`
    .map(from => from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
    .join('|');
  const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])(${alternatives})(?![\\p{L}\\p{N}_])`, 'giu');

  return text.replace(regex, (_match, before: string, word: string) => {
    const to = byKey.get(word.toLowerCase());
    return before + (to === undefined ? word : matchCapitalization(word, to));
  });
}

function loadDictionary(): DictionaryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DictionaryEntry[];
  } catch {
    return [];
  }
}

function saveDictionary(entries: DictionaryEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

let cached: DictionaryEntry[] | null = null;

export const wordDictionary = {
  /**
   * Get all dictionary entries.
   */
  getDictionary(): DictionaryEntry[] {
    if (cached === null) {
      cached = loadDictionary();
    }
    return cached;
  },

  /**
   * Add a new replacement entry. If `from` already exists, updates it.
   */
  addEntry(from: string, to: string): DictionaryEntry {
    const entries = this.getDictionary();
    const normalizedFrom = from.toLowerCase().trim();

    const existing = entries.find(e => e.from === normalizedFrom);
    if (existing) {
      existing.to = to.trim();
      cached = entries;
      saveDictionary(entries);
      return existing;
    }

    const entry: DictionaryEntry = {
      from: normalizedFrom,
      to: to.trim(),
      createdAt: new Date().toISOString(),
    };
    entries.push(entry);
    cached = entries;
    saveDictionary(entries);
    return entry;
  },

  /**
   * Remove an entry by its `from` key.
   */
  removeEntry(from: string): boolean {
    const entries = this.getDictionary();
    const normalizedFrom = from.toLowerCase().trim();
    const index = entries.findIndex(e => e.from === normalizedFrom);
    if (index === -1) return false;
    entries.splice(index, 1);
    cached = entries;
    saveDictionary(entries);
    return true;
  },

  /**
   * Update an existing entry. Can change the replacement text and/or the from key.
   */
  updateEntry(from: string, newTo: string, newFrom?: string): boolean {
    const entries = this.getDictionary();
    const normalizedFrom = from.toLowerCase().trim();
    const entry = entries.find(e => e.from === normalizedFrom);
    if (!entry) return false;
    const normalizedNewFrom = newFrom === undefined ? normalizedFrom : newFrom.toLowerCase().trim();
    // Check for conflicts before changing anything (F11)
    if (!normalizedNewFrom) return false;
    if (normalizedNewFrom !== normalizedFrom && entries.some(e => e.from === normalizedNewFrom)) {
      return false; // Can't rename to an existing key
    }
    entry.to = newTo.trim();
    entry.from = normalizedNewFrom;
    cached = entries;
    saveDictionary(entries);
    return true;
  },

  /**
   * Apply all dictionary replacements to a transcription text.
   * Uses case-insensitive whole-word matching, preserving the original
   * capitalization pattern and surrounding punctuation.
   */
  applyReplacements(text: string): string {
    return applyDictionary(text, this.getDictionary());
  },

  /**
   * Diff two strings word-by-word and return changed pairs.
   * Used to detect user corrections for dictionary suggestions.
   */
  diffWords(original: string, edited: string): Array<{ from: string; to: string }> {
    const originalWords = original.trim().split(/\s+/);
    const editedWords = edited.trim().split(/\s+/);
    const changes: Array<{ from: string; to: string }> = [];

    // Simple positional diff — works well for single-word corrections
    const len = Math.min(originalWords.length, editedWords.length);
    for (let i = 0; i < len; i++) {
      if (originalWords[i].toLowerCase() !== editedWords[i].toLowerCase()) {
        // Strip trailing punctuation for the dictionary key
        const fromClean = originalWords[i].replace(/[.,!?;:]+$/, '');
        const toClean = editedWords[i].replace(/[.,!?;:]+$/, '');
        if (fromClean && toClean && fromClean.toLowerCase() !== toClean.toLowerCase()) {
          // Skip if this entry already exists in the dictionary
          const entries = this.getDictionary();
          const alreadyExists = entries.some(
            e => e.from === fromClean.toLowerCase() && e.to === toClean
          );
          if (!alreadyExists) {
            changes.push({ from: fromClean, to: toClean });
          }
        }
      }
    }

    return changes;
  },
};
