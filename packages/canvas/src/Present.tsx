/**
 * Present — fullscreen playback of the deck with the same reveal semantics
 * the pptx timing injector writes: click/→ steps through entrance-animation
 * groups (per-bullet for byParagraph lists), then advances slides with their
 * transitions. Esc exits.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Deck, ThemeTokens } from "@deckforge/schema";
import { revealPlan, solveSlide } from "@deckforge/layout";
import { BoxView, cssGradient } from "./BoxView.js";

interface Props {
  deck: Deck;
  tokens: ThemeTokens;
  startIndex: number;
  onExit: () => void;
}

export function Present({ deck, tokens, startIndex, onExit }: Props) {
  const [idx, setIdx] = useState(startIndex);
  const [step, setStep] = useState(0);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  const slide = deck.slides[idx];
  const resolved = useMemo(() => solveSlide(slide, tokens), [slide, tokens]);
  const plan = useMemo(() => revealPlan(resolved), [resolved]);
  const scale = Math.min(size.w / 1280, size.h / 720);

  const forward = useCallback(() => {
    if (step < plan.totalSteps) setStep((s) => s + 1);
    else if (idx < deck.slides.length - 1) {
      setIdx((i) => i + 1);
      setStep(0);
    } else onExit();
  }, [step, plan.totalSteps, idx, deck.slides.length, onExit]);

  const back = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
    else if (idx > 0) {
      const prev = solveSlide(deck.slides[idx - 1], tokens);
      setIdx((i) => i - 1);
      setStep(revealPlan(prev).totalSteps);
    }
  }, [step, idx, deck.slides, tokens]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
      else if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") forward();
      else if (e.key === "ArrowLeft" || e.key === "PageUp") back();
    };
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [forward, back, onExit]);

  const transClass =
    slide.transition && slide.transition.type !== "none"
      ? `df-trans-${slide.transition.type}-${slide.transition.direction ?? "left"}`
      : "";

  const animCls = (effect: string, direction?: string) =>
    `df-anim-${effect}${effect === "flyIn" || effect === "wipe" ? `-${direction ?? "bottom"}` : ""}`;

  return (
    <div className="present" onClick={forward}>
      <div
        key={slide.id}
        className={`present-slide ${transClass}`}
        style={{
          width: 1280 * scale,
          height: 720 * scale,
          background: resolved.gradient ? cssGradient(resolved.gradient) : resolved.background,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {resolved.boxes.map((box) => {
          const wholeStep = plan.stepOf.get(box.id);
          if (wholeStep !== undefined) {
            if (wholeStep > step) return null;
            const justNow = wholeStep === step;
            return (
              <BoxView
                key={box.id}
                box={box}
                scale={scale}
                animClass={() =>
                  justNow && box.anim ? animCls(box.anim.effect, box.anim.direction) : ""
                }
              />
            );
          }
          // per-paragraph reveals
          const hasParaSteps = box.kind === "text" && plan.stepOf.has(`${box.id}#0`);
          if (hasParaSteps) {
            return (
              <BoxView
                key={box.id}
                box={box}
                scale={scale}
                paraVisible={(pi) => (plan.stepOf.get(`${box.id}#${pi}`) ?? 0) <= step}
                animClass={(pi) =>
                  pi !== undefined && plan.stepOf.get(`${box.id}#${pi}`) === step && box.anim
                    ? animCls(box.anim.effect, box.anim.direction)
                    : ""
                }
              />
            );
          }
          return <BoxView key={box.id} box={box} scale={scale} />;
        })}
      </div>
      <div className="present-hud">
        {idx + 1} / {deck.slides.length}
        {plan.totalSteps > 0 ? ` · step ${step}/${plan.totalSteps}` : ""} — Esc to exit
      </div>
    </div>
  );
}
