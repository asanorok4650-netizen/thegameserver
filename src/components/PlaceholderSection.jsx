export default function PlaceholderSection({ id, title, description, icon, heading, body }) {
  return (
    <section className="section-block" id={id}>
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="placeholder-panel">
        <div className="empty-icon">{icon}</div>
        <strong>{heading}</strong>
        <span>{body}</span>
      </div>
    </section>
  );
}
