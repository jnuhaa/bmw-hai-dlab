type ContextCardProps = {
  eyebrow: string;
  title: string;
  description: string;
  stats: Array<{ label: string; value: string }>;
};

export function ContextCard({
  eyebrow,
  title,
  description,
  stats,
}: ContextCardProps) {
  return (
    <section className="context-hud">
      <div className="context-card__content">
        <p className="context-card__eyebrow">{eyebrow}</p>
        <h2 className="context-card__title">{title}</h2>
        <p className="context-card__description">{description}</p>
      </div>
      <div className="context-card__meta" aria-label="Session metadata">
        {stats.map((stat) => (
          <div key={stat.label}>
            <span className="context-card__meta-label">{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
