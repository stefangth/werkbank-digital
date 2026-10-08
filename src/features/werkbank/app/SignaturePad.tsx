import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The canvas is a document, not themed UI: the PNG lands on white paper in the office view and
 *  the PDF, so it is painted white with black ink in both colour modes (CSS colour keywords). */
const PAPER = "white";
const INK = "black";
const MAX_PIXEL_RATIO = 2;

/** A finger signature on a canvas with pointer events. Reports a PNG after every stroke and
 *  `null` while the pad is empty (on mount and after "Löschen"). */
export function SignaturePad({ onChange, className }: { onChange: (png: Blob | null) => void; className?: string }) {
  const { t } = useTranslation("werkbank");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  const context = () => canvasRef.current?.getContext("2d") ?? null;

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      const { width, height } = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }
    drawing.current = false;
    onChangeRef.current(null);
  }, []);

  useEffect(() => clear(), [clear]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = context();
    if (!ctx) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = context();
    if (!drawing.current || !ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const endStroke = () => {
    if (!drawing.current) return;
    drawing.current = false;
    canvasRef.current?.toBlob((png) => onChangeRef.current(png), "image/png");
  };

  return (
    <div className={cn("space-y-2", className)}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t("app.report.padLabel")}
        className="block h-48 w-full touch-none rounded-control border border-border"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />
      <Button type="button" variant="secondary" size="touch" onClick={clear}>{t("app.report.clear")}</Button>
    </div>
  );
}
