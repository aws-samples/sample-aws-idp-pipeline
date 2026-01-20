import { Splitter } from '@ark-ui/react/splitter';
import type { ComponentProps } from 'react';

function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(' ');
}

const ResizablePanelGroup = ({
  className,
  orientation = 'horizontal',
  ...props
}: ComponentProps<typeof Splitter.Root> & {
  orientation?: 'horizontal' | 'vertical';
}) => (
  <Splitter.Root
    orientation={orientation}
    className={cn(
      'flex h-full w-full gap-2',
      orientation === 'vertical' ? 'flex-col' : '',
      className,
    )}
    {...props}
  />
);

const ResizablePanel = ({
  className,
  ...props
}: ComponentProps<typeof Splitter.Panel>) => (
  <Splitter.Panel className={cn('', className)} {...props} />
);

const ResizableHandle = ({
  id,
  orientation = 'horizontal',
  className,
}: {
  id: `${string}:${string}`;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) => (
  <Splitter.ResizeTrigger
    id={id}
    aria-label="Resize"
    className={cn(
      'rounded-full transition-colors duration-200 outline-none',
      'bg-slate-300 dark:bg-slate-600',
      'hover:bg-slate-400 dark:hover:bg-slate-500',
      'active:bg-slate-400 dark:active:bg-slate-500',
      orientation === 'horizontal' ? 'min-w-1.5 my-4' : 'min-h-1.5 mx-4',
      className,
    )}
  />
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
