import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../lib/utils";

export function ModelSelector(props: {
  models: { availability: "available" | "unsupported"; id: string; label: string }[];
  selectedModel: string;
  setSelectedModel(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = props.models.find((m) => m.id === props.selectedModel) ?? null;
  const normalizedQuery = query.trim().toLowerCase();

  const filtered = normalizedQuery
    ? props.models.filter(
        (m) =>
          m.label.toLowerCase().includes(normalizedQuery) ||
          m.id.toLowerCase().includes(normalizedQuery)
      )
    : props.models;

  const selectModel = useCallback(
    (modelId: string) => {
      props.setSelectedModel(modelId);
      setQuery("");
      setOpen(false);
    },
    [props]
  );

  useEffect(() => {
    setHighlightIndex(0);
  }, [normalizedQuery]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightIndex(0);
    }
  }, [open]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      scrollToHighlighted(Math.min(highlightIndex + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
      scrollToHighlighted(Math.max(highlightIndex - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[highlightIndex]) {
        selectModel(filtered[highlightIndex].id);
      }
    }
  }

  function scrollToHighlighted(index: number) {
    /* v8 ignore next 5 -- jsdom has no scrollIntoView */
    const list = listRef.current;
    if (!list) return;
    const items = list.querySelectorAll("[data-model-item]");
    const target = items[index] as HTMLElement | undefined;
    target?.scrollIntoView?.({ block: "nearest" });
  }

  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Trigger asChild>
        <button
          aria-label="Select model"
          className={cn(
            "flex items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-3 py-1.5 text-sm font-medium transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
          type="button"
        >
          <span className="truncate max-w-[200px]">
            {selected?.label ?? "Select model"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          className="z-50 w-[320px] rounded-xl border border-border/70 bg-popover p-0 shadow-lg animate-fade-in"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          sideOffset={6}
        >
          <div className="flex items-center border-b px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              aria-label="Search models"
              className="flex-1 bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search models..."
              value={query}
            />
          </div>

          <div
            ref={listRef}
            aria-label="Model results"
            className="max-h-[280px] overflow-y-auto p-1"
            role="listbox"
          >
            {filtered.length > 0 ? (
              filtered.map((model, index) => {
                const isSelected = model.id === props.selectedModel;
                const isHighlighted = index === highlightIndex;
                const isUnsupported = model.availability === "unsupported";

                return (
                  <button
                    key={model.id}
                    aria-selected={isSelected}
                    disabled={isUnsupported}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                      isHighlighted
                        ? "bg-accent text-accent-foreground"
                        : "text-popover-foreground",
                      !isHighlighted && !isUnsupported && "hover:bg-accent/50",
                      isUnsupported && "cursor-not-allowed opacity-50"
                    )}
                    data-model-item
                    onClick={() => {
                      if (!isUnsupported) {
                        selectModel(model.id);
                      }
                    }}
                    onMouseEnter={() => {
                      if (!isUnsupported) {
                        setHighlightIndex(index);
                      }
                    }}
                    role="option"
                    type="button"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="block truncate font-medium">{model.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {model.id}
                      </span>
                    </div>
                    {isUnsupported ? (
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Unavailable
                      </span>
                    ) : isSelected ? (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No models match.
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
