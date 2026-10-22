import { useState, useEffect } from 'react';
import { wordDictionary } from '../services/wordDictionary';
import { BookOpen, Check, X } from 'lucide-react';

export interface DictionarySuggestion {
  from: string;
  to: string;
}

interface DictionaryToastProps {
  suggestions: DictionarySuggestion[];
  onDismiss: () => void;
}

export default function DictionaryToast({ suggestions, onDismiss }: DictionaryToastProps) {
  // Indices the user has answered (accepted or dismissed)
  const [handled, setHandled] = useState<Set<number>>(new Set());

  // The first unanswered suggestion, derived rather than stored, so nothing
  // has to be corrected with a setState during render
  const currentIndex = suggestions.findIndex((_, i) => !handled.has(i));
  const current = currentIndex === -1 ? undefined : suggestions[currentIndex];
  const allHandled = currentIndex === -1;

  useEffect(() => {
    if (allHandled) {
      const timer = setTimeout(onDismiss, 600);
      return () => clearTimeout(timer);
    }
  }, [allHandled, onDismiss]);

  if (!current || allHandled) return null;

  const handleAccept = () => {
    wordDictionary.addEntry(current.from, current.to);
    setHandled(prev => new Set(prev).add(currentIndex));
  };

  const handleDismiss = () => {
    setHandled(prev => new Set(prev).add(currentIndex));
  };

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-4 fade-in duration-200">
      <div className="bg-surface-container-high rounded-2xl shadow-lg border border-outline-variant px-4 py-3 flex items-center gap-3 max-w-sm">
        <BookOpen className="w-4 h-4 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-on-surface-variant mb-1">Add to dictionary?</p>
          <p className="text-sm text-on-surface truncate">
            <span className="text-error line-through">{current.from}</span>
            {' '}
            <span className="text-outline">&rarr;</span>
            {' '}
            <span className="text-tertiary font-medium">{current.to}</span>
          </p>
          {suggestions.length > 1 && (
            <p className="text-[10px] text-outline mt-1">
              {currentIndex + 1} of {suggestions.length} changes
            </p>
          )}
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <button
            onClick={handleAccept}
            className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
            title="Add to dictionary"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-lg bg-surface-container hover:bg-error/10 text-on-surface-variant hover:text-error transition-colors"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
