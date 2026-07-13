import { useEffect, useState } from "react";

interface Props {
  /** The committed numeric value, or undefined when the field is empty. */
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  min?: number;
  max?: number;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
}

/**
 * A numeric input that lets you actually type. The old profile/goals form
 * clamped every keystroke, so `Number("")===0` snapped a cleared field to the
 * min and a partial "7" (toward "70") jumped to 25 mid-entry. This holds a
 * RAW STRING while editing, allows empty, emits the parsed value live
 * (unclamped, so multi-digit entry isn't fought), and only clamps + rounds on
 * blur. Same pattern the plan wizard already uses for height/weight.
 */
export function NumberField({ value, onChange, min, max, className = "text-input", placeholder, "aria-label": ariaLabel }: Props) {
  const [raw, setRaw] = useState<string>(value != null ? String(value) : "");

  // Resync from the outside only when the committed value changes to something
  // the field isn't already showing (e.g. "Use recommended" sets goals) — never
  // mid-typing, which would clobber the caret.
  useEffect(() => {
    const typed = raw.trim() === "" ? undefined : Number(raw);
    if (value !== typed) setRaw(value != null ? String(value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (s: string) => {
    if (s.trim() === "") {
      onChange(undefined);
      return;
    }
    const n = Number(s);
    if (Number.isFinite(n)) onChange(n);
  };

  const commit = () => {
    if (raw.trim() === "") {
      onChange(undefined);
      return;
    }
    let n = Number(raw);
    if (!Number.isFinite(n)) {
      setRaw("");
      onChange(undefined);
      return;
    }
    n = Math.round(n);
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    setRaw(String(n));
    onChange(n);
  };

  return (
    <input
      className={className}
      type="text"
      inputMode="numeric"
      value={raw}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => {
        const v = e.target.value;
        // Allow only a numeric shape (digits + one optional dot); empty allowed.
        if (v === "" || /^\d*\.?\d*$/.test(v)) {
          setRaw(v);
          emit(v);
        }
      }}
      onBlur={commit}
    />
  );
}
