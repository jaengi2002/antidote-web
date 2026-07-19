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

  if (card.type === 'hidden') {
    return (
      <div className={`gcard gcard--back gcard--${size}`} title="뒷면 (X)">
        <div className="gcard__grain" />
        <div className="gcard__back-pattern">
          <div className="gcard__back-seal">X?</div>
        </div>
      </div>
    );
  }

  const isSyringe = card.type === 'syringe';
  const isX = card.type === 'x';
  const isPlacebo = card.type === 'placebo';
  const isClinical = card.type === 'clinical';
  const isSpecial = isSyringe || isPlacebo || isClinical;
  const f = isSpecial ? null : formulaMeta(formulas, card.formulaId);
  const color = f?.color || (isPlacebo ? '#6b7280' : isClinical ? '#2563eb' : '#2c3e50');
  const soft = f?.colorSoft || (isPlacebo ? '#f3f4f6' : isClinical ? '#dbeafe' : '#eef2f5');
  const ink = f?.ink || '#1a1a1a';
  const symbol = card.symbol || f?.symbol || (isPlacebo ? 'bio' : isClinical ? 'molecule' : 'skull');
  const rank = isX ? 'X' : isSyringe ? 'S' : isPlacebo ? 'P' : isClinical ? 'C' : String(card.value ?? '');
  const name = isSyringe
    ? '주사기'
    : isPlacebo
      ? '플라시보'
      : isClinical
        ? '임상 실험'
        : f?.name || card.name || card.label;
  const nameEn = isSyringe
    ? 'SYRINGE'
    : isPlacebo
      ? 'PLACEBO'
      : isClinical
        ? 'CLINICAL'
        : f?.nameEn || card.nameEn || '';

  const classNames = [
    'gcard',
    `gcard--${size}`,
    isSyringe ? 'gcard--syringe' : '',
    isPlacebo ? 'gcard--syringe' : '',
    isClinical ? 'gcard--syringe' : '',
    isX ? 'gcard--toxin' : '',
    !isSpecial && !isX ? 'gcard--number' : '',
    selected ? 'is-selected' : '',
    dimmed ? 'is-dimmed' : '',
    interactive || onClick ? 'is-interactive' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const style = isSpecial
    ? {
        '--card-ink': ink,
        '--card-accent': color,
        '--card-soft': soft,
        '--card-edge': color,
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
          {isSpecial ? (
            <>
              <div className="gcard__syringe-badge">
                {isSyringe ? 'TOOL' : isPlacebo ? 'PLACEBO' : 'TRIAL'}
              </div>
              <div className="gcard__hero gcard__hero--syringe">
                <SymbolGlyph symbol={isSyringe ? 'syringe' : symbol} />
              </div>
              <div className="gcard__title">{name}</div>
              <div className="gcard__subtitle">{nameEn}</div>
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
