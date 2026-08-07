"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A deliberately tiny rich-text editor for a message page's written message.
 * `document.execCommand` is deprecated but universally supported and — crucially
 * — emits exactly the tags on our server allowlist (b/i/u/ul/ol/li), so the
 * editor output and the API sanitiser can't drift (ADR 0132). The API sanitises
 * again on save regardless, so this is convenience, not the trust boundary.
 *
 * contentEditable is uncontrolled by nature: we seed innerHTML once on mount and
 * report changes up via `onChange`, rather than re-writing innerHTML on every
 * render (which would fight the caret).
 */
const TOOLS: { label: string; command: string; title: string }[] = [
  { label: "B", command: "bold", title: "Bold" },
  { label: "I", command: "italic", title: "Italic" },
  { label: "U", command: "underline", title: "Underline" },
  { label: "•", command: "insertUnorderedList", title: "Bulleted list" },
  { label: "1.", command: "insertOrderedList", title: "Numbered list" },
];

export function RichTextEditor({
  initialHtml,
  onChange,
  placeholder,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(initialHtml.trim().length === 0);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = initialHtml;
      setIsEmpty(ref.current.textContent?.trim().length === 0);
    }
    // Seed once; the parent owns the value from here via onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => {
    const html = ref.current?.innerHTML ?? "";
    setIsEmpty(ref.current?.textContent?.trim().length === 0);
    onChange(html);
  };

  const run = (command: string) => {
    ref.current?.focus();
    document.execCommand(command);
    emit();
  };

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {TOOLS.map((tool) => (
          <button
            key={tool.command}
            type="button"
            title={tool.title}
            aria-label={tool.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(tool.command)}
            className="flex size-8 items-center justify-center rounded-md text-sm font-semibold text-foreground/70 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            {tool.label}
          </button>
        ))}
      </div>
      <div className="relative">
        <div
          ref={ref}
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label="Message"
          onInput={emit}
          onBlur={emit}
          className="min-h-[8rem] w-full px-3 py-2.5 text-sm leading-relaxed outline-none [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
        />
        {isEmpty && placeholder && (
          <p className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted">
            {placeholder}
          </p>
        )}
      </div>
    </div>
  );
}
