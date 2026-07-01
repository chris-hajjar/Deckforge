/**
 * steps.ts — click-step semantics for entrance animations.
 * Mirrors exactly what the pptx timing injector emits, so Present mode in
 * the canvas and PowerPoint's slideshow reveal things in the same order:
 * one step per `order` group; byParagraph lists reveal bullet 0 with the
 * group, then one bullet per following click.
 */
import type { ResolvedBox, ResolvedSlide } from "./types.js";

export interface RevealPlan {
  /** Number of clicks available on the slide. */
  totalSteps: number;
  /**
   * Reveal step per unit: key is boxId, or `${boxId}#${paraIndex}` for
   * per-paragraph builds. Units absent from the map are always visible.
   */
  stepOf: Map<string, number>;
}

export function revealPlan(slide: ResolvedSlide): RevealPlan {
  const stepOf = new Map<string, number>();
  const animated = slide.boxes.filter((b) => b.anim);
  const orders = [...new Set(animated.map((b) => b.anim!.order))].sort((a, b) => a - b);
  let step = 0;
  for (const order of orders) {
    step += 1;
    const groupStep = step;
    const followUps: Array<{ box: ResolvedBox; para: number }> = [];
    for (const box of animated.filter((b) => b.anim!.order === order)) {
      const paras = box.kind === "text" ? box.paragraphs.length : 0;
      if (box.anim!.byParagraph && paras > 1) {
        stepOf.set(`${box.id}#0`, groupStep);
        for (let p = 1; p < paras; p++) followUps.push({ box, para: p });
      } else {
        stepOf.set(box.id, groupStep);
      }
    }
    for (const f of followUps) {
      step += 1;
      stepOf.set(`${f.box.id}#${f.para}`, step);
    }
  }
  return { totalSteps: step, stepOf };
}
