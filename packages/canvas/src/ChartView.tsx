/**
 * ChartView — SVG preview of a ChartBox, following the dataviz mark specs:
 * thin marks with 2px surface gaps, 2px lines with ≥8px markers, recessive
 * hairline grid, ink in text tokens (never series color), legend for ≥2
 * series, selective direct labels (data ends / last point — never every
 * point), native <title> hover tooltips.
 *
 * The exported .pptx renders the same data as a NATIVE PowerPoint chart, so
 * this preview is semantically identical (type/data/colors/labels) though
 * PowerPoint draws its own axes.
 */
import type { ChartBox } from "@deckforge/layout";
import { FONT_STACKS } from "./BoxView.js";

const fmt = (v: number): string =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v * 100) / 100}`;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

export function ChartView({ box, scale }: { box: ChartBox; scale: number }) {
  const w = box.w * scale;
  const h = box.h * scale;
  const font = FONT_STACKS[box.fontId];
  const fs = 11 * scale * (box.w > 500 ? 1.4 : 1); // readable at deck sizes
  const legendH = box.legend ? fs * 2.2 : 0;

  const legend = box.legend && (
    <g>
      {(() => {
        const items =
          box.chartType === "pie" || box.chartType === "donut"
            ? box.categories.map((c, i) => ({ name: c, color: box.palette[i % box.palette.length] }))
            : box.series.map((s) => ({ name: s.name, color: s.color }));
        const itemW = Math.min(w / items.length, fs * 10);
        const total = itemW * items.length;
        return items.map((it, i) => (
          <g key={i} transform={`translate(${(w - total) / 2 + i * itemW}, ${h - fs * 1.2})`}>
            <rect width={fs * 0.9} height={fs * 0.9} rx={2 * scale} fill={it.color} y={-fs * 0.75} />
            <text x={fs * 1.2} fill={box.ink.muted} fontSize={fs} fontFamily={font}>
              {it.name}
            </text>
          </g>
        ));
      })()}
    </g>
  );

  // ---------- pie / donut ----------
  if (box.chartType === "pie" || box.chartType === "donut") {
    const values = box.series[0]?.values ?? [];
    const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = w / 2;
    const cy = (h - legendH) / 2;
    const R = Math.max(10, Math.min(w, h - legendH) / 2 - fs * 2);
    const r0 = box.chartType === "donut" ? R * 0.55 : 0;
    let a0 = -Math.PI / 2;
    const arcs = values.map((v, i) => {
      const frac = Math.max(0, v) / total;
      const a1 = a0 + frac * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
      const d =
        r0 > 0
          ? `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`
          : `M ${cx} ${cy} L ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} Z`;
      const mid = (a0 + a1) / 2;
      a0 = a1;
      return { d, mid, v, i, frac };
    });
    return (
      <svg width={w} height={h} style={{ overflow: "visible" }}>
        {arcs.map((a) => (
          <path
            key={a.i}
            d={a.d}
            fill={box.palette[a.i % box.palette.length]}
            stroke={box.surface}
            strokeWidth={2 * scale} // surface gap between slices
          >
            <title>{`${box.categories[a.i]}: ${fmt(a.v)}`}</title>
          </path>
        ))}
        {box.dataLabels &&
          arcs
            .filter((a) => a.frac > 0.04)
            .map((a) => (
              <text
                key={`l${a.i}`}
                x={cx + (R + fs) * Math.cos(a.mid)}
                y={cy + (R + fs) * Math.sin(a.mid)}
                fill={box.ink.muted}
                fontSize={fs}
                fontFamily={font}
                textAnchor={Math.cos(a.mid) > 0.2 ? "start" : Math.cos(a.mid) < -0.2 ? "end" : "middle"}
              >
                {fmt(a.v)}
              </text>
            ))}
        {legend}
      </svg>
    );
  }

  // ---------- axis charts ----------
  const horizontal = box.chartType === "bar";
  const maxCatW = Math.max(...box.categories.map((c) => c.length)) * fs * 0.55;
  const padL = horizontal ? Math.min(maxCatW + fs, w * 0.3) : fs * 3.2;
  const padB = fs * 1.8 + legendH;
  const padT = fs * 1.2;
  const padR = fs;
  const plotW = Math.max(10, w - padL - padR);
  const plotH = Math.max(10, h - padT - padB);
  const vMax = niceMax(Math.max(...box.series.flatMap((s) => s.values), 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * vMax);
  const n = box.categories.length;
  const vx = (v: number) => (v / vMax) * (horizontal ? plotW : plotH);

  const gridAndAxes = (
    <g>
      {ticks.map((t, i) => {
        const pos = vx(t);
        return horizontal ? (
          <g key={i}>
            <line x1={padL + pos} y1={padT} x2={padL + pos} y2={padT + plotH} stroke={box.ink.grid} strokeWidth={1} />
            <text x={padL + pos} y={padT + plotH + fs * 1.2} fill={box.ink.muted} fontSize={fs * 0.9} fontFamily={font} textAnchor="middle">
              {fmt(t)}
            </text>
          </g>
        ) : (
          <g key={i}>
            <line x1={padL} y1={padT + plotH - pos} x2={padL + plotW} y2={padT + plotH - pos} stroke={box.ink.grid} strokeWidth={1} />
            <text x={padL - fs * 0.5} y={padT + plotH - pos + fs * 0.35} fill={box.ink.muted} fontSize={fs * 0.9} fontFamily={font} textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        );
      })}
    </g>
  );

  const catLabels = (
    <g>
      {box.categories.map((c, i) => {
        const slot = (horizontal ? plotH : plotW) / n;
        const center = slot * i + slot / 2;
        const every = Math.max(1, Math.ceil((fs * 3.5) / slot));
        if (i % every !== 0) return null;
        return horizontal ? (
          <text key={i} x={padL - fs * 0.5} y={padT + center + fs * 0.35} fill={box.ink.muted} fontSize={fs} fontFamily={font} textAnchor="end">
            {c}
          </text>
        ) : (
          <text key={i} x={padL + center} y={padT + plotH + fs * 1.3} fill={box.ink.muted} fontSize={fs} fontFamily={font} textAnchor="middle">
            {c}
          </text>
        );
      })}
    </g>
  );

  let marks: React.ReactNode = null;
  if (box.chartType === "column" || box.chartType === "bar") {
    const nS = box.series.length;
    const slot = (horizontal ? plotH : plotW) / n;
    const groupSize = slot * 0.64; // thin marks
    const gap = 2 * scale; // surface gap between adjacent bars
    const barSize = Math.max(2, (groupSize - gap * (nS - 1)) / nS);
    marks = box.series.map((s, si) =>
      s.values.map((v, ci) => {
        const along = slot * ci + (slot - groupSize) / 2 + si * (barSize + gap);
        const len = vx(Math.max(0, v));
        const label = box.dataLabels && (
          <text
            {...(horizontal
              ? { x: padL + len + fs * 0.4, y: padT + along + barSize / 2 + fs * 0.35, textAnchor: "start" as const }
              : { x: padL + along + barSize / 2, y: padT + plotH - len - fs * 0.4, textAnchor: "middle" as const })}
            fill={box.ink.muted}
            fontSize={fs * 0.9}
            fontFamily={font}
          >
            {fmt(v)}
          </text>
        );
        return (
          <g key={`${si}-${ci}`}>
            <rect
              {...(horizontal
                ? { x: padL, y: padT + along, width: len, height: barSize }
                : { x: padL + along, y: padT + plotH - len, width: barSize, height: len })}
              fill={s.color}
              rx={Math.min(4 * scale, barSize / 2)}
            >
              <title>{`${s.name} · ${box.categories[ci]}: ${fmt(v)}`}</title>
            </rect>
            {label}
          </g>
        );
      }),
    );
  } else {
    // line / area
    const slot = plotW / n;
    const pt = (ci: number, v: number) => ({ x: padL + slot * ci + slot / 2, y: padT + plotH - vx(v) });
    marks = box.series.map((s, si) => {
      const pts = s.values.map((v, ci) => pt(ci, v));
      const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
      const areaPath = `${poly} ${pts[pts.length - 1].x},${padT + plotH} ${pts[0].x},${padT + plotH}`;
      const last = pts[pts.length - 1];
      return (
        <g key={si}>
          {box.chartType === "area" && <polygon points={areaPath} fill={s.color} opacity={0.3} />}
          <polyline points={poly} fill="none" stroke={s.color} strokeWidth={2 * scale} strokeLinejoin="round" />
          {pts.map((p, ci) => (
            <circle key={ci} cx={p.x} cy={p.y} r={4 * scale} fill={s.color} stroke={box.surface} strokeWidth={2 * scale}>
              <title>{`${s.name} · ${box.categories[ci]}: ${fmt(s.values[ci])}`}</title>
            </circle>
          ))}
          {box.dataLabels && (
            // selective direct label: last point only, in ink
            <text x={last.x + fs * 0.5} y={last.y + fs * 0.35} fill={box.ink.muted} fontSize={fs * 0.9} fontFamily={font}>
              {fmt(s.values[s.values.length - 1])}
            </text>
          )}
        </g>
      );
    });
  }

  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      {gridAndAxes}
      {catLabels}
      {marks}
      {legend}
    </svg>
  );
}
