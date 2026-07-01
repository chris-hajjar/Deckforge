# Chart palettes

Chart series colors are **not hand-picked**. Each theme carries a
`chartPalette`: eight categorical hues in a **fixed order**, assigned to
series in sequence and never cycled — the slot order is the colorblind-safety
mechanism. Both palettes were validated with the dataviz six-checks validator
(OKLCH lightness band, chroma floor, Machado-2009 CVD separation on adjacent
pairs, contrast vs surface) against the surface each theme actually renders
charts on.

## corporate-bold (light, surface `#ffffff`)

| Slot | Hue | Hex |
|---|---|---|
| 1 | blue | `#2a78d6` |
| 2 | aqua | `#1baf7a` |
| 3 | yellow | `#eda100` |
| 4 | green | `#008300` |
| 5 | violet | `#4a3aa7` |
| 6 | red | `#e34948` |
| 7 | magenta | `#e87ba4` |
| 8 | orange | `#eb6834` |

Validator result: lightness band PASS, chroma PASS, worst adjacent CVD
ΔE 24.2 PASS (target ≥12). Three slots (aqua, yellow, magenta) sit below 3:1
contrast on white — the **relief rule** applies, which is why charts default
to `dataLabels: true` (visible direct value labels).

## minimalist-dark (dark, surface `#0f1419`)

| Slot | Hue | Hex |
|---|---|---|
| 1 | blue | `#3987e5` |
| 2 | aqua | `#199e70` |
| 3 | yellow | `#c98500` |
| 4 | green | `#008300` |
| 5 | violet | `#9085e9` |
| 6 | red | `#e66767` |
| 7 | magenta | `#d55181` |
| 8 | orange | `#d95926` |

Validator result: lightness band PASS, chroma PASS, contrast all ≥3:1 PASS;
worst adjacent CVD ΔE 10.3 (floor band 8–12) — legal only with secondary
encoding, which the renderer provides structurally: 2px surface gaps between
adjacent fills (grouped bars, pie slices, line markers) plus direct labels.

## Enforced chart rules

- **One value axis.** The schema cannot express a dual-axis chart.
- **≤ 8 series.** Auto-correction folds extras (fixed slots, never cycled).
- **Ink wears text tokens** (`text-primary`/`text-secondary`), never a series
  color; gridlines are `surface-alt` hairlines.
- **Legend** defaults on for ≥2 series and for pie/donut (slice identity);
  off for a single cartesian series — the slide heading names it.
- **Selective direct labels:** data-end values on bars/columns, last-point
  value on lines/areas — never a number on every point.
- Exports are **native editable PowerPoint charts** (real `chartN.xml` parts
  with source data), not pictures of charts. PowerPoint draws its own axes,
  so chart geometry is semantically identical to the canvas preview rather
  than coordinate-identical like every other element.

## Re-validating (e.g. for a brand palette)

Run the dataviz validator against the theme's surfaces:

```
node <dataviz-skill>/scripts/validate_palette.js "<hex,...>" --mode light --surface "#ffffff"
node <dataviz-skill>/scripts/validate_palette.js "<hex,...>" --mode dark  --surface "#0f1419"
```

Fix any FAIL before committing a palette; honor WARN obligations (labels/
gaps) in the renderer defaults.
