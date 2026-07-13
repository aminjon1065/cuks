import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { cn } from '../lib/cn';

export interface OrgTreeNode {
  id: string;
  name: string;
  children?: OrgTreeNode[];
}

/** Org-unit tree selector (docs/06 §4). Presentational — tree supplied by the consumer. */
export interface OrgUnitPickerProps {
  tree: OrgTreeNode[];
  value?: string | null;
  onChange: (id: string | null) => void;
  placeholder?: React.ReactNode;
  disabled?: boolean;
  /** Show a row that clears the selection to `null` (move to root / global scope). */
  clearable?: boolean;
  clearLabel?: React.ReactNode;
}

function findName(nodes: OrgTreeNode[], id: string): string | undefined {
  for (const n of nodes) {
    if (n.id === id) return n.name;
    const found = n.children ? findName(n.children, id) : undefined;
    if (found) return found;
  }
  return undefined;
}

function TreeRows({
  nodes,
  depth,
  value,
  onSelect,
}: {
  nodes: OrgTreeNode[];
  depth: number;
  value: string | null | undefined;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = !!node.children && node.children.length > 0;
        const isCollapsed = collapsed.has(node.id);
        return (
          <li key={node.id}>
            <div
              className={cn(
                'flex items-center gap-1 rounded-sm pr-2 text-[13px] hover:bg-surface-2',
                node.id === value && 'bg-primary/5 text-primary',
              )}
              style={{ paddingLeft: `${depth * 14 + 4}px` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(node.id)) next.delete(node.id);
                      else next.add(node.id);
                      return next;
                    })
                  }
                  className="flex size-5 shrink-0 items-center justify-center text-text-muted"
                  aria-label="toggle"
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                </button>
              ) : (
                <span className="size-5 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => onSelect(node.id)}
                className="flex-1 truncate py-1.5 text-left"
              >
                {node.name}
              </button>
            </div>
            {hasChildren && !isCollapsed ? (
              <ul>
                <TreeRows
                  nodes={node.children ?? []}
                  depth={depth + 1}
                  value={value}
                  onSelect={onSelect}
                />
              </ul>
            ) : null}
          </li>
        );
      })}
    </>
  );
}

export function OrgUnitPicker({
  tree,
  value,
  onChange,
  placeholder = '—',
  disabled = false,
  clearable = false,
  clearLabel = '—',
}: OrgUnitPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const selectedName = value ? findName(tree, value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !selectedName && 'text-text-muted')}>
            {selectedName ?? placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-text-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-[var(--radix-popover-trigger-width)] overflow-y-auto">
        <ul>
          {clearable ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-[13px] text-text-muted hover:bg-surface-2"
              >
                {clearLabel}
              </button>
            </li>
          ) : null}
          <TreeRows
            nodes={tree}
            depth={0}
            value={value}
            onSelect={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        </ul>
      </PopoverContent>
    </Popover>
  );
}
