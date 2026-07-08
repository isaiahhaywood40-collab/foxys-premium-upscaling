interface DetailCropsProps {
  beforeUrl?: string | null;
  afterUrl?: string | null;
}

/**
 * 100% pixel center crops — this is where you actually see AI vs bilinear.
 * Full-frame sliders often hide the difference because both sides are scaled down.
 */
export function DetailCrops({ beforeUrl, afterUrl }: DetailCropsProps) {
  if (!beforeUrl || !afterUrl) return null;

  return (
    <div className="detail-crops">
      <p className="detail-crops-title">100% detail (center crop)</p>
      <p className="detail-crops-hint">
        Zoomed pixels — this is where quality differences show. Full preview often
        hides them.
      </p>
      <div className="detail-crops-row">
        <figure>
          <img src={beforeUrl} alt="Original 100% crop" draggable={false} />
          <figcaption>Original (simple enlarge)</figcaption>
        </figure>
        <figure>
          <img src={afterUrl} alt="Enhanced 100% crop" draggable={false} />
          <figcaption>AI upscaled</figcaption>
        </figure>
      </div>
    </div>
  );
}
