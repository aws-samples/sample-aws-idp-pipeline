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
      'flex h-full w-full',
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
    className={cn('splitter-handle', orientation, className)}
  />
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
