import { Mic, Square, AlertCircle } from 'lucide-react';

interface RecordingButtonProps {
  isRecording: boolean;
  onClick: () => void;
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
}

const sizeClasses = {
  small: { button: 'w-20 h-20', icon: 'w-8 h-8' },
  medium: { button: 'w-24 h-24', icon: 'w-10 h-10' },
  large: { button: 'w-32 h-32', icon: 'w-12 h-12' },
};

export default function RecordingButton({ isRecording, onClick, disabled = false, size = 'large' }: RecordingButtonProps) {
  const { button: buttonSize, icon: iconSize } = sizeClasses[size];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        ${buttonSize} rounded-full flex items-center justify-center
        transition-all duration-300 transform
        ${disabled
          ? 'bg-surface-container-high cursor-not-allowed opacity-40'
          : isRecording
          ? 'bg-error animate-pulse shadow-glow-error hover:scale-105'
          : 'gradient-primary shadow-glow-primary hover:scale-105 hover:brightness-110'
        }
      `}
    >
      {disabled ? (
        <AlertCircle className={`${iconSize} text-on-surface-variant`} />
      ) : isRecording ? (
        <Square className={`${iconSize} text-on-surface`} />
      ) : (
        <Mic className={`${iconSize} text-on-primary`} />
      )}
    </button>
  );
}
