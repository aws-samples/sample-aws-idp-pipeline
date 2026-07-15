import { Combobox } from '@base-ui/react/combobox';
import { PreviewCard } from '@base-ui/react/preview-card';
import { Brain, ChevronDown, Search } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

// Chat model with the metric bars shown in the preview card. Only Anthropic
// models are offered here (the agent passes model_id straight to Bedrock and
// the runtime IAM role gates access), so there is no provider column - reasoning
// is the only per-model knob.
export type LlmModel = {
  value: string;
  label: string;
  description: string;
  contextWindow: string;
  inputPrice: string;
  outputPrice: string;
  metrics: {
    intelligence: number;
    speed: number;
    context: number;
    cost: number;
  };
  // Whether the model accepts a reasoning/effort level. Models without it
  // (e.g. Sonnet 4.6) hide the reasoning control and never send a reasoning
  // value. Defaults to true when omitted.
  supportsReasoning?: boolean;
};

export type ReasoningLevel = 'low' | 'medium' | 'high';

export type ModelSelectorPromptProps = {
  models: readonly LlmModel[];
  value: string;
  reasonings: Record<string, ReasoningLevel>;
  onModelChange: (model: LlmModel) => void;
  onReasoningChange: (
    modelValue: string,
    reasoning: ReasoningLevel,
    reasonings: Record<string, ReasoningLevel>,
  ) => void;
};

const DEFAULT_REASONING: ReasoningLevel = 'medium';

function getReasoning(
  reasonings: Record<string, ReasoningLevel>,
  modelValue: string,
): ReasoningLevel {
  return reasonings[modelValue] ?? DEFAULT_REASONING;
}

const REASONING_INTELLIGENCE_DELTA: Record<ReasoningLevel, number> = {
  low: -2,
  medium: 0,
  high: 2,
};

function clampMetric(value: number) {
  return Math.min(10, Math.max(1, Math.round(value)));
}

// Only surface a badge when reasoning is off the default, so the trigger stays
// clean for the common case.
function ReasoningBadge({ reasoning }: { reasoning: ReasoningLevel }) {
  const { t } = useTranslation();
  if (reasoning === 'medium') return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-slate-100 dark:bg-white/10 px-1 py-0.5 text-[10px] text-slate-500 dark:text-slate-400">
      <Brain className="w-2.5 h-2.5 text-blue-500" />
      {t(`chat.model.${reasoning}`)}
    </span>
  );
}

// Metric bar color by score (invert flips it so low cost reads green).
function metricColor(value: number, invert: boolean) {
  const score = invert ? 11 - value : value;
  if (score >= 8) return '#10b981'; // emerald-500
  if (score >= 6) return '#3b82f6'; // blue-500
  if (score >= 4) return '#f59e0b'; // amber-500
  return '#ef4444'; // red-500
}

// A single segment that grows up from the bottom on mount, so bars animate in
// on model swap / reasoning change.
function GrowSegment({ color, delay }: { color: string; delay: number }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      className="h-full w-full origin-bottom rounded-sm transition-transform duration-300 ease-out"
      style={{
        backgroundColor: color,
        transform: grown ? 'scaleY(1)' : 'scaleY(0)',
        transitionDelay: `${delay}ms`,
      }}
    />
  );
}

function MetricBar({
  label,
  value,
  info,
  invert = false,
  animationKey,
}: {
  label: string;
  value: number;
  info?: string;
  invert?: boolean;
  animationKey: string;
}) {
  const color = metricColor(value, invert);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[10px] font-medium uppercase leading-none text-slate-400 dark:text-slate-500">
          {label}
        </span>
        {info ? (
          <span
            className="cursor-help text-[10px] leading-none text-slate-400 dark:text-slate-500"
            title={info}
          >
            &#9432;
          </span>
        ) : null}
      </div>
      <div
        aria-label={`${label}: ${value} out of 10`}
        className="grid grid-cols-10 gap-1"
        key={animationKey}
        role="img"
      >
        {Array.from({ length: 10 }, (_, index) => (
          <div
            className="h-3 overflow-hidden rounded-sm bg-slate-100 dark:bg-white/10"
            key={index}
          >
            {index < value ? (
              <GrowSegment color={color} delay={index * 25} />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function SegmentedRadio<TValue extends string>({
  ariaLabel,
  onValueChange,
  options,
  value,
}: {
  ariaLabel: string;
  onValueChange: (value: TValue) => void;
  options: { label: string; value: TValue }[];
  value: TValue;
}) {
  return (
    <div aria-label={ariaLabel} className="flex gap-1" role="radiogroup">
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            aria-checked={checked}
            className={cn(
              'flex-1 rounded-lg px-2 py-1 text-xs transition-colors',
              checked
                ? 'bg-blue-500 text-white'
                : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/15 hover:text-slate-700 dark:hover:text-slate-200',
            )}
            key={option.value}
            onClick={() => onValueChange(option.value)}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ModelPreviewPanel({
  model,
  reasoning,
  onReasoningChange,
}: {
  model: LlmModel;
  reasoning: ReasoningLevel;
  onReasoningChange: (reasoning: ReasoningLevel) => void;
}) {
  const { t } = useTranslation();
  const adjustedMetrics = useMemo(
    () => ({
      intelligence: clampMetric(
        model.metrics.intelligence + REASONING_INTELLIGENCE_DELTA[reasoning],
      ),
      speed: model.metrics.speed,
      context: model.metrics.context,
      cost: model.metrics.cost,
    }),
    [model.metrics, reasoning],
  );
  return (
    <div className="flex w-56 flex-col divide-y divide-slate-200 dark:divide-slate-700">
      <div className="flex flex-col gap-3 p-3">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {model.label}
        </p>
        <p className="text-pretty text-xs leading-4 text-slate-500 dark:text-slate-400">
          {model.description}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-4 text-xs">
          <MetricBar
            animationKey={`${model.value}-${reasoning}`}
            label={t('chat.model.intelligence', 'Intelligence')}
            value={adjustedMetrics.intelligence}
          />
          <MetricBar
            animationKey={model.value}
            label={t('chat.model.speed', 'Speed')}
            value={adjustedMetrics.speed}
          />
          <MetricBar
            animationKey={model.value}
            info={t('chat.model.contextWindow', {
              value: model.contextWindow,
              defaultValue: '{{value}} context window',
            })}
            label={t('chat.model.context', 'Context')}
            value={adjustedMetrics.context}
          />
          <MetricBar
            animationKey={model.value}
            info={t('chat.model.priceInfo', {
              input: model.inputPrice,
              output: model.outputPrice,
              defaultValue: '{{input}} input · {{output}} output',
            })}
            invert
            label={t('chat.model.cost', 'Cost')}
            value={adjustedMetrics.cost}
          />
        </div>
      </div>
      {model.supportsReasoning !== false ? (
        <div className="flex flex-col gap-3 p-3">
          <p className="font-mono text-[10px] font-semibold uppercase leading-none text-slate-500 dark:text-slate-400">
            {t('chat.model.reasoning', 'Reasoning')}
          </p>
          <SegmentedRadio<ReasoningLevel>
            ariaLabel={t('chat.model.reasoning', 'Reasoning')}
            onValueChange={onReasoningChange}
            options={[
              { label: t('chat.model.low', 'Low'), value: 'low' },
              { label: t('chat.model.medium', 'Medium'), value: 'medium' },
              { label: t('chat.model.high', 'High'), value: 'high' },
            ]}
            value={reasoning}
          />
        </div>
      ) : null}
    </div>
  );
}

function ModelListWithScrollFade({
  children,
}: {
  // Combobox.List renders items via a render function (item, index) => node.
  children: ReactNode | ((item: LlmModel, index: number) => ReactNode);
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [showBottomFade, setShowBottomFade] = useState(false);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    function updateBottomFade() {
      const el = listRef.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      setShowBottomFade(scrollHeight - scrollTop - clientHeight > 4);
    }
    updateBottomFade();
    list.addEventListener('scroll', updateBottomFade, { passive: true });
    const resizeObserver = new ResizeObserver(updateBottomFade);
    resizeObserver.observe(list);
    return () => {
      list.removeEventListener('scroll', updateBottomFade);
      resizeObserver.disconnect();
    };
  }, []);
  return (
    <div className="relative">
      <Combobox.List
        className="max-h-64 overflow-y-auto overscroll-contain p-1"
        ref={listRef}
      >
        {children}
      </Combobox.List>
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-white dark:from-slate-800 to-transparent transition-opacity duration-150',
          showBottomFade ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}

function ModelComboboxItem({
  model,
  reasoning,
  previewHandle,
}: {
  model: LlmModel;
  reasoning: ReasoningLevel;
  previewHandle: PreviewCard.Handle<LlmModel>;
}) {
  return (
    <Combobox.Item
      className="group w-full p-0 text-slate-500 dark:text-slate-400 data-[selected]:text-slate-800 dark:data-[selected]:text-slate-100"
      value={model}
    >
      <PreviewCard.Trigger
        className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-slate-100 dark:hover:bg-white/10 group-data-[selected]:bg-slate-100 dark:group-data-[selected]:bg-white/10"
        closeDelay={180}
        delay={80}
        handle={previewHandle}
        payload={model}
        render={<div />}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{model.label}</span>
          <span className="truncate text-xs text-slate-500 dark:text-slate-400">
            {model.description}
          </span>
        </div>
        <ReasoningBadge reasoning={reasoning} />
      </PreviewCard.Trigger>
    </Combobox.Item>
  );
}

/**
 * Model picker with a hover preview card (metric bars + a per-model reasoning
 * control). Reasoning is remembered per model. The trigger renders inline in
 * the chat composer.
 */
export function ModelSelectorPrompt({
  models,
  value,
  reasonings,
  onModelChange,
  onReasoningChange,
}: ModelSelectorPromptProps) {
  const { t } = useTranslation();
  const fallbackModel = models[0];
  const selectedModel = models.find((m) => m.value === value) ?? fallbackModel;
  const previewHandle = useMemo(() => PreviewCard.createHandle<LlmModel>(), []);

  function updateReasoning(modelValue: string, reasoning: ReasoningLevel) {
    const next = { ...reasonings, [modelValue]: reasoning };
    onReasoningChange(modelValue, reasoning, next);
    // Changing a model's reasoning in its preview card also selects that model,
    // so picking "Opus + High" applies immediately instead of only updating the
    // reasoning of a model the user hasn't actually chosen.
    if (modelValue !== selectedModel.value) {
      const model = models.find((m) => m.value === modelValue);
      if (model) onModelChange(model);
    }
  }
  function closeModelPreview() {
    previewHandle.close();
  }

  return (
    <Combobox.Root<LlmModel>
      autoHighlight
      isItemEqualToValue={(item, nextValue) => item.value === nextValue.value}
      items={models as LlmModel[]}
      onInputValueChange={closeModelPreview}
      onValueChange={(nextModel) => {
        if (nextModel) onModelChange(nextModel);
      }}
      value={selectedModel}
    >
      <Combobox.Trigger
        aria-label="Select model"
        className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-slate-200 data-[popup-open]:bg-slate-100 dark:data-[popup-open]:bg-white/10"
      >
        <Combobox.Value>
          {(model: LlmModel | null) =>
            model ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{model.label}</span>
                <ReasoningBadge
                  reasoning={getReasoning(reasonings, model.value)}
                />
              </span>
            ) : (
              <span>{t('chat.model.select', 'Select model')}</span>
            )
          }
        </Combobox.Value>
        <Combobox.Icon className="text-slate-400 dark:text-slate-500">
          <ChevronDown className="w-3.5 h-3.5" />
        </Combobox.Icon>
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner align="start" sideOffset={4}>
          <Combobox.Popup
            aria-label="Select model"
            className="w-60 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg outline-none z-50"
          >
            <PreviewCard.Root<LlmModel> handle={previewHandle}>
              {({ payload }) => (
                <>
                  <Combobox.InputGroup className="flex items-center gap-1.5 rounded-none border-0 border-b border-slate-200 dark:border-slate-700 bg-transparent px-2">
                    <Combobox.Input
                      className="w-full bg-transparent px-0 py-2 text-sm outline-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                      onFocus={closeModelPreview}
                      placeholder={t(
                        'chat.model.searchPlaceholder',
                        'Search models...',
                      )}
                    />
                    <Search
                      aria-hidden="true"
                      className="shrink-0 w-3.5 h-3.5 text-slate-400 dark:text-slate-500"
                    />
                  </Combobox.InputGroup>
                  <Combobox.Empty>
                    <div className="px-2 py-2 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
                      {t('chat.model.notFound', 'No models found')}
                    </div>
                  </Combobox.Empty>
                  <ModelListWithScrollFade>
                    {(model: LlmModel) => (
                      <ModelComboboxItem
                        key={model.value}
                        model={model}
                        previewHandle={previewHandle}
                        reasoning={getReasoning(reasonings, model.value)}
                      />
                    )}
                  </ModelListWithScrollFade>
                  <PreviewCard.Portal keepMounted>
                    <PreviewCard.Positioner
                      align="center"
                      className="z-[60]"
                      side="right"
                      sideOffset={8}
                    >
                      <PreviewCard.Popup className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg outline-none">
                        {payload ? (
                          <ModelPreviewPanel
                            model={payload}
                            onReasoningChange={(reasoning) =>
                              updateReasoning(payload.value, reasoning)
                            }
                            reasoning={getReasoning(reasonings, payload.value)}
                          />
                        ) : null}
                      </PreviewCard.Popup>
                    </PreviewCard.Positioner>
                  </PreviewCard.Portal>
                </>
              )}
            </PreviewCard.Root>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
