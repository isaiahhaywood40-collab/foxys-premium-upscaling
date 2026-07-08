import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";

interface CompareSliderProps {
  beforeUrl?: string | null;
  afterUrl?: string | null;
  beforeLabel?: string;
  afterLabel?: string;
  emptyHint?: string;
  /** Hide section header (for compact result card). */
  compact?: boolean;
  /** Extra class on track (e.g. fullscreen). */
  className?: string;
}

/**
 * Competitor-style before/after scrubber.
 * Portrait-friendly: track aspect follows the image.
 * Left = original, right = enhanced.
 */
export function CompareSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = "Original",
  afterLabel = "Enhanced",
  emptyHint = "Load a file and run enhance to compare quality here.",
  compact = false,
  className = "",
}: CompareSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const [trackW, setTrackW] = useState(0);
  const [aspect, setAspect] = useState<number | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    setPos(50);
  }, [beforeUrl, afterUrl]);

  // Measure natural aspect from whichever image loads
  useEffect(() => {
    const url = afterUrl || beforeUrl;
    if (!url) {
      setAspect(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setAspect(img.naturalWidth / img.naturalHeight);
      }
    };
    img.src = url;
  }, [beforeUrl, afterUrl]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [beforeUrl, afterUrl, aspect]);

  const setFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(100, Math.max(0, x)));
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setFromClientX(e.clientX);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPos((p) => Math.max(0, p - 2));
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setPos((p) => Math.min(100, p + 2));
    }
  };

  const hasBefore = Boolean(beforeUrl);
  const hasAfter = Boolean(afterUrl);
  const hasMedia = hasBefore || hasAfter;
  const baseUrl = afterUrl || beforeUrl;

  const trackStyle =
    aspect != null
      ? { aspectRatio: `${aspect}`, maxHeight: "min(70vh, 640px)" as const }
      : undefined;

  return (
    <div className={`compare${compact ? " compare-compact" : ""}`}>
      {!compact && (
        <div className="section-head">
          <h3>Quality compare</h3>
          <p>Drag the handle — left original, right enhanced.</p>
        </div>
      )}

      <div
        ref={trackRef}
        className={`compare-track${hasMedia ? " has-media" : ""} ${className}`.trim()}
        style={trackStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        aria-label="Original versus enhanced comparison"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {!hasMedia && (
          <div className="compare-empty">
            <span>{emptyHint}</span>
          </div>
        )}

        {hasMedia && baseUrl && (
          <>
            <div className="compare-layer compare-base">
              <img
                src={baseUrl}
                alt={hasAfter ? afterLabel : beforeLabel}
                draggable={false}
              />
            </div>

            {hasBefore && beforeUrl && (
              <div
                className="compare-layer compare-reveal"
                style={{ width: `${pos}%` }}
              >
                <div
                  className="compare-reveal-inner"
                  style={{ width: trackW > 0 ? `${trackW}px` : "100vw" }}
                >
                  <img src={beforeUrl} alt={beforeLabel} draggable={false} />
                </div>
              </div>
            )}

            <div
              className="compare-handle"
              style={{ left: `${pos}%` }}
              aria-hidden
            >
              <div className="compare-line" />
              <div className="compare-knob">
                <span className="knob-tri knob-left" />
                <span className="knob-tri knob-right" />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
