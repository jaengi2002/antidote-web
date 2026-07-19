import { SymbolGlyph } from './symbols';

function formulaMeta(formulas, formulaId) {
  return formulas?.find((f) => f.id === formulaId) || null;
}

/**
 * Physical playing-card face (poker-ish 5:7). Triple-coded: color + symbol + name/rank.
 */
export function GameCard({
  card,
  formulas,
  selected = false,
  dimmed = false,
  size = 'md',
  onClick,
  interactive = false,
  title,
}) {
  if (!card) return null;

  const isSyringe = card.type === 'syringe';
  const isX = card.type === 'x';
  const f = isSyringe ? null : formulaMeta(formulas, card.formulaId);
  const color = f?.color || '#2c3e50';
  const soft = f?.colorSoft || '#eef2f5';
  const ink = f?.ink || '#1a1a1a';
  const symbol = card.symbol || f?.symbol || 'skull';
  const rank = isX ? 'X' : isSyringe ? 'S' : String(card.value ?? '');
  const name = isSyringe ? '주사기' : f?.name || card.name || card.label;
  const nameEn = isSyringe ? 'SYRINGE' : f?.nameEn || card.nameEn || '';

  const classNames = [
    'gcard',
    `gcard--${size}`,
    isSyringe ? 'gcard--syringe' : '',
    isX ? 'gcard--toxin' : '',
    !isSyringe && !isX ? 'gcard--number' : '',
    selected ? 'is-selected' : '',
    dimmed ? 'is-dimmed' : '',
    interactive || onClick ? 'is-interactive' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const style = isSyringe
    ? {
        '--card-ink': '#1a2332',
        '--card-accent': '#3d5a4c',
        '--card-soft': '#e8efe9',
        '--card-edge': '#2a4035',
      }
    : {
        '--card-ink': ink,
        '--card-accent': color,
        '--card-soft': soft,
        '--card-edge': color,
      };

  const inner = (
    <>
      <div className="gcard__grain" aria-hidden />
      <div className="gcard__border">
        {/* Single upright corner only — rotated BR corners blur text on screens */}
        {!isSyringe && (
          <div className="gcard__corner gcard__corner--tl">
            <span className="gcard__rank">{rank}</span>
            <span className="gcard__mini">
              <SymbolGlyph symbol={symbol} />
            </span>
          </div>
        )}

        <div className="gcard__body">
          {isSyringe ? (
            <>
              <div className="gcard__syringe-badge">RESEARCH</div>
              <div className="gcard__hero gcard__hero--syringe">
                <SymbolGlyph symbol="syringe" />
              </div>
              <div className="gcard__title">주사기</div>
              <div className="gcard__subtitle">SYRINGE</div>
              <p className="gcard__hint">버린 카드 회수 · 손패 훔치기</p>
            </>
          ) : (
            <>
              {isX && <div className="gcard__ribbon">TOXIN · X</div>}
              <div className="gcard__hero" style={{ color }}>
                <SymbolGlyph symbol={symbol} />
              </div>
              <div className="gcard__title" style={{ color: ink }}>
                {name}
              </div>
              <div className="gcard__subtitle">{nameEn}</div>
              <div className="gcard__footer-line">
                {isX ? (
                  <span className="gcard__tag gcard__tag--x">X</span>
                ) : (
                  <span className="gcard__tag">{rank}</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );

  if (onClick || interactive) {
    return (
      <button
        type="button"
        className={classNames}
        style={style}
        onClick={onClick}
        title={title || card.label}
        disabled={!onClick}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={classNames} style={style} title={title || card.label}>
      {inner}
    </div>
  );
}

export function CardBack({ size = 'md', count, label }) {
  return (
    <div className={`gcard gcard--back gcard--${size}`} title={label}>
      <div className="gcard__grain" />
      <div className="gcard__back-pattern">
        <div className="gcard__back-seal">ANTIDOTE</div>
        {typeof count === 'number' && <div className="gcard__back-count">×{count}</div>}
      </div>
    </div>
  );
}

export function FormulaChip({ formula, eliminated, selected, onClick, size = 'sm' }) {
  if (!formula) return null;
  return (
    <button
      type="button"
      className={`fchip fchip--${size} ${eliminated ? 'is-elim' : ''} ${selected ? 'is-selected' : ''}`}
      style={{
        '--chip': formula.color,
        '--chip-soft': formula.colorSoft,
        '--chip-ink': formula.ink,
      }}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="fchip__icon" style={{ color: formula.color }}>
        <SymbolGlyph symbol={formula.symbol} />
      </span>
      <span className="fchip__text">
        <strong>{formula.name}</strong>
        <small>{formula.nameEn}</small>
      </span>
      {eliminated && <span className="fchip__x">제외</span>}
    </button>
  );
}
