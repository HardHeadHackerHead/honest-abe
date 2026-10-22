import { useEffect, useState } from 'react';

interface WateringAnimationProps {
  onComplete: () => void;
}

interface WaterDrop {
  id: number;
  x: number;
  delay: number;
  size: number;
  speed: number;
}

export default function WateringAnimation({ onComplete }: WateringAnimationProps) {
  const [drops, setDrops] = useState<WaterDrop[]>([]);

  useEffect(() => {
    // Generate varied water drops
    const newDrops: WaterDrop[] = Array.from({ length: 12 }, (_, i) => ({
      id: i,
      x: 100 + Math.random() * 200, // Random x between 100-300
      delay: Math.random() * 0.8, // Stagger the drops
      size: 0.7 + Math.random() * 0.6, // Varied sizes
      speed: 1.2 + Math.random() * 0.6, // Varied speeds
    }));
    setDrops(newDrops);

    // Complete after animation duration
    const timer = setTimeout(() => {
      onComplete();
    }, 2500);

    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      <svg viewBox="0 0 400 500" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          {/* Water drop gradient */}
          <linearGradient id="waterDropGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#93c5fd" />
            <stop offset="50%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>

          {/* Water drop highlight */}
          <radialGradient id="waterHighlight" cx="30%" cy="30%" r="50%">
            <stop offset="0%" stopColor="#dbeafe" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
          </radialGradient>

          {/* Splash gradient */}
          <radialGradient id="splashGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </radialGradient>

          {/* Glow filter */}
          <filter id="waterGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {drops.map((drop) => (
          <g key={drop.id}>
            {/* Water drop with teardrop shape */}
            <g
              style={{
                animation: `waterDropFall ${drop.speed}s ease-in forwards`,
                animationDelay: `${drop.delay}s`,
              }}
            >
              {/* Main drop body */}
              <path
                d={`M ${drop.x} -20
                   Q ${drop.x - 5 * drop.size} ${-10 + 8 * drop.size} ${drop.x} ${-10 + 16 * drop.size}
                   Q ${drop.x + 5 * drop.size} ${-10 + 8 * drop.size} ${drop.x} -20`}
                fill="url(#waterDropGrad)"
                opacity="0.9"
                filter="url(#waterGlow)"
              />
              {/* Highlight */}
              <ellipse
                cx={drop.x - 1.5 * drop.size}
                cy={-12 + 4 * drop.size}
                rx={1.5 * drop.size}
                ry={2 * drop.size}
                fill="white"
                opacity="0.6"
              />
            </g>

            {/* Splash ring effect */}
            <ellipse
              cx={drop.x}
              cy="420"
              rx="0"
              ry="0"
              fill="none"
              stroke="#60a5fa"
              strokeWidth="2"
              opacity="0"
              style={{
                animation: `splashRing 0.6s ease-out forwards`,
                animationDelay: `${drop.delay + drop.speed - 0.1}s`,
              }}
            />

            {/* Splash droplets */}
            {[...Array(3)].map((_, j) => (
              <circle
                key={j}
                cx={drop.x}
                cy="420"
                r="2"
                fill="#93c5fd"
                opacity="0"
                style={{
                  animation: `splashDroplet${j} 0.5s ease-out forwards`,
                  animationDelay: `${drop.delay + drop.speed - 0.05}s`,
                }}
              />
            ))}
          </g>
        ))}

        {/* Sparkle effects */}
        <g className="sparkles">
          <circle cx="150" cy="380" r="2" fill="#fef08a" opacity="0" className="sparkle-1" />
          <circle cx="250" cy="360" r="2" fill="#fef08a" opacity="0" className="sparkle-2" />
          <circle cx="180" cy="340" r="1.5" fill="#fef08a" opacity="0" className="sparkle-3" />
          <circle cx="220" cy="390" r="1.5" fill="#fef08a" opacity="0" className="sparkle-4" />
        </g>
      </svg>

      <style>{`
        @keyframes waterDropFall {
          0% {
            transform: translateY(0);
            opacity: 0;
          }
          5% {
            opacity: 0.9;
          }
          85% {
            opacity: 0.9;
          }
          100% {
            transform: translateY(440px);
            opacity: 0;
          }
        }

        @keyframes splashRing {
          0% {
            rx: 0;
            ry: 0;
            opacity: 0.7;
            stroke-width: 3;
          }
          100% {
            rx: 25;
            ry: 8;
            opacity: 0;
            stroke-width: 1;
          }
        }

        @keyframes splashDroplet0 {
          0% {
            transform: translate(0, 0);
            opacity: 0.8;
          }
          100% {
            transform: translate(-15px, -20px);
            opacity: 0;
          }
        }

        @keyframes splashDroplet1 {
          0% {
            transform: translate(0, 0);
            opacity: 0.8;
          }
          100% {
            transform: translate(12px, -18px);
            opacity: 0;
          }
        }

        @keyframes splashDroplet2 {
          0% {
            transform: translate(0, 0);
            opacity: 0.8;
          }
          100% {
            transform: translate(0px, -25px);
            opacity: 0;
          }
        }

        @keyframes sparkle {
          0%, 100% {
            opacity: 0;
            transform: scale(0);
          }
          50% {
            opacity: 1;
            transform: scale(1);
          }
        }

        .sparkle-1 {
          animation: sparkle 0.6s ease-out forwards;
          animation-delay: 0.8s;
        }
        .sparkle-2 {
          animation: sparkle 0.6s ease-out forwards;
          animation-delay: 1.0s;
        }
        .sparkle-3 {
          animation: sparkle 0.6s ease-out forwards;
          animation-delay: 1.2s;
        }
        .sparkle-4 {
          animation: sparkle 0.6s ease-out forwards;
          animation-delay: 1.4s;
        }
      `}</style>
    </div>
  );
}
