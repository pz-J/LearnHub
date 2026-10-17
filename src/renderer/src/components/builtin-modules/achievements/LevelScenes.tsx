import type { ReactNode } from 'react'
import { ROOF } from '@/lib/towerPhysics'
import type { LevelDef } from '@/stores/tower'

/** 关卡场景与装饰道具（世界坐标：地面线 y_svg=0，天空为负，y_svg = -(世界y)）。
 *  topY/botY 为当前可视区上下边界（含过绘余量），任意缩放/平移下不露边。
 *  装饰道具按历史最高楼高解锁（SCENE_PROPS），动画仅 CSS/SMIL，无 JS 每帧开销。 */

/** 各关卡装饰道具：历史最高楼高达到 unlockAt 后在对应场景永久出现 */
export interface ScenePropDef {
  id: string
  name: string
  unlockAt: number
}

export const SCENE_PROPS: Record<string, ScenePropDef[]> = {
  alps: [
    { id: 'birds', name: '山间飞鸟', unlockAt: 30 },
    { id: 'cable', name: '山腰缆车', unlockAt: 90 },
    { id: 'balloon', name: '远山热气球', unlockAt: 150 }
  ],
  desert: [
    { id: 'eagle', name: '盘旋沙鹰', unlockAt: 30 },
    { id: 'camel', name: '沙漠驼队', unlockAt: 90 }
  ],
  sakura: [
    { id: 'lantern', name: '庭院灯笼', unlockAt: 30 },
    { id: 'butterfly', name: '花间蝴蝶', unlockAt: 90 }
  ],
  night: [
    { id: 'gull', name: '夜海海鸥', unlockAt: 30 },
    { id: 'beam', name: '灯塔旋转光束', unlockAt: 90 },
    { id: 'meteor', name: '流星', unlockAt: 150 }
  ]
}

function Sky({ id, topY, botY, from, to }: { id: string; topY: number; botY: number; from: string; to: string }) {
  return (
    <>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1={topY} x2="0" y2={botY}>
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect x="0" y={topY} width="100" height={botY - topY} fill={`url(#${id})`} />
    </>
  )
}

function Ground({ h, fill, line, children }: { h: number; fill: string; line: string; children?: ReactNode }) {
  if (h <= 0) return null
  return (
    <g>
      <rect x="0" y="0" width="100" height={h} fill={fill} />
      <line x1="0" y1="0" x2="100" y2="0" stroke={line} strokeWidth="0.5" />
      {children}
    </g>
  )
}

/* ---------- 通用小鸟（纯曲线剪影） ---------- */
function Bird({ x, y, s, color }: { x: number; y: number; s: number; color: string }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M -1.6 0 Q -0.8 -1 0 -0.2 Q 0.8 -1 1.6 0"
      stroke={color}
      strokeWidth="0.3"
      fill="none"
      strokeLinecap="round"
    />
  )
}

function AlpsScene({ topY, botY }: { topY: number; botY: number }) {
  return (
    <g>
      <Sky id="lh-sky-alps" topY={topY} botY={botY} from="#8fc3ec" to="#e9f5fd" />
      {/* 远处雪山群（白雪顶 + 灰蓝山体） */}
      <polygon points="-2,0 14,-30 30,0" fill="#9fb6d2" />
      <polygon points="14,-30 10.7,-23.8 12.3,-25.6 14,-24 15.7,-25.8 17.3,-23.8" fill="#f6fafd" />
      <polygon points="16,0 34,-40 52,0" fill="#8aa4c4" />
      <polygon points="34,-40 30.4,-32 32.2,-34.2 34,-32.4 35.8,-34.6 37.6,-32" fill="#f6fafd" />
      <polygon points="42,0 56,-24 70,0" fill="#a9bed8" />
      <polygon points="56,-24 53.1,-19 54.6,-20.8 56,-19.2 57.4,-21 58.9,-19" fill="#f6fafd" />
      <polygon points="62,0 80,-34 98,0" fill="#93abc9" />
      <polygon points="80,-34 76.3,-27 78.2,-29.2 80,-27.4 81.8,-29.6 83.7,-27" fill="#f6fafd" />
      <polygon points="86,0 97,-22 108,0" fill="#a2b7d3" />
      <polygon points="97,-22 94.8,-17.5 96,-19 97,-17.8 98.2,-19.4 99.5,-17.5" fill="#f6fafd" />
      {/* 中景云朵（极慢漂移） */}
      <g className="lh-cloud" fill="#ffffff" opacity="0.92">
        <ellipse cx="24" cy="-40" rx="7.5" ry="2.2" />
        <ellipse cx="27.5" cy="-42" rx="4.5" ry="1.9" />
        <ellipse cx="20.5" cy="-41.5" rx="3.6" ry="1.6" />
      </g>
      <g className="lh-cloud" style={{ animationDelay: '-9s' }} fill="#ffffff" opacity="0.8">
        <ellipse cx="68" cy="-50" rx="6.5" ry="2" />
        <ellipse cx="71" cy="-52" rx="3.8" ry="1.7" />
      </g>
      <Ground h={botY} fill="#7ab55e" line="#4d8c39">
        {/* 稀疏小草与小花 */}
        <path d="M 8 0 Q 8.4 -1.8 9.2 -2.6 M 9.8 0 Q 9.4 -1.4 10 -2.2 M 6.6 0 Q 6.4 -1.2 5.8 -1.8" stroke="#3f7a2e" strokeWidth="0.4" fill="none" />
        <path d="M 46 0 Q 46.4 -1.6 47.2 -2.4 M 44.4 0 Q 44.2 -1 43.6 -1.6" stroke="#3f7a2e" strokeWidth="0.4" fill="none" />
        <path d="M 84 0 Q 84.4 -1.8 85.2 -2.6 M 82.4 0 Q 82.2 -1.2 81.6 -1.8" stroke="#3f7a2e" strokeWidth="0.4" fill="none" />
        <line x1="18" y1="0" x2="18" y2="-1.6" stroke="#3f7a2e" strokeWidth="0.35" />
        <circle cx="18" cy="-2.1" r="0.55" fill="#f2d040" />
        <line x1="72" y1="0" x2="72" y2="-1.4" stroke="#3f7a2e" strokeWidth="0.35" />
        <circle cx="72" cy="-1.9" r="0.55" fill="#ef8fb0" />
      </Ground>
    </g>
  )
}

function DesertScene({ topY, botY }: { topY: number; botY: number }) {
  return (
    <g>
      <Sky id="lh-sky-desert" topY={topY} botY={botY} from="#f5bd6e" to="#fdead0" />
      {/* 大金字塔剪影 + 小金字塔 */}
      <polygon points="58,0 76,-34 94,0" fill="#c99a5d" />
      <polygon points="76,-34 94,0 76,0" fill="#b9884c" />
      <polygon points="86,0 95,-14 104,0" fill="#d4a768" />
      <polygon points="95,-14 104,0 95,0" fill="#c69755" />
      {/* 远近两层沙丘 */}
      <path d="M 0 -1 Q 20 -11 44 -5 Q 70 1 100 -6 L 100 0 L 0 0 Z" fill="#edc084" />
      <path d="M 0 0 Q 14 -7 30 -3 Q 46 1 62 -2.4 Q 82 -6 100 -1.6 L 100 0 L 0 0 Z" fill="#dfa966" />
      {/* 仙人掌 */}
      <g fill="#5c8f4a">
        <rect x="16.8" y="-7.2" width="1.5" height="7.2" rx="0.75" />
        <rect x="14.9" y="-5.4" width="1.2" height="2.6" rx="0.6" />
        <rect x="14.9" y="-3.4" width="2.6" height="1.1" rx="0.5" />
        <rect x="19" y="-6" width="1.2" height="2.2" rx="0.6" />
        <rect x="18.2" y="-4.2" width="2" height="1" rx="0.5" />
      </g>
      <g fill="#548243">
        <rect x="90.5" y="-5.4" width="1.3" height="5.4" rx="0.65" />
        <rect x="89" y="-4.2" width="1.1" height="2" rx="0.55" />
        <rect x="89" y="-2.7" width="2.4" height="0.95" rx="0.45" />
      </g>
      {/* 风滚草（极慢左右滚动） */}
      <g className="lh-roll">
        <g transform="translate(42 -2.1)" stroke="#8a6b46" fill="none">
          <circle r="2" strokeWidth="0.35" />
          <path d="M -2 0 L 2 0 M 0 -2 L 0 2 M -1.4 -1.4 L 1.4 1.4 M 1.4 -1.4 L -1.4 1.4" strokeWidth="0.25" />
        </g>
      </g>
      <Ground h={botY} fill="#e7c48b" line="#bd9257">
        <g fill="#caa065">
          <circle cx="12" cy="1" r="0.35" />
          <circle cx="38" cy="2.2" r="0.35" />
          <circle cx="64" cy="1.2" r="0.35" />
          <circle cx="88" cy="2.4" r="0.35" />
        </g>
      </Ground>
    </g>
  )
}

function SakuraScene({ topY, botY }: { topY: number; botY: number }) {
  return (
    <g>
      <Sky id="lh-sky-sakura" topY={topY} botY={botY} from="#f6cade" to="#fdf0f4" />
      {/* 远处矮丘 */}
      <path d="M 0 -2 Q 22 -12 48 -6 Q 74 -1 100 -7 L 100 0 L 0 0 Z" fill="#ecd3dd" />
      {/* 樱树：深色枝干 + 粉色团冠 */}
      <path d="M 10 0 C 10 -3 9.6 -5 8.8 -7.6 M 9.4 -4.8 C 11 -5.8 12.2 -6.4 13.6 -6.8" stroke="#5a4436" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      <circle cx="8" cy="-9.6" r="3.4" fill="#f3b4cd" />
      <circle cx="12.4" cy="-8.2" r="2.6" fill="#f6c4d8" />
      <circle cx="5.6" cy="-7.8" r="2.3" fill="#f0a9c6" />
      <path d="M 90 0 C 90 -2.4 90.3 -4 91 -6.2 M 90.6 -3.8 C 89.2 -4.8 88.2 -5.4 87 -5.8" stroke="#5a4436" strokeWidth="0.9" fill="none" strokeLinecap="round" />
      <circle cx="91.6" cy="-7.8" r="2.7" fill="#f3b4cd" />
      <circle cx="87.8" cy="-6.6" r="2.1" fill="#f6c4d8" />
      {/* 飘落花瓣（极慢循环） */}
      <g className="lh-petal" fill="#f5b8d0">
        <circle cx="14" cy="-14" r="0.45" />
        <circle cx="20" cy="-7" r="0.4" />
        <circle cx="7" cy="-19" r="0.4" />
        <circle cx="26" cy="-12" r="0.35" />
      </g>
      <g className="lh-petal" style={{ animationDelay: '-4.5s' }} fill="#f8cadb">
        <circle cx="86" cy="-16" r="0.45" />
        <circle cx="82" cy="-8" r="0.4" />
        <circle cx="93" cy="-11" r="0.35" />
      </g>
      <Ground h={botY} fill="#d9cfb4" line="#a2937a">
        <path d="M 0 1.6 L 100 1.6 M 0 3 L 100 3" stroke="#c4b798" strokeWidth="0.25" fill="none" />
      </Ground>
    </g>
  )
}

/** 固定种子星点（确定性计算，不随帧变化）；y 为距可视区底边的距离 */
const STARS: { x: number; y: number; r: number; o: number }[] = Array.from({ length: 26 }, (_, i) => {
  const a = Math.sin((i + 1) * 12.9898) * 43758.5453
  const b = Math.sin((i + 1) * 78.233 + 1.7) * 24634.6345
  return { x: 2 + (a - Math.floor(a)) * 96, y: 6 + (b - Math.floor(b)) * 58, r: 0.22 + (i % 3) * 0.1, o: 0.5 + (i % 4) * 0.12 }
})

function NightScene({ topY, botY }: { topY: number; botY: number }) {
  return (
    <g>
      <Sky id="lh-sky-night" topY={topY} botY={botY} from="#0b1530" to="#24365e" />
      {/* 星空与月亮：锚定可视区（无穷远），相机抬升时始终铺满天空 */}
      <g fill="#e8ecf7">
        {STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={botY - s.y} r={s.r} opacity={s.o} />
        ))}
      </g>
      <circle cx="78" cy={botY - 52} r="6" fill="#fff7d6" opacity="0.14" />
      <circle cx="78" cy={botY - 52} r="3.6" fill="#f4efcf" />
      {/* 夜海与海崖剪影 */}
      <path d="M 0 -3.2 Q 16 -6.4 32 -4.6 L 36 -4.6 L 36 0 L 0 0 Z" fill="#101c36" />
      <path d="M 44 -1.2 L 58 -1.2 M 66 -1.8 L 84 -1.8 M 50 -2.4 L 62 -2.4" stroke="#3d5a8a" strokeWidth="0.3" opacity="0.7" />
      <Ground h={botY} fill="#22304e" line="#0d1830">
        <path d="M 20 1.4 L 34 2.6 M 60 1.2 L 74 2.2" stroke="#182642" strokeWidth="0.4" fill="none" />
      </Ground>
    </g>
  )
}

/* ---------- 装饰道具（按楼高解锁；外层 CSS 位移 + 内层 SMIL，避免 transform 冲突） ---------- */

function AlpsBirds() {
  return (
    <>
      <g className="lh-fly">
        <g className="lh-bob">
          <Bird x={0} y={-34} s={1.1} color="#44506a" />
          <Bird x={5} y={-31} s={0.85} color="#44506a" />
        </g>
      </g>
      <g className="lh-fly" style={{ animationDelay: '-19s' }}>
        <g className="lh-bob" style={{ animationDelay: '-1.3s' }}>
          <Bird x={0} y={-44} s={0.9} color="#44506a" />
          <Bird x={4.5} y={-41.5} s={0.7} color="#44506a" />
        </g>
      </g>
    </>
  )
}

function AlpsCable() {
  return (
    <g>
      <line x1="20" y1="-46" x2="20" y2="0" stroke="#6b5a44" strokeWidth="0.7" />
      <line x1="80" y1="-46" x2="80" y2="0" stroke="#6b5a44" strokeWidth="0.7" />
      <line x1="20" y1="-46" x2="80" y2="-46" stroke="#4a4034" strokeWidth="0.35" />
      <g className="lh-shuttle">
        <line x1="22" y1="-46" x2="22" y2="-43.4" stroke="#4a4034" strokeWidth="0.3" />
        <rect x="19.8" y="-43.4" width="4.4" height="2.8" rx="0.6" fill="#b0533b" />
        <rect x="20.7" y="-42.9" width="2.6" height="1.2" rx="0.25" fill="#f4e9d8" />
      </g>
    </g>
  )
}

function AlpsBalloon() {
  return (
    <g className="lh-drift">
      <g transform="translate(76 -56)">
        <path d="M 0 0 C -3.2 -1.2 -3.8 -6 0 -8.6 C 3.8 -6 3.2 -1.2 0 0 Z" fill="#e5735f" />
        <path d="M 0 0 C -1.4 -1.4 -1.7 -6 0 -8.6 C 1.7 -6 1.4 -1.4 0 0 Z" fill="#f2b25c" opacity="0.9" />
        <line x1="-1" y1="0.1" x2="-1.1" y2="0.8" stroke="#7a5a3a" strokeWidth="0.2" />
        <line x1="1" y1="0.1" x2="1.1" y2="0.8" stroke="#7a5a3a" strokeWidth="0.2" />
        <rect x="-1.1" y="0.8" width="2.2" height="1.4" rx="0.4" fill="#7a5a3a" />
      </g>
    </g>
  )
}

function DesertEagle() {
  return (
    <g className="lh-fly" style={{ animationDuration: '30s' }}>
      <g className="lh-bob" style={{ animationDuration: '3.4s' }}>
        <Bird x={0} y={-48} s={2.1} color="#6e4f33" />
      </g>
    </g>
  )
}

function DesertCamels() {
  const camel = (x: number) => (
    <g transform={`translate(${x} -4.6) scale(0.9)`} fill="#7a5a3c">
      <ellipse cx="0" cy="-1.5" rx="1.7" ry="0.75" />
      <circle cx="-0.55" cy="-2.1" r="0.5" />
      <circle cx="0.5" cy="-2.05" r="0.45" />
      <path d="M 1.5 -1.9 Q 2.1 -2.6 2.3 -3.2 L 2.7 -3.1 Q 2.6 -2.2 2.1 -1.55 Z" />
      <rect x="-1.45" y="-1" width="0.3" height="1" />
      <rect x="-0.5" y="-1" width="0.3" height="1" />
      <rect x="0.6" y="-1" width="0.3" height="1" />
      <rect x="1.35" y="-1" width="0.3" height="1" />
    </g>
  )
  return (
    <g className="lh-camel">
      {camel(0)}
      {camel(-3.6)}
      {camel(-6.8)}
    </g>
  )
}

function SakuraLanterns() {
  const lantern = (x: number, y: number, dur: number, delay: number) => (
    <g transform={`translate(${x} ${y})`}>
      <g>
        <animateTransform attributeName="transform" type="rotate" values="-7 0 0;7 0 0;-7 0 0" dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" />
        <line x1="0" y1="0" x2="0" y2="2.2" stroke="#5a4436" strokeWidth="0.25" />
        <rect x="-0.85" y="2.2" width="1.7" height="2.1" rx="0.8" fill="#e8a0b4" />
        <rect x="-0.85" y="2.2" width="1.7" height="0.55" rx="0.25" fill="#c97f96" />
        <rect x="-0.5" y="4.3" width="1" height="0.35" rx="0.15" fill="#5a4436" />
      </g>
    </g>
  )
  return (
    <>
      {lantern(12.6, -7, 4.6, 0)}
      {lantern(89.4, -5.6, 5.2, -2.3)}
    </>
  )
}

function SakuraButterflies() {
  const bf = (x: number, y: number, dur: number, delay: number, color: string) => (
    <g transform={`translate(${x} ${y})`}>
      <g className="lh-flutter" style={{ animationDuration: `${dur}s`, animationDelay: `${delay}s` }}>
        <g>
          <animateTransform attributeName="transform" type="scale" values="1 1;0.3 1;1 1" dur="0.55s" repeatCount="indefinite" />
          <ellipse cx="-0.5" cy="-0.2" rx="0.5" ry="0.35" fill={color} />
          <ellipse cx="0.5" cy="-0.2" rx="0.5" ry="0.35" fill={color} />
          <rect x="-0.08" y="-0.45" width="0.16" height="0.85" rx="0.08" fill="#6e4a56" />
        </g>
      </g>
    </g>
  )
  return (
    <>
      {bf(16, -13, 13, 0, '#c9838f')}
      {bf(78, -10, 17, -6, '#b98cc9')}
    </>
  )
}

function NightGulls() {
  return (
    <>
      <g className="lh-fly" style={{ animationDuration: '46s' }}>
        <g className="lh-bob" style={{ animationDuration: '3.2s' }}>
          <Bird x={0} y={-14} s={1} color="#b9c6e2" />
          <Bird x={4} y={-11.5} s={0.75} color="#b9c6e2" />
        </g>
      </g>
      <g className="lh-fly" style={{ animationDuration: '52s', animationDelay: '-24s' }}>
        <g className="lh-bob" style={{ animationDelay: '-1.6s' }}>
          <Bird x={0} y={-19} s={0.85} color="#b9c6e2" />
        </g>
      </g>
    </>
  )
}

function NightMeteor() {
  return (
    <g transform="translate(66 -50)">
      <g className="lh-meteor">
        <line x1="0" y1="0" x2="5" y2="-2.6" stroke="#dfe7ff" strokeWidth="0.3" strokeLinecap="round" opacity="0.9" />
        <circle cx="5" cy="-2.6" r="0.45" fill="#ffffff" />
      </g>
    </g>
  )
}

/** 装饰道具层：楼高达标的道具永久出现在对应场景（画在积木之下） */
export function LevelProps({ level, maxTop }: { level: LevelDef; maxTop: number }) {
  const on = (id: string) => (SCENE_PROPS[level.id] ?? []).some((p) => p.id === id && maxTop >= p.unlockAt)
  switch (level.id) {
    case 'alps':
      return <g>{on('birds') && <AlpsBirds />}{on('cable') && <AlpsCable />}{on('balloon') && <AlpsBalloon />}</g>
    case 'desert':
      return <g>{on('eagle') && <DesertEagle />}{on('camel') && <DesertCamels />}</g>
    case 'sakura':
      return <g>{on('lantern') && <SakuraLanterns />}{on('butterfly') && <SakuraButterflies />}</g>
    case 'night':
      return <g>{on('gull') && <NightGulls />}{on('meteor') && <NightMeteor />}</g>
    default:
      return null
  }
}

/** 房顶样式（局部坐标：原点为房顶顶部中心，底边 y=6，物理宽 26 即 ±13） */
function AlpsRoof() {
  return (
    <g>
      <polygon points="-15,6 0,-8 15,6" fill="#6d4c33" stroke="#4e3521" strokeWidth="0.4" />
      <path d="M -10 3 L 10 3 M -6 -0.6 L 6 -0.6" stroke="#5b3f2a" strokeWidth="0.4" fill="none" />
      <rect x="4.6" y="-5.2" width="1.9" height="3" fill="#5b3f2a" />
      <rect x="4.2" y="-5.8" width="2.7" height="0.9" fill="#4e3521" />
      <polygon points="0,-8 -7.4,-1.8 7.4,-1.8" fill="#f4f8fb" />
      <path d="M -15 5.6 Q -7 1.4 0 0.8 Q 7 1.4 15 5.6" stroke="#f4f8fb" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </g>
  )
}

function DesertRoof() {
  return (
    <g>
      <rect x="-13.5" y="2.4" width="27" height="3.6" fill="#c89355" />
      <path d="M -13.5 4.2 L 13.5 4.2 M -9 5.4 L 9 5.4" stroke="#a97b45" strokeWidth="0.3" fill="none" />
      <rect x="-15.5" y="0" width="31" height="2.4" rx="0.6" fill="#d9a86a" stroke="#a97b45" strokeWidth="0.3" />
    </g>
  )
}

function SakuraRoof() {
  return (
    <g>
      <path d="M -15 6 L -15 4.8 Q -8 1.3 0 1.3 Q 8 1.3 15 4.8 L 15 6 Z" fill="#5f6e76" stroke="#46545c" strokeWidth="0.3" />
      <path d="M -12 6 L -12 4.4 M -7.2 6 L -7.2 3.6 M -2.4 6 L -2.4 3.2 M 2.4 6 L 2.4 3.2 M 7.2 6 L 7.2 3.6 M 12 6 L 12 4.4" stroke="#4d5b63" strokeWidth="0.3" fill="none" />
      <rect x="-7" y="0.1" width="14" height="1.3" rx="0.65" fill="#46545c" />
    </g>
  )
}

function NightRoof({ beamOn }: { beamOn: boolean }) {
  return (
    <g>
      {/* 光束：未解锁为静态双束；解锁后绕灯心 360 度旋转（SMIL，绕局部点 (0,3.4)） */}
      <g opacity="0.16">
        {beamOn ? (
          <g>
            <animateTransform attributeName="transform" type="rotate" from="0 0 3.4" to="360 0 3.4" dur="12s" repeatCount="indefinite" />
            <polygon points="2,3.4 46,1.2 46,5.6" fill="#ffe9a3" />
            <polygon points="-2,3.4 -46,1.2 -46,5.6" fill="#ffe9a3" />
          </g>
        ) : (
          <>
            <polygon points="4,3.4 44,0.8 44,6.2" fill="#ffe9a3" />
            <polygon points="-4,3.4 -44,0.8 -44,6.2" fill="#ffe9a3" />
          </>
        )}
      </g>
      <rect x="-4.8" y="1.3" width="9.6" height="4.1" fill="#2c3a55" stroke="#1e2a44" strokeWidth="0.3" />
      <rect x="-3.9" y="2.1" width="7.8" height="2.6" fill="#ffd66b" />
      <circle cx="0" cy="3.4" r="1.5" fill="#fff3c4" />
      <rect x="-6.6" y="5.2" width="13.2" height="0.8" fill="#31405f" />
      <polygon points="-5.8,1.3 0,-2 5.8,1.3" fill="#1e2a44" />
    </g>
  )
}

/** 关卡背景（天空 + 远景 + 地表），topY/botY 为可视区上下边界 */
export function LevelBackdrop({ level, topY, botY }: { level: LevelDef; topY: number; botY: number }) {
  switch (level.id) {
    case 'desert':
      return <DesertScene topY={topY} botY={botY} />
    case 'sakura':
      return <SakuraScene topY={topY} botY={botY} />
    case 'night':
      return <NightScene topY={topY} botY={botY} />
    default:
      return <AlpsScene topY={topY} botY={botY} />
  }
}

/** 房顶：y 为房顶底部世界高度；shake 时加抖动动画类；beamOn 控制夜关旋转光束 */
export function LevelRoof({ level, y, shake, beamOn }: { level: LevelDef; y: number; shake: boolean; beamOn: boolean }) {
  return (
    <g transform={`translate(${ROOF.cx} ${-(y + ROOF.h)})`}>
      <g className={shake ? 'lh-roof-shake' : undefined}>
        {level.id === 'desert' ? <DesertRoof /> : level.id === 'sakura' ? <SakuraRoof /> : level.id === 'night' ? <NightRoof beamOn={beamOn} /> : <AlpsRoof />}
      </g>
    </g>
  )
}
