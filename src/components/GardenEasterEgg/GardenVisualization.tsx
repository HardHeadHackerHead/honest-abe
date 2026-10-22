import { useMemo } from 'react';

interface TreeVisualizationProps {
  stage: number;
  totalWords: number;
  progressPercent: number;
}

// Pixel size for the grid
const PX = 6;

// Retro color palette
const COLORS = {
  // Sky
  skyLight: '#87CEEB',
  skyDark: '#5BA3C6',

  // Grass
  grassLight: '#81C784',
  grass: '#4CAF50',
  grassDark: '#388E3C',
  grassDarker: '#2E7D32',

  // Dirt
  dirtLight: '#D2691E',
  dirt: '#A0522D',
  dirtDark: '#8B4513',
  dirtDarker: '#654321',

  // Wood
  woodLight: '#A0724A',
  wood: '#8B5A2B',
  woodDark: '#6B4423',

  // Flowers
  flowerRed: '#FF6B6B',
  flowerRedDark: '#E85555',
  flowerYellow: '#FFD93D',
  flowerYellowDark: '#E5C235',
  flowerPink: '#FF6B9D',
  flowerPinkDark: '#E55585',
  flowerBlue: '#4D96FF',
  flowerBlueDark: '#3D7DE5',
  flowerWhite: '#FFFFFF',
  flowerCenter: '#FFE066',

  // Leaves/stems
  stemGreen: '#2E7D32',
  leafGreen: '#4CAF50',
  leafLight: '#66BB6A',

  // Water
  waterLight: '#90CAF9',
  water: '#64B5F6',
  waterDark: '#42A5F5',

  // Stone
  stoneLight: '#9E9E9E',
  stone: '#757575',
  stoneDark: '#616161',

  // Misc
  white: '#FFFFFF',
  black: '#1A1A1A',
  brown: '#5D4037',
};

// Helper to render a pixel
function Pixel({ x, y, color, className = '' }: { x: number; y: number; color: string; className?: string }) {
  return (
    <rect
      x={x * PX}
      y={y * PX}
      width={PX}
      height={PX}
      fill={color}
      className={className}
    />
  );
}

// Helper to render a sprite from a 2D array
function Sprite({
  data,
  palette,
  offsetX = 0,
  offsetY = 0,
  className = ''
}: {
  data: number[][];
  palette: string[];
  offsetX?: number;
  offsetY?: number;
  className?: string;
}) {
  const pixels: JSX.Element[] = [];
  data.forEach((row, y) => {
    row.forEach((colorIndex, x) => {
      if (colorIndex > 0) {
        pixels.push(
          <rect
            key={`${x}-${y}`}
            x={(offsetX + x) * PX}
            y={(offsetY + y) * PX}
            width={PX}
            height={PX}
            fill={palette[colorIndex - 1]}
          />
        );
      }
    });
  });
  return <g className={className}>{pixels}</g>;
}

// ============ SPRITES ============

// Small flower (5 colors: center, petal1, petal2, stem, leaf)
const FLOWER_SMALL = [
  [0,0,2,0,0],
  [0,2,1,2,0],
  [2,1,1,1,2],
  [0,2,1,2,0],
  [0,0,3,0,0],
  [0,0,3,0,0],
  [0,0,3,4,0],
];

// Tall flower
const FLOWER_TALL = [
  [0,0,2,0,0],
  [0,2,1,2,0],
  [2,1,1,1,2],
  [0,2,1,2,0],
  [0,0,3,0,0],
  [0,0,3,0,0],
  [0,0,3,0,0],
  [0,4,3,0,0],
  [0,0,3,0,0],
];

// Tulip
const TULIP = [
  [0,1,1,1,0],
  [1,2,2,2,1],
  [1,2,2,2,1],
  [0,1,2,1,0],
  [0,0,3,0,0],
  [0,0,3,0,0],
  [0,0,3,4,0],
];

// Bush
const BUSH = [
  [0,0,1,2,1,0,0],
  [0,1,2,1,2,1,0],
  [1,2,1,2,1,2,1],
  [2,1,2,1,2,1,2],
  [1,2,1,2,1,2,1],
  [0,1,2,1,2,1,0],
];

// Small tree
const TREE_SMALL = [
  [0,0,0,1,0,0,0],
  [0,0,1,2,1,0,0],
  [0,1,2,1,2,1,0],
  [1,2,1,2,1,2,1],
  [0,1,2,1,2,1,0],
  [0,0,0,3,0,0,0],
  [0,0,0,3,0,0,0],
  [0,0,0,3,0,0,0],
];

// Fence post
const FENCE_POST = [
  [1,2,1],
  [2,1,2],
  [2,1,2],
  [2,1,2],
  [2,1,2],
  [2,1,2],
];

// Fence rail (horizontal)
const FENCE_RAIL = [
  [1,1,1,1,1,1,1,1],
  [2,2,2,2,2,2,2,2],
];

// Butterfly frame 1
const BUTTERFLY_1 = [
  [1,0,0,0,1],
  [1,1,0,1,1],
  [0,1,2,1,0],
  [1,1,0,1,1],
  [1,0,0,0,1],
];

// Butterfly frame 2
const BUTTERFLY_2 = [
  [0,1,0,1,0],
  [0,1,0,1,0],
  [0,1,2,1,0],
  [0,1,0,1,0],
  [0,1,0,1,0],
];

// Bee frame 1
const BEE_1 = [
  [0,0,1,0,0],
  [0,1,0,1,0],
  [2,3,2,3,2],
  [0,2,2,2,0],
];

// Bee frame 2
const BEE_2 = [
  [0,1,0,1,0],
  [0,0,0,0,0],
  [2,3,2,3,2],
  [0,2,2,2,0],
];

// Bird
const BIRD = [
  [0,0,1,0,0,0],
  [0,1,1,1,0,0],
  [1,1,1,1,1,2],
  [0,1,1,1,0,0],
];

// Fountain base
const FOUNTAIN_BASE = [
  [0,0,1,1,1,1,0,0],
  [0,1,2,2,2,2,1,0],
  [1,2,2,2,2,2,2,1],
  [1,2,2,2,2,2,2,1],
  [1,1,1,1,1,1,1,1],
];

// Water spout frame 1
const WATER_SPOUT_1 = [
  [0,0,0,1,0,0,0],
  [0,0,1,0,1,0,0],
  [0,1,0,0,0,1,0],
  [0,0,0,0,0,0,0],
];

// Water spout frame 2
const WATER_SPOUT_2 = [
  [0,0,1,0,1,0,0],
  [0,0,0,1,0,0,0],
  [0,0,1,0,1,0,0],
  [0,1,0,0,0,1,0],
];

// Seed packet
const SEED_PACKET = [
  [1,1,1,1,1],
  [1,2,2,2,1],
  [1,2,3,2,1],
  [1,2,3,2,1],
  [1,2,2,2,1],
  [1,1,1,1,1],
];

// Sign post
const SIGN = [
  [1,1,1,1,1,1,1,1,1],
  [1,2,2,2,2,2,2,2,1],
  [1,2,2,2,2,2,2,2,1],
  [1,2,2,2,2,2,2,2,1],
  [1,1,1,1,1,1,1,1,1],
  [0,0,0,0,3,0,0,0,0],
  [0,0,0,0,3,0,0,0,0],
  [0,0,0,0,3,0,0,0,0],
];

// Rock
const ROCK = [
  [0,1,1,0],
  [1,2,2,1],
  [1,2,2,1],
  [0,1,1,0],
];

// Sprout
const SPROUT = [
  [0,1,0],
  [1,2,1],
  [0,2,0],
  [0,2,0],
];

// Sunflower (larger, impressive)
const SUNFLOWER = [
  [0,0,0,2,2,2,0,0,0],
  [0,0,2,2,2,2,2,0,0],
  [0,2,2,1,1,1,2,2,0],
  [2,2,1,1,1,1,1,2,2],
  [2,2,1,1,1,1,1,2,2],
  [2,2,1,1,1,1,1,2,2],
  [0,2,2,1,1,1,2,2,0],
  [0,0,2,2,2,2,2,0,0],
  [0,0,0,2,3,2,0,0,0],
  [0,0,0,0,3,0,0,0,0],
  [0,0,0,4,3,0,0,0,0],
  [0,0,0,0,3,0,0,0,0],
  [0,0,0,0,3,4,0,0,0],
];

// Rose
const ROSE = [
  [0,0,1,1,0,0],
  [0,1,2,2,1,0],
  [1,2,1,1,2,1],
  [1,2,1,1,2,1],
  [0,1,2,2,1,0],
  [0,0,3,3,0,0],
  [0,0,0,3,0,0],
  [0,0,4,3,0,0],
];

// Grass clump
const GRASS_CLUMP = [
  [0,1,0,1,0],
  [1,2,1,2,1],
  [0,1,0,1,0],
];

// Cloud
const CLOUD = [
  [0,0,1,1,1,0,0,0],
  [0,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,1],
  [0,1,1,1,1,1,1,0],
];

// Small daisy
const DAISY = [
  [0,1,0,1,0],
  [1,2,2,2,1],
  [0,1,2,1,0],
  [0,0,3,0,0],
  [0,0,3,0,0],
];

// Tall grass
const TALL_GRASS = [
  [0,1,0,0,1],
  [1,0,1,1,0],
  [0,1,0,1,0],
  [0,1,1,1,0],
];

// ============ MAIN COMPONENT ============

export default function TreeVisualization({ stage }: TreeVisualizationProps) {
  const content = useMemo(() => {
    switch (stage) {
      case 0: return <Stage0 />;
      case 1: return <Stage1 />;
      case 2: return <Stage2 />;
      case 3: return <Stage3 />;
      case 4: return <Stage4 />;
      case 5: return <Stage5 />;
      case 6: return <Stage6 />;
      default: return <Stage0 />;
    }
  }, [stage]);

  return (
    <div className="w-full h-full flex items-center justify-center">
      <svg
        viewBox="0 0 384 384"
        className="w-full h-full max-w-[384px] max-h-[384px]"
        style={{ imageRendering: 'pixelated' }}
      >
        {/* Sky background */}
        <rect width="384" height="240" fill={COLORS.skyLight} />

        {/* Ground background */}
        <rect y="240" width="384" height="144" fill={COLORS.grass} />

        {/* Ground texture - grass variation */}
        {[...Array(20)].map((_, i) => (
          <Pixel key={`grass-${i}`} x={5 + i * 3} y={40 + (i % 3)} color={COLORS.grassDark} />
        ))}
        {[...Array(15)].map((_, i) => (
          <Pixel key={`grass2-${i}`} x={8 + i * 4} y={42 + (i % 2)} color={COLORS.grassLight} />
        ))}

        {content}
      </svg>

      <style>{`
        @keyframes flutter {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-${PX}px); }
        }
        @keyframes bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(${PX/2}px); }
        }
        @keyframes sway {
          0%, 100% { transform: rotate(-2deg); }
          50% { transform: rotate(2deg); }
        }
        @keyframes wingFlap {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes wingFlapAlt {
          0%, 100% { opacity: 0; }
          50% { opacity: 1; }
        }
        @keyframes float {
          0% { transform: translate(0, 0); }
          25% { transform: translate(${PX*2}px, -${PX}px); }
          50% { transform: translate(${PX*4}px, 0); }
          75% { transform: translate(${PX*2}px, ${PX}px); }
          100% { transform: translate(0, 0); }
        }
        @keyframes beeFloat {
          0% { transform: translate(0, 0); }
          25% { transform: translate(-${PX*3}px, -${PX*2}px); }
          50% { transform: translate(0, -${PX}px); }
          75% { transform: translate(${PX*2}px, ${PX}px); }
          100% { transform: translate(0, 0); }
        }
        @keyframes spout {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes spoutAlt {
          0%, 100% { opacity: 0; }
          50% { opacity: 1; }
        }
        .flutter { animation: flutter 2s ease-in-out infinite; }
        .bob { animation: bob 3s ease-in-out infinite; }
        .sway { animation: sway 4s ease-in-out infinite; transform-origin: bottom center; }
        .butterfly { animation: float 8s ease-in-out infinite; }
        .bee { animation: beeFloat 6s ease-in-out infinite; }
        .wing1 { animation: wingFlap 0.15s linear infinite; }
        .wing2 { animation: wingFlapAlt 0.15s linear infinite; }
        .spout1 { animation: spout 0.5s linear infinite; }
        .spout2 { animation: spoutAlt 0.5s linear infinite; }
      `}</style>
    </div>
  );
}

// ============ STAGES ============

// Stage 0: Empty dirt plot with sign
function Stage0() {
  return (
    <g>
      {/* Dirt patch */}
      <rect x={20*PX} y={42*PX} width={24*PX} height={8*PX} fill={COLORS.dirt} />
      <rect x={21*PX} y={43*PX} width={22*PX} height={6*PX} fill={COLORS.dirtLight} />

      {/* Dirt texture */}
      <Pixel x={23} y={44} color={COLORS.dirtDark} />
      <Pixel x={28} y={45} color={COLORS.dirtDark} />
      <Pixel x={35} y={44} color={COLORS.dirtDark} />
      <Pixel x={40} y={46} color={COLORS.dirtDark} />

      {/* Small rock */}
      <Sprite
        data={ROCK}
        palette={[COLORS.stoneLight, COLORS.stone]}
        offsetX={38}
        offsetY={47}
      />

      {/* Sign - "Plant!" */}
      <Sprite
        data={SIGN}
        palette={[COLORS.woodDark, COLORS.woodLight, COLORS.wood]}
        offsetX={28}
        offsetY={32}
      />

      {/* ? on sign */}
      <Pixel x={31} y={34} color={COLORS.grassDark} />
      <Pixel x={32} y={33} color={COLORS.grassDark} />
      <Pixel x={32} y={35} color={COLORS.grassDark} />
      <Pixel x={32} y={37} color={COLORS.grassDark} />
    </g>
  );
}

// Stage 1: Seed planted
function Stage1() {
  return (
    <g>
      {/* Dirt patch */}
      <rect x={20*PX} y={42*PX} width={24*PX} height={8*PX} fill={COLORS.dirt} />
      <rect x={21*PX} y={43*PX} width={22*PX} height={6*PX} fill={COLORS.dirtLight} />

      {/* Dirt mound where seed is */}
      <Pixel x={31} y={43} color={COLORS.dirtDark} />
      <Pixel x={32} y={42} color={COLORS.dirt} />
      <Pixel x={33} y={43} color={COLORS.dirtDark} />

      {/* Seed packet nearby */}
      <Sprite
        data={SEED_PACKET}
        palette={[COLORS.brown, COLORS.white, COLORS.grassDark]}
        offsetX={38}
        offsetY={44}
        className="bob"
      />

      {/* Sparkle on mound */}
      <Pixel x={32} y={41} color={COLORS.white} className="flutter" />
    </g>
  );
}

// Stage 2: Tiny sprout
function Stage2() {
  return (
    <g>
      {/* Dirt patch */}
      <rect x={20*PX} y={44*PX} width={24*PX} height={6*PX} fill={COLORS.dirt} />
      <rect x={21*PX} y={45*PX} width={22*PX} height={4*PX} fill={COLORS.dirtLight} />

      {/* Sprout */}
      <g className="sway">
        <Sprite
          data={SPROUT}
          palette={[COLORS.leafLight, COLORS.stemGreen]}
          offsetX={31}
          offsetY={40}
        />
      </g>

      {/* Little grass blades */}
      <Pixel x={24} y={43} color={COLORS.grassDark} />
      <Pixel x={39} y={43} color={COLORS.grassDark} />
    </g>
  );
}

// Stage 3: Small flower
function Stage3() {
  return (
    <g>
      {/* Dirt patch */}
      <rect x={18*PX} y={46*PX} width={28*PX} height={6*PX} fill={COLORS.dirt} />
      <rect x={19*PX} y={47*PX} width={26*PX} height={4*PX} fill={COLORS.dirtLight} />

      {/* Main flower */}
      <g className="sway">
        <Sprite
          data={FLOWER_TALL}
          palette={[COLORS.flowerCenter, COLORS.flowerRed, COLORS.stemGreen, COLORS.leafGreen]}
          offsetX={30}
          offsetY={37}
        />
      </g>

      {/* Small grass patches */}
      <Pixel x={20} y={45} color={COLORS.grassDark} />
      <Pixel x={21} y={44} color={COLORS.grass} />
      <Pixel x={42} y={45} color={COLORS.grassDark} />
      <Pixel x={41} y={44} color={COLORS.grass} />
    </g>
  );
}

// Stage 4: Garden patch with flowers and butterfly
function Stage4() {
  return (
    <g>
      {/* Bigger dirt patch */}
      <rect x={12*PX} y={46*PX} width={40*PX} height={8*PX} fill={COLORS.dirt} />
      <rect x={13*PX} y={47*PX} width={38*PX} height={6*PX} fill={COLORS.dirtLight} />

      {/* Multiple flowers */}
      <g className="sway">
        <Sprite
          data={FLOWER_SMALL}
          palette={[COLORS.flowerCenter, COLORS.flowerYellow, COLORS.stemGreen, COLORS.leafGreen]}
          offsetX={16}
          offsetY={40}
        />
      </g>
      <g className="sway" style={{ animationDelay: '0.5s' }}>
        <Sprite
          data={FLOWER_TALL}
          palette={[COLORS.flowerCenter, COLORS.flowerRed, COLORS.stemGreen, COLORS.leafGreen]}
          offsetX={26}
          offsetY={37}
        />
      </g>
      <g className="sway" style={{ animationDelay: '1s' }}>
        <Sprite
          data={TULIP}
          palette={[COLORS.flowerPink, COLORS.flowerPinkDark, COLORS.stemGreen, COLORS.leafGreen]}
          offsetX={36}
          offsetY={39}
        />
      </g>
      <g className="sway" style={{ animationDelay: '0.3s' }}>
        <Sprite
          data={FLOWER_SMALL}
          palette={[COLORS.flowerCenter, COLORS.flowerBlue, COLORS.stemGreen, COLORS.leafGreen]}
          offsetX={44}
          offsetY={40}
        />
      </g>

      {/* Butterfly */}
      <g className="butterfly">
        <g className="wing1">
          <Sprite
            data={BUTTERFLY_1}
            palette={[COLORS.flowerPink, COLORS.black]}
            offsetX={22}
            offsetY={28}
          />
        </g>
        <g className="wing2">
          <Sprite
            data={BUTTERFLY_2}
            palette={[COLORS.flowerPink, COLORS.black]}
            offsetX={22}
            offsetY={28}
          />
        </g>
      </g>
    </g>
  );
}

// Stage 5: Lush garden with fence, more flowers, bee
function Stage5() {
  return (
    <g>
      {/* Large garden bed */}
      <rect x={4*PX} y={46*PX} width={56*PX} height={12*PX} fill={COLORS.dirt} />
      <rect x={5*PX} y={47*PX} width={54*PX} height={10*PX} fill={COLORS.dirtLight} />

      {/* Dirt texture */}
      <Pixel x={10} y={52} color={COLORS.dirtDark} />
      <Pixel x={25} y={54} color={COLORS.dirtDark} />
      <Pixel x={40} y={53} color={COLORS.dirtDark} />
      <Pixel x={52} y={52} color={COLORS.dirtDark} />

      {/* Fence - extended */}
      <Sprite data={FENCE_POST} palette={[COLORS.woodLight, COLORS.wood]} offsetX={2} offsetY={40} />
      <Sprite data={FENCE_POST} palette={[COLORS.woodLight, COLORS.wood]} offsetX={60} offsetY={40} />
      <Sprite data={FENCE_RAIL} palette={[COLORS.woodLight, COLORS.wood]} offsetX={2} offsetY={42} />
      <Sprite data={FENCE_RAIL} palette={[COLORS.woodLight, COLORS.wood]} offsetX={10} offsetY={42} />
      <Sprite data={FENCE_RAIL} palette={[COLORS.woodLight, COLORS.wood]} offsetX={18} offsetY={42} />
      <Sprite data={FENCE_RAIL} palette={[COLORS.woodLight, COLORS.wood]} offsetX={38} offsetY={42} />
      <Sprite data={FENCE_RAIL} palette={[COLORS.woodLight, COLORS.wood]} offsetX={46} offsetY={42} />
      <Sprite data={FENCE_RAIL} palette={[COLORS.woodLight, COLORS.wood]} offsetX={54} offsetY={42} />

      {/* Bushes - more of them */}
      <Sprite data={BUSH} palette={[COLORS.leafGreen, COLORS.grassDark]} offsetX={6} offsetY={40} />
      <Sprite data={BUSH} palette={[COLORS.grassDark, COLORS.leafGreen]} offsetX={54} offsetY={40} />
      <Sprite data={BUSH} palette={[COLORS.leafLight, COLORS.leafGreen]} offsetX={26} offsetY={41} />

      {/* Grass clumps */}
      <Sprite data={GRASS_CLUMP} palette={[COLORS.grassDark, COLORS.leafGreen]} offsetX={8} offsetY={54} />
      <Sprite data={GRASS_CLUMP} palette={[COLORS.leafGreen, COLORS.grassDark]} offsetX={50} offsetY={55} />
      <Sprite data={TALL_GRASS} palette={[COLORS.grassDark]} offsetX={58} offsetY={52} />

      {/* Back row flowers (behind main flowers) */}
      <g className="sway" style={{ animationDelay: '0.1s' }}>
        <Sprite data={DAISY} palette={[COLORS.white, COLORS.flowerCenter, COLORS.stemGreen]} offsetX={11} offsetY={43} />
      </g>
      <g className="sway" style={{ animationDelay: '0.4s' }}>
        <Sprite data={DAISY} palette={[COLORS.white, COLORS.flowerCenter, COLORS.stemGreen]} offsetX={52} offsetY={42} />
      </g>

      {/* Main sunflower - centerpiece */}
      <g className="sway" style={{ animationDelay: '0.5s' }}>
        <Sprite data={SUNFLOWER} palette={[COLORS.brown, COLORS.flowerYellow, COLORS.stemGreen, COLORS.leafGreen]} offsetX={28} offsetY={33} />
      </g>

      {/* Front row flowers */}
      <g className="sway">
        <Sprite data={FLOWER_SMALL} palette={[COLORS.flowerCenter, COLORS.flowerYellow, COLORS.stemGreen, COLORS.leafGreen]} offsetX={12} offsetY={40} />
      </g>
      <g className="sway" style={{ animationDelay: '0.3s' }}>
        <Sprite data={TULIP} palette={[COLORS.flowerRed, COLORS.flowerRedDark, COLORS.stemGreen, COLORS.leafGreen]} offsetX={18} offsetY={39} />
      </g>
      <g className="sway" style={{ animationDelay: '0.6s' }}>
        <Sprite data={ROSE} palette={[COLORS.flowerPink, COLORS.flowerPinkDark, COLORS.stemGreen, COLORS.leafGreen]} offsetX={23} offsetY={38} />
      </g>
      <g className="sway" style={{ animationDelay: '0.8s' }}>
        <Sprite data={FLOWER_TALL} palette={[COLORS.flowerCenter, COLORS.flowerBlue, COLORS.stemGreen, COLORS.leafGreen]} offsetX={38} offsetY={37} />
      </g>
      <g className="sway" style={{ animationDelay: '0.9s' }}>
        <Sprite data={FLOWER_SMALL} palette={[COLORS.flowerCenter, COLORS.flowerPink, COLORS.stemGreen, COLORS.leafGreen]} offsetX={44} offsetY={40} />
      </g>
      <g className="sway" style={{ animationDelay: '1.1s' }}>
        <Sprite data={TULIP} palette={[COLORS.flowerYellow, COLORS.flowerYellowDark, COLORS.stemGreen, COLORS.leafGreen]} offsetX={49} offsetY={39} />
      </g>

      {/* Additional small flowers in gaps */}
      <g className="sway" style={{ animationDelay: '1.3s' }}>
        <Sprite data={DAISY} palette={[COLORS.white, COLORS.flowerCenter, COLORS.stemGreen]} offsetX={16} offsetY={44} />
      </g>
      <g className="sway" style={{ animationDelay: '1.5s' }}>
        <Sprite data={DAISY} palette={[COLORS.flowerYellow, COLORS.flowerCenter, COLORS.stemGreen]} offsetX={42} offsetY={44} />
      </g>

      {/* Bees */}
      <g className="bee">
        <g className="wing1">
          <Sprite data={BEE_1} palette={[COLORS.white, COLORS.flowerYellow, COLORS.black]} offsetX={35} offsetY={26} />
        </g>
        <g className="wing2">
          <Sprite data={BEE_2} palette={[COLORS.white, COLORS.flowerYellow, COLORS.black]} offsetX={35} offsetY={26} />
        </g>
      </g>
      <g className="bee" style={{ animationDelay: '3s' }}>
        <g className="wing1">
          <Sprite data={BEE_1} palette={[COLORS.white, COLORS.flowerYellow, COLORS.black]} offsetX={20} offsetY={30} />
        </g>
        <g className="wing2">
          <Sprite data={BEE_2} palette={[COLORS.white, COLORS.flowerYellow, COLORS.black]} offsetX={20} offsetY={30} />
        </g>
      </g>

      {/* Butterflies */}
      <g className="butterfly" style={{ animationDelay: '2s' }}>
        <g className="wing1">
          <Sprite data={BUTTERFLY_1} palette={[COLORS.flowerBlue, COLORS.black]} offsetX={14} offsetY={22} />
        </g>
        <g className="wing2">
          <Sprite data={BUTTERFLY_2} palette={[COLORS.flowerBlue, COLORS.black]} offsetX={14} offsetY={22} />
        </g>
      </g>
      <g className="butterfly" style={{ animationDelay: '4s' }}>
        <g className="wing1">
          <Sprite data={BUTTERFLY_1} palette={[COLORS.flowerPink, COLORS.black]} offsetX={48} offsetY={24} />
        </g>
        <g className="wing2">
          <Sprite data={BUTTERFLY_2} palette={[COLORS.flowerPink, COLORS.black]} offsetX={48} offsetY={24} />
        </g>
      </g>
    </g>
  );
}

// Stage 6: Paradise garden with fountain, trees, birds
function Stage6() {
  return (
    <g>
      {/* Clouds in sky */}
      <Sprite data={CLOUD} palette={[COLORS.white]} offsetX={6} offsetY={4} className="bob" />
      <Sprite data={CLOUD} palette={[COLORS.white]} offsetX={48} offsetY={6} className="bob" />

      {/* Full garden bed - wider */}
      <rect x={1*PX} y={48*PX} width={62*PX} height={14*PX} fill={COLORS.dirt} />
      <rect x={2*PX} y={49*PX} width={60*PX} height={12*PX} fill={COLORS.dirtLight} />

      {/* Dirt texture */}
      <Pixel x={8} y={54} color={COLORS.dirtDark} />
      <Pixel x={18} y={56} color={COLORS.dirtDark} />
      <Pixel x={44} y={55} color={COLORS.dirtDark} />
      <Pixel x={55} y={54} color={COLORS.dirtDark} />

      {/* Stone path to fountain */}
      <rect x={28*PX} y={52*PX} width={8*PX} height={10*PX} fill={COLORS.stone} />
      <Pixel x={29} y={53} color={COLORS.stoneLight} />
      <Pixel x={33} y={55} color={COLORS.stoneLight} />
      <Pixel x={30} y={58} color={COLORS.stoneDark} />
      <Pixel x={34} y={59} color={COLORS.stoneLight} />

      {/* Trees on sides - larger presence */}
      <Sprite data={TREE_SMALL} palette={[COLORS.leafLight, COLORS.leafGreen, COLORS.wood]} offsetX={3} offsetY={36} />
      <Sprite data={TREE_SMALL} palette={[COLORS.leafGreen, COLORS.grassDark, COLORS.wood]} offsetX={55} offsetY={36} />

      {/* Fence - complete perimeter */}
      <Sprite data={FENCE_POST} palette={[COLORS.woodLight, COLORS.wood]} offsetX={0} offsetY={42} />
      <Sprite data={FENCE_POST} palette={[COLORS.woodLight, COLORS.wood]} offsetX={61} offsetY={42} />
      <Sprite data={FENCE_RAIL} palette={[COLORS.woodLight, COLORS.wood]} offsetX={0} offsetY={44} />
      <Sprite data={FENCE_RAIL} palette={[COLORS.woodLight, COLORS.wood]} offsetX={8} offsetY={44} />
      <Sprite data={FENCE_RAIL} palette={[COLORS.woodLight, COLORS.wood]} offsetX={54} offsetY={44} />

      {/* Fountain in center - the crown jewel */}
      <Sprite data={FOUNTAIN_BASE} palette={[COLORS.stoneDark, COLORS.stone]} offsetX={28} offsetY={41} />
      <g className="spout1">
        <Sprite data={WATER_SPOUT_1} palette={[COLORS.waterLight]} offsetX={28} offsetY={37} />
      </g>
      <g className="spout2">
        <Sprite data={WATER_SPOUT_2} palette={[COLORS.water]} offsetX={28} offsetY={37} />
      </g>
      {/* Water droplets around fountain */}
      <Pixel x={26} y={44} color={COLORS.waterLight} className="flutter" />
      <Pixel x={37} y={43} color={COLORS.waterLight} className="flutter" />

      {/* Sunflowers - tall and majestic */}
      <g className="sway" style={{ animationDelay: '0.1s' }}>
        <Sprite data={SUNFLOWER} palette={[COLORS.brown, COLORS.flowerYellow, COLORS.stemGreen, COLORS.leafGreen]} offsetX={12} offsetY={31} />
      </g>
      <g className="sway" style={{ animationDelay: '0.7s' }}>
        <Sprite data={SUNFLOWER} palette={[COLORS.brown, COLORS.flowerYellow, COLORS.stemGreen, COLORS.leafGreen]} offsetX={46} offsetY={31} />
      </g>

      {/* Roses */}
      <g className="sway" style={{ animationDelay: '0.3s' }}>
        <Sprite data={ROSE} palette={[COLORS.flowerRed, COLORS.flowerRedDark, COLORS.stemGreen, COLORS.leafGreen]} offsetX={20} offsetY={38} />
      </g>
      <g className="sway" style={{ animationDelay: '0.5s' }}>
        <Sprite data={ROSE} palette={[COLORS.flowerPink, COLORS.flowerPinkDark, COLORS.stemGreen, COLORS.leafGreen]} offsetX={40} offsetY={38} />
      </g>

      {/* Tulips */}
      <g className="sway">
        <Sprite data={TULIP} palette={[COLORS.flowerRed, COLORS.flowerRedDark, COLORS.stemGreen, COLORS.leafGreen]} offsetX={8} offsetY={41} />
      </g>
      <g className="sway" style={{ animationDelay: '0.2s' }}>
        <Sprite data={TULIP} palette={[COLORS.flowerYellow, COLORS.flowerYellowDark, COLORS.stemGreen, COLORS.leafGreen]} offsetX={16} offsetY={42} />
      </g>
      <g className="sway" style={{ animationDelay: '0.4s' }}>
        <Sprite data={TULIP} palette={[COLORS.flowerBlue, COLORS.flowerBlueDark, COLORS.stemGreen, COLORS.leafGreen]} offsetX={44} offsetY={42} />
      </g>
      <g className="sway" style={{ animationDelay: '0.6s' }}>
        <Sprite data={TULIP} palette={[COLORS.flowerPink, COLORS.flowerPinkDark, COLORS.stemGreen, COLORS.leafGreen]} offsetX={52} offsetY={41} />
      </g>

      {/* Small flowers scattered */}
      <g className="sway" style={{ animationDelay: '0.8s' }}>
        <Sprite data={FLOWER_SMALL} palette={[COLORS.flowerCenter, COLORS.flowerYellow, COLORS.stemGreen, COLORS.leafGreen]} offsetX={5} offsetY={44} />
      </g>
      <g className="sway" style={{ animationDelay: '1.0s' }}>
        <Sprite data={FLOWER_SMALL} palette={[COLORS.flowerCenter, COLORS.flowerPink, COLORS.stemGreen, COLORS.leafGreen]} offsetX={23} offsetY={43} />
      </g>
      <g className="sway" style={{ animationDelay: '1.2s' }}>
        <Sprite data={FLOWER_SMALL} palette={[COLORS.flowerCenter, COLORS.flowerBlue, COLORS.stemGreen, COLORS.leafGreen]} offsetX={38} offsetY={43} />
      </g>
      <g className="sway" style={{ animationDelay: '1.4s' }}>
        <Sprite data={FLOWER_SMALL} palette={[COLORS.flowerCenter, COLORS.white, COLORS.stemGreen, COLORS.leafGreen]} offsetX={57} offsetY={44} />
      </g>

      {/* Daisies filling gaps */}
      <g className="sway" style={{ animationDelay: '0.9s' }}>
        <Sprite data={DAISY} palette={[COLORS.white, COLORS.flowerCenter, COLORS.stemGreen]} offsetX={10} offsetY={46} />
      </g>
      <g className="sway" style={{ animationDelay: '1.1s' }}>
        <Sprite data={DAISY} palette={[COLORS.white, COLORS.flowerCenter, COLORS.stemGreen]} offsetX={50} offsetY={46} />
      </g>

      {/* Bushes - lining the garden */}
      <Sprite data={BUSH} palette={[COLORS.leafGreen, COLORS.grassDark]} offsetX={3} offsetY={46} />
      <Sprite data={BUSH} palette={[COLORS.grassDark, COLORS.leafGreen]} offsetX={17} offsetY={47} />
      <Sprite data={BUSH} palette={[COLORS.leafLight, COLORS.leafGreen]} offsetX={42} offsetY={47} />
      <Sprite data={BUSH} palette={[COLORS.leafGreen, COLORS.grassDark]} offsetX={55} offsetY={46} />

      {/* Grass clumps for texture */}
      <Sprite data={GRASS_CLUMP} palette={[COLORS.grassDark, COLORS.leafGreen]} offsetX={6} offsetY={56} />
      <Sprite data={GRASS_CLUMP} palette={[COLORS.leafGreen, COLORS.grassDark]} offsetX={54} offsetY={57} />
      <Sprite data={TALL_GRASS} palette={[COLORS.grassDark]} offsetX={60} offsetY={50} />
      <Sprite data={TALL_GRASS} palette={[COLORS.grassDark]} offsetX={1} offsetY={51} />

      {/* Birds in sky */}
      <g className="flutter">
        <Sprite data={BIRD} palette={[COLORS.black, COLORS.flowerYellow]} offsetX={20} offsetY={10} />
      </g>
      <g className="flutter" style={{ animationDelay: '0.7s' }}>
        <Sprite data={BIRD} palette={[COLORS.black, COLORS.flowerYellow]} offsetX={38} offsetY={6} />
      </g>
      <g className="flutter" style={{ animationDelay: '1.5s' }}>
        <Sprite data={BIRD} palette={[COLORS.black, COLORS.flowerYellow]} offsetX={52} offsetY={12} />
      </g>

      {/* Butterflies - dancing around */}
      <g className="butterfly">
        <g className="wing1">
          <Sprite data={BUTTERFLY_1} palette={[COLORS.flowerPink, COLORS.black]} offsetX={10} offsetY={26} />
        </g>
        <g className="wing2">
          <Sprite data={BUTTERFLY_2} palette={[COLORS.flowerPink, COLORS.black]} offsetX={10} offsetY={26} />
        </g>
      </g>
      <g className="butterfly" style={{ animationDelay: '2s' }}>
        <g className="wing1">
          <Sprite data={BUTTERFLY_1} palette={[COLORS.flowerYellow, COLORS.black]} offsetX={30} offsetY={22} />
        </g>
        <g className="wing2">
          <Sprite data={BUTTERFLY_2} palette={[COLORS.flowerYellow, COLORS.black]} offsetX={30} offsetY={22} />
        </g>
      </g>
      <g className="butterfly" style={{ animationDelay: '4s' }}>
        <g className="wing1">
          <Sprite data={BUTTERFLY_1} palette={[COLORS.flowerBlue, COLORS.black]} offsetX={52} offsetY={24} />
        </g>
        <g className="wing2">
          <Sprite data={BUTTERFLY_2} palette={[COLORS.flowerBlue, COLORS.black]} offsetX={52} offsetY={24} />
        </g>
      </g>

      {/* Bees - busy pollinating */}
      <g className="bee">
        <g className="wing1">
          <Sprite data={BEE_1} palette={[COLORS.white, COLORS.flowerYellow, COLORS.black]} offsetX={18} offsetY={28} />
        </g>
        <g className="wing2">
          <Sprite data={BEE_2} palette={[COLORS.white, COLORS.flowerYellow, COLORS.black]} offsetX={18} offsetY={28} />
        </g>
      </g>
      <g className="bee" style={{ animationDelay: '3s' }}>
        <g className="wing1">
          <Sprite data={BEE_1} palette={[COLORS.white, COLORS.flowerYellow, COLORS.black]} offsetX={45} offsetY={30} />
        </g>
        <g className="wing2">
          <Sprite data={BEE_2} palette={[COLORS.white, COLORS.flowerYellow, COLORS.black]} offsetX={45} offsetY={30} />
        </g>
      </g>
    </g>
  );
}
