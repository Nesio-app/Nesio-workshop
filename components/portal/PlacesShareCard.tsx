'use client';

/**
 * PlacesShareCard — 原创足迹成就卡「WHERE I'VE BEEN」(不照抄参考的地球金卡)。
 *
 * 全用官方 token(由 resolveShareTokens 读出具体值):brand/deep 陶棕做强调 + visited 点,
 * muted 灰做未到访点;干净编辑体(衬线大数字 + 小号大写标签),无 emoji。
 * 渲染成 SVG:同一份既做屏幕预览、又能序列化后光栅化存图(色值已内联,不含 var())。
 * 灰粉(浅)/ 夜(深)共用同一套 token —— 深色发 IG Stories/X,浅色发小红书/IG feed。
 */

import { forwardRef } from 'react';
import { worldDotCells, WORLD_GRID, type PlacesShareStats, type ShareCardColors } from '@/lib/portal/places-share';

export const SHARE_CARD_W = 400;
export const SHARE_CARD_H = 500;

const SERIF = "'Noto Serif SC', Georgia, 'Times New Roman', serif";
const SANS = "'Noto Sans SC', system-ui, -apple-system, sans-serif";

function fmtKm(km: number): string {
  return km.toLocaleString('en-US');
}

const PlacesShareCard = forwardRef<SVGSVGElement, {
  stats: PlacesShareStats;
  colors: ShareCardColors;
  zh?: boolean;                          // 卡片文案随设置语言(默认英文编辑体)
}>(function PlacesShareCard({ stats, colors, zh = false }, ref) {
  const { accent, ink, sub, mutedDot, line, cardBg, onAccent } = colors;
  const cells = worldDotCells();

  // 点阵地图几何
  const mapX = 50, mapY = 178, mapW = 300;
  const cell = mapW / WORLD_GRID.w;      // ≈ 9.375
  const dotR = 2.6;
  const visited = new Set(stats.visitedContinents);

  const kicker = zh ? `去过的地方 · ${stats.year}` : `WHERE I'VE BEEN · ${stats.year}`;
  const bigNum = zh ? `${stats.countries} 国` : `${stats.countries}`;
  const bigWord = zh ? '' : (stats.countries === 1 ? 'country' : 'countries');
  const subLine = zh
    ? `${stats.continents} 洲 · 占世界 ${stats.worldPct}%`
    : `${stats.continents} ${stats.continents === 1 ? 'continent' : 'continents'} · ${stats.worldPct}% of the world`;
  const streakLabel = zh ? '连续天数' : 'DAY STREAK';
  const furthestLabel = stats.furthest ? (zh ? `最远 · ${fmtKm(stats.furthest.km)} 公里` : `FURTHEST · ${fmtKm(stats.furthest.km)} KM`) : '';

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${SHARE_CARD_W} ${SHARE_CARD_H}`}
      width="100%"
      role="img"
      aria-label={`${kicker}: ${bigNum}`}
      style={{ display: 'block', borderRadius: 24 }}
    >
      <rect x="0" y="0" width={SHARE_CARD_W} height={SHARE_CARD_H} rx="24" fill={cardBg} />

      {/* kicker */}
      <text x="28" y="64" fill={accent} fontFamily={SANS} fontSize="13" fontWeight="700"
        letterSpacing={zh ? '0.5' : '2.5'}>{kicker}</text>

      {/* 大数字 */}
      <text x="26" y="120" fill={ink} fontFamily={SERIF} fontSize="44" fontWeight="700">
        {bigNum}{bigWord && <tspan fontSize="40"> {bigWord}</tspan>}
      </text>

      {/* 副行 */}
      <text x="28" y="150" fill={sub} fontFamily={SANS} fontSize="17" fontWeight="500">
        {subLine}
      </text>

      {/* 点阵世界地图 */}
      <g>
        {cells.map((c) => {
          const isV = visited.has(c.continent);
          return (
            <circle
              key={`${c.row}-${c.col}`}
              cx={mapX + c.col * cell + cell / 2}
              cy={mapY + c.row * cell + cell / 2}
              r={dotR}
              fill={isV ? accent : mutedDot}
              fillOpacity={isV ? 1 : 0.32}
            />
          );
        })}
      </g>

      {/* 分割线 */}
      <line x1="28" y1="348" x2="372" y2="348" stroke={line} strokeWidth="1" />

      {/* 连续天数 */}
      <text x="28" y="388" fill={ink} fontFamily={SERIF} fontSize="28" fontWeight="700">{stats.dayStreak}</text>
      <text x="28" y="406" fill={sub} fontFamily={SANS} fontSize="11" fontWeight="600" letterSpacing={zh ? '0.5' : '1.5'}>{streakLabel}</text>

      {/* 最远的地方 */}
      {stats.furthest && (
        <>
          <text x="150" y="386" fill={ink} fontFamily={SERIF} fontSize="22" fontWeight="700">{stats.furthest.name}</text>
          <text x="150" y="405" fill={sub} fontFamily={SANS} fontSize="11" fontWeight="600" letterSpacing={zh ? '0.5' : '1.2'}>
            {furthestLabel}
          </text>
        </>
      )}

      {/* 页脚:品牌 + 域名 */}
      <g>
        <rect x="28" y="446" width="20" height="20" rx="6" fill={accent} />
        <text x="38" y="461" fill={onAccent} fontFamily={SERIF} fontSize="13" fontWeight="700" textAnchor="middle">N</text>
        <text x="56" y="461" fill={ink} fontFamily={SANS} fontSize="14" fontWeight="700">Nesio</text>
        <text x="372" y="461" fill={sub} fontFamily={SANS} fontSize="12" fontWeight="500" textAnchor="end">nesio.app</text>
      </g>
    </svg>
  );
});

export default PlacesShareCard;
