import { useState, useRef, useEffect } from 'react';
import type { ProjectPlan } from '../types';

interface Props {
  plan:       ProjectPlan;
  onConfirm:  (clarifyChoice?: string) => void;
  onReject:   () => void;
  onRefine?:  (feedback: string) => void;
}

export function PlanCard({ plan, onConfirm, onReject, onRefine }: Props) {
  const [chosen,     setChosen]     = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [selected,   setSelected]   = useState<string[]>([]);
  const [customText, setCustomText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const needsClarify = !!(plan.clarifyingQuestion && plan.clarifyOptions?.length);
  const canConfirm   = !needsClarify || chosen !== null;

  const suggestions = plan.suggestions ?? [];

  useEffect(() => {
    if (isRefining) textareaRef.current?.focus();
  }, [isRefining]);

  const toggleSuggestion = (s: string) => {
    setSelected((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const openRefineWithChip = (s: string) => {
    setSelected([s]);
    setIsRefining(true);
  };

  const handleRegenerate = () => {
    const parts = [...selected];
    if (customText.trim()) parts.push(customText.trim());
    if (parts.length === 0) return;
    if (onRefine) {
      onRefine(parts.join('; '));
    } else {
      onReject();
    }
  };

  const hasRefinement = selected.length > 0 || customText.trim().length > 0;

  // ── Refine mode ───────────────────────────────────────────────
  if (isRefining) {
    return (
      <div className="plan-card">
        <div className="plan-card__header">
          <span className="plan-card__icon">✏️</span>
          <span className="plan-card__title">What would you like to change?</span>
        </div>

        <p className="plan-card__summary plan-card__summary--dim">
          Original: {plan.summary}
        </p>

        {suggestions.length > 0 && (
          <div className="plan-card__clarify">
            <div className="plan-card__label">Quick options</div>
            <div className="plan-card__clarify-options">
              {suggestions.map((s) => (
                <button
                  key={s}
                  className={`plan-card__clarify-opt${selected.includes(s) ? ' plan-card__clarify-opt--active' : ''}`}
                  onClick={() => toggleSuggestion(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="plan-card__clarify">
          <div className="plan-card__label">Or describe your change</div>
          <textarea
            ref={textareaRef}
            className="plan-card__refine-input"
            placeholder="e.g. use TypeScript, add dark mode, use PostgreSQL…"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            rows={2}
          />
        </div>

        <div className="plan-card__actions">
          <button
            className="plan-card__confirm"
            onClick={handleRegenerate}
            disabled={!hasRefinement}
          >
            Regenerate plan
          </button>
          <button
            className="plan-card__reject"
            onClick={() => { setIsRefining(false); setSelected([]); setCustomText(''); }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // ── Normal plan view ──────────────────────────────────────────
  return (
    <div className="plan-card">
      <div className="plan-card__header">
        <span className="plan-card__icon">📋</span>
        <span className="plan-card__title">Here's my plan</span>
      </div>

      <p className="plan-card__summary">{plan.summary}</p>

      <div className="plan-card__grid">
        {plan.files.length > 0 && (
          <div className="plan-card__section">
            <div className="plan-card__label">Files</div>
            <div className="plan-card__chips">
              {plan.files.map((f) => (
                <span key={f} className="plan-card__chip">{f}</span>
              ))}
            </div>
          </div>
        )}

        {plan.uses.length > 0 && (
          <div className="plan-card__section">
            <div className="plan-card__label">Uses</div>
            <div className="plan-card__chips">
              {plan.uses.map((u) => (
                <span key={u} className="plan-card__chip plan-card__chip--tech">{u}</span>
              ))}
            </div>
          </div>
        )}

        {plan.features.length > 0 && (
          <div className="plan-card__section">
            <div className="plan-card__label">Features</div>
            <ul className="plan-card__features">
              {plan.features.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* Clarifying question (e.g. PWA vs React Native) */}
      {needsClarify && (
        <div className="plan-card__clarify">
          <div className="plan-card__label">{plan.clarifyingQuestion}</div>
          <div className="plan-card__clarify-options">
            {plan.clarifyOptions!.map((opt) => (
              <button
                key={opt}
                className={`plan-card__clarify-opt${chosen === opt ? ' plan-card__clarify-opt--active' : ''}`}
                onClick={() => setChosen(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Improvement suggestions */}
      {suggestions.length > 0 && (
        <div className="plan-card__suggestions">
          <div className="plan-card__label">💡 Suggestions to improve</div>
          <div className="plan-card__suggestion-chips">
            {suggestions.map((s) => (
              <button
                key={s}
                className="plan-card__suggestion-chip"
                onClick={() => openRefineWithChip(s)}
                title="Click to add this to the plan"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="plan-card__actions">
        <button
          className="plan-card__confirm"
          onClick={() => onConfirm(chosen ?? undefined)}
          disabled={!canConfirm}
        >
          Yes, build it
        </button>
        <button
          className="plan-card__reject"
          onClick={() => setIsRefining(true)}
        >
          Change something
        </button>
        <button
          className="plan-card__cancel"
          onClick={onReject}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
