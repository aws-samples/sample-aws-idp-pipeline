import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

/**
 * Inline question card for the chat - the agent (ask_user tool) asks a
 * structured single/multi/free-text question and the user answers in place.
 * On completion the answers are formatted and posted back as the user's next
 * message so the agent reads the choice on its next turn. Adapted for the idp
 * chat theme (slate, dark-mode aware).
 */

const QUESTION_CUSTOM_ID = '__custom__';

function optionBadge(idx: number) {
  return String.fromCharCode(65 + idx);
}

export type QuestionOption = {
  id: string;
  label: string;
  description?: string;
};

export type QuestionConfig = {
  kind: 'single' | 'multi' | 'text';
  title: string;
  description?: string;
  options?: QuestionOption[];
  allowCustom?: boolean;
  placeholder?: string;
};

export type QuestionAnswer = {
  kind: 'single' | 'multi' | 'text' | 'skip';
  selectedIds?: string[];
  text?: string;
};

/** Parse an ask_user tool result into its question list. Returns null when the
 *  payload isn't an ask card (so the caller falls back to the normal pill). */
export function parseAskSpec(
  resultText: string | undefined,
): { questions: QuestionConfig[] } | null {
  if (!resultText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as { _ui_action?: string; questions?: unknown };
  if (obj._ui_action !== 'ask_user') return null;
  if (!Array.isArray(obj.questions) || obj.questions.length === 0) return null;
  return { questions: obj.questions as QuestionConfig[] };
}

/** Turn the user's answers into a concise message the agent reads next turn
 *  ("Q -> A" lines). */
export function formatAnswersForAgent(
  questions: QuestionConfig[],
  answers: QuestionAnswer[],
): string {
  const lines = questions.map((q, i) => {
    const a = answers[i];
    if (!a || a.kind === 'skip') return `${q.title} -> (skipped)`;
    if (a.kind === 'text') return `${q.title} -> ${a.text ?? ''}`;
    const labels = (a.selectedIds ?? [])
      .map((id) => q.options?.find((o) => o.id === id)?.label ?? id)
      .filter(Boolean);
    const parts = [...labels];
    if (a.text) parts.push(a.text);
    return `${q.title} -> ${parts.join(', ') || 'answered'}`;
  });
  return lines.join('\n');
}

function QuestionPrompt({
  question,
  questionIndex,
  totalQuestions,
  allowSkip = true,
  onSubmit,
}: {
  question: QuestionConfig;
  questionIndex: number;
  totalQuestions: number;
  allowSkip?: boolean;
  onSubmit: (answer: QuestionAnswer) => void;
}) {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customText, setCustomText] = useState('');
  const [textValue, setTextValue] = useState('');
  const customEnabled = question.allowCustom ?? false;
  const isLast = questionIndex >= totalQuestions;

  // Reset local state whenever the active question changes.
  useEffect(() => {
    setSelectedIds([]);
    setCustomText('');
    setTextValue('');
  }, [question]);

  const canSubmit = useMemo(() => {
    if (question.kind === 'text') return textValue.trim().length > 0;
    const selectedNonCustom = selectedIds.filter(
      (id) => id !== QUESTION_CUSTOM_ID,
    ).length;
    const hasCustomText = customText.trim().length > 0;
    const total = selectedNonCustom + (hasCustomText ? 1 : 0);
    if (question.kind === 'single') return total === 1;
    return total > 0;
  }, [question.kind, selectedIds, customText, textValue]);

  const toggleMulti = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleCustomTextChange = (nextValue: string) => {
    setCustomText(nextValue);
    if (question.kind === 'single') {
      setSelectedIds(nextValue.trim().length > 0 ? [QUESTION_CUSTOM_ID] : []);
      return;
    }
    setSelectedIds((prev) => {
      const hasCustom = prev.includes(QUESTION_CUSTOM_ID);
      if (nextValue.trim().length > 0 && !hasCustom) {
        return [...prev, QUESTION_CUSTOM_ID];
      }
      if (nextValue.trim().length === 0 && hasCustom) {
        return prev.filter((id) => id !== QUESTION_CUSTOM_ID);
      }
      return prev;
    });
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (question.kind === 'text') {
      onSubmit({ kind: 'text', text: textValue.trim() });
      return;
    }
    const selectedNonCustom = selectedIds.filter(
      (id) => id !== QUESTION_CUSTOM_ID,
    );
    onSubmit({
      kind: question.kind,
      selectedIds: selectedNonCustom,
      text: customText.trim() || undefined,
    });
  };

  const options = question.options ?? [];
  const optionRowBase =
    'w-full text-left rounded-md px-2 py-1.5 flex items-center gap-2 transition-colors hover:bg-slate-100 dark:hover:bg-white/10';
  const badgeBase =
    'h-5 min-w-5 px-1 rounded-[4px] inline-flex items-center justify-center text-xs font-semibold border';
  const badgeOff =
    'bg-transparent text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-600';
  const badgeOn = 'bg-blue-500 text-white border-blue-500';

  return (
    <div className="space-y-2 px-3 py-2">
      <div className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
        {totalQuestions > 1 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] px-1 text-xs font-medium text-slate-400 dark:text-slate-500">
            {questionIndex}
          </span>
        ) : null}
        <span className="font-medium">{question.title}</span>
      </div>
      {question.description ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {question.description}
        </p>
      ) : null}

      {question.kind !== 'text' && options.length > 0 ? (
        <div className="space-y-px">
          {options.map((option, idx) => {
            const checked = selectedIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  if (question.kind === 'single') {
                    setSelectedIds([option.id]);
                    if (customEnabled) setCustomText('');
                  } else {
                    toggleMulti(option.id);
                  }
                }}
                className={optionRowBase}
              >
                <span className={cn(badgeBase, checked ? badgeOn : badgeOff)}>
                  {optionBadge(idx)}
                </span>
                <span className="text-sm text-slate-800 dark:text-slate-100">
                  {option.label}
                  {option.description ? (
                    <span className="text-slate-400 dark:text-slate-500">
                      {' '}
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}

          {customEnabled ? (
            <div className="flex items-center gap-2 pt-1">
              <span
                className={cn(
                  badgeBase,
                  selectedIds.includes(QUESTION_CUSTOM_ID) ? badgeOn : badgeOff,
                )}
              >
                {optionBadge(options.length)}
              </span>
              <input
                value={customText}
                onChange={(e) => handleCustomTextChange(e.target.value)}
                placeholder={t('chat.question.customPlaceholder', 'Other...')}
                className="h-7 w-full rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-blue-400"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {question.kind === 'text' ? (
        <textarea
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          placeholder={
            question.placeholder ??
            t('chat.question.textPlaceholder', 'Type your answer...')
          }
          rows={3}
          className="w-full resize-y rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-blue-400"
        />
      ) : null}

      <div className="flex items-center justify-end gap-1.5">
        {allowSkip ? (
          <button
            type="button"
            onClick={() => onSubmit({ kind: 'skip' })}
            className="h-6 rounded-[4px] px-2 text-sm text-slate-400 dark:text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-slate-200"
          >
            {t('chat.question.skip', 'Skip')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="h-6 rounded-[4px] bg-blue-500 px-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
        >
          {isLast
            ? t('chat.question.confirm', 'Confirm')
            : t('chat.question.next', 'Next')}
        </button>
      </div>
    </div>
  );
}

/**
 * Stepped question card. Renders one question at a time, collects each answer,
 * and calls `onComplete` with the full list once every question is answered.
 * After completion (or if `answered` is set for a restored history card) it
 * shows a compact read-only summary instead of the interactive prompt.
 */
export function QuestionCard({
  questions,
  answered = false,
  onComplete,
}: {
  questions: QuestionConfig[];
  /** When true, render the read-only summary (e.g. a question already answered
   *  in a previous turn, restored from history). */
  answered?: boolean;
  onComplete?: (answers: QuestionAnswer[]) => void;
}) {
  const { t } = useTranslation();
  const totalQuestions = questions.length;
  const [index, setIndex] = useState(1);
  const [answers, setAnswers] = useState<Record<number, QuestionAnswer>>({});
  const [done, setDone] = useState(answered);

  const clampedIndex = Math.max(1, Math.min(index, totalQuestions));
  const question = questions[clampedIndex - 1];

  const summaryText = useMemo(() => {
    if (!done) return '';
    return questions
      .map((q, i) => {
        const a = answers[i + 1];
        if (!a || a.kind === 'skip')
          return `${q.title}: ${t('chat.question.skipped', 'skipped')}`;
        if (a.kind === 'text') return `${q.title}: ${a.text ?? ''}`;
        const labels = (a.selectedIds ?? [])
          .map((id) => q.options?.find((o) => o.id === id)?.label ?? id)
          .filter(Boolean);
        const parts = [...labels];
        if (a.text) parts.push(a.text);
        return `${q.title}: ${parts.join(', ') || t('chat.question.answered', 'answered')}`;
      })
      .join(' · ');
  }, [done, questions, answers, t]);

  if (!question) return null;

  return (
    <div className="overflow-hidden rounded-[10px] border border-blue-200 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-900/10">
      <div className="flex h-7 items-center justify-between border-b border-blue-100 dark:border-blue-900/40 px-3 text-xs">
        <span className="font-semibold text-blue-600 dark:text-blue-400">
          {t('chat.question.header', 'Please choose')}
        </span>
        {totalQuestions > 1 && !done ? (
          <span className="text-slate-400 dark:text-slate-500">
            {clampedIndex} / {totalQuestions}
          </span>
        ) : null}
      </div>

      {done ? (
        <div className="bg-white/60 dark:bg-slate-800/40 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
          {summaryText ||
            t('chat.question.answeredHint', 'This question was answered.')}
        </div>
      ) : (
        <QuestionPrompt
          key={`${clampedIndex}-${question.title}`}
          question={question}
          questionIndex={clampedIndex}
          totalQuestions={totalQuestions}
          onSubmit={(answer) => {
            const next = { ...answers, [clampedIndex]: answer };
            setAnswers(next);
            if (clampedIndex < totalQuestions) {
              setIndex((i) => Math.min(totalQuestions, i + 1));
            } else {
              setDone(true);
              onComplete?.(
                questions.map((_, i) => next[i + 1] ?? { kind: 'skip' }),
              );
            }
          }}
        />
      )}
    </div>
  );
}
