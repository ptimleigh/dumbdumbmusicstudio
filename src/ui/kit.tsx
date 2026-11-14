import { useEffect, useRef, useState, type ReactNode } from 'react';

/* ---------- icons: 24px, drawn with strokes so they follow the text color ---------- */
const P: Record<string, ReactNode> = {
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>,
  menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
  download: <><path d="M12 4v11" /><path d="m7 10.5 5 4.5 5-4.5" /><path d="M5 20h14" /></>,
  upload: <><path d="M12 15V4" /><path d="m7 8.5 5-4.5 5 4.5" /><path d="M5 20h14" /></>,
  filePlus: <><path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z" /><path d="M14 3v5h5" /><path d="M12 11.5v5" /><path d="M9.5 14h5" /></>,
  wave: <path d="M3 12h2.5L8 5l4 14 3-9 2 5 1.5-3H21" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.7" /><path d="M12 17.3h.01" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  moon: <path d="M20 14.2A8 8 0 1 1 9.8 4a6.4 6.4 0 0 0 10.2 10.2z" />,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  volume: <><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" /><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  mute: <><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" /><path d="m16 9.5 5 5" /><path d="m21 9.5-5 5" /></>,
  trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 12.5h10L18 7" /><path d="M9 7V4.5h6V7" /></>,
  pencil: <><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" /><path d="m14.5 6.5 3 3" /></>,
  select: <><rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3.2 3.2" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  sliders: <><path d="M4 7h9" /><path d="M17 7h3" /><circle cx="15" cy="7" r="2" /><path d="M4 17h3" /><path d="M11 17h9" /><circle cx="9" cy="17" r="2" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6A2 2 0 0 0 4 6v7.5a2 2 0 0 0 2 2h2.5" /></>,
  paste: <><rect x="5" y="5" width="14" height="16" rx="2" /><path d="M9 5V4h6v1" /><path d="M9 12h6M9 16h4" /></>,
  repeat: <><path d="m17 2 4 4-4 4" /><path d="M3 11V9.5A3.5 3.5 0 0 1 6.5 6H21" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1.5A3.5 3.5 0 0 1 17.5 18H3" /></>,
  left: <path d="m14.5 6-6 6 6 6" />,
  right: <path d="m9.5 6 6 6-6 6" />,
  up: <path d="m6 14.5 6-6 6 6" />,
  down: <path d="m6 9.5 6 6 6-6" />,
  note: <><path d="M9 18V6.5l11-2V16" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  slide: <><path d="M4 17c5 0 5-10 10-10h6" /><path d="m17 4 3 3-3 3" /></>,
  zoomIn: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.9-4.9" /><path d="M10.5 8v5M8 10.5h5" /></>,
  zoomOut: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.9-4.9" /><path d="M8 10.5h5" /></>,
  fit: <><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" /></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  more: <><circle cx="5.5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18.5" cy="12" r="1.2" fill="currentColor" /></>,
  drum: <><ellipse cx="12" cy="8" rx="8" ry="3" /><path d="M4 8v8c0 1.7 3.6 3 8 3s8-1.3 8-3V8" /><path d="m8 3 3 4M16 3l-3 4" /></>,
  sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16v4M17 18h4" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>
  );
}

/* ---------- logo ---------- */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <g fill="var(--accent-ink)">
        <rect x="6" y="15" width="3.4" height="8" rx="1.7" />
        <rect x="11.2" y="9" width="3.4" height="14" rx="1.7" />
        <rect x="16.4" y="12" width="3.4" height="11" rx="1.7" />
        <rect x="21.6" y="6" width="3.4" height="17" rx="1.7" />
      </g>
    </svg>
  );
}

/* ---------- popover: a button that opens a small panel ---------- */
export function Popover({ trigger, children, align = 'start', buttonClass = 'btn', title, label, up }: {
  trigger: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'start' | 'end' | 'center';
  buttonClass?: string;
  title?: string;
  label?: string;
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="popover" ref={ref}>
      <button type="button" className={buttonClass} aria-haspopup="true" aria-expanded={open} title={title} aria-label={label}
        onClick={() => setOpen(o => !o)}>{trigger}</button>
      {open && <div className={`popover-panel align-${align}${up ? ' up' : ''}`}>{typeof children === 'function' ? children(close) : children}</div>}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, hint, danger, disabled }: {
  icon?: IconName; children: ReactNode; onClick: () => void; hint?: string; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" role="menuitem" className={'menu-item' + (danger ? ' danger' : '')} onClick={onClick} disabled={disabled}>
      {icon ? <Icon name={icon} size={17} /> : <span className="icon-gap" />}
      <span className="menu-label">{children}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );
}

export const MenuSeparator = () => <div className="menu-sep" role="separator" />;

/* ---------- segmented control ---------- */
export function Segmented<T extends string | number>({ value, options, onChange, label, size }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; size?: 'sm';
}) {
  return (
    <div className={'segmented' + (size ? ' ' + size : '')} role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title}
          className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------- switch ---------- */
export function Switch({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      <span className="switch-label">{children}</span>
    </label>
  );
}

/* ---------- toasts ---------- */
export interface Toast { id: number; text: string }
export function Toasts({ items }: { items: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map(t => <div key={t.id} className="toast"><Icon name="check" size={16} />{t.text}</div>)}
    </div>
  );
}

/** The width of an element, kept up to date as it resizes. */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** A slider that shows how far along it is. */
export function Slider({ value, min, max, step = 1, onChange, label, onDoubleClick }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; onDoubleClick?: () => void;
}) {
  return (
    <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onDoubleClick={onDoubleClick}
      style={{ ['--p' as string]: `${((value - min) / (max - min)) * 100}%` }} onChange={e => onChange(+e.target.value)} />
  );
}
