/**
 * Renders the two-ID pair side-by-side. Cyan = Primary Key (opaque, FK).
 * Amber = Display Code (human alias). Used everywhere both IDs appear.
 */
export function PrimaryId({ id, className = '' }) {
  if (!id) return <span className="text-slate-500">—</span>;
  return <span className={`primary-id ${className}`}>{id}</span>;
}

export function DisplayCode({ code, className = '' }) {
  if (!code) return <span className="text-slate-500">—</span>;
  return <span className={`display-code ${className}`}>{code}</span>;
}

export function IdPair({ id, displayCode, stack = false }) {
  if (stack) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase text-slate-500 w-16">Primary</span>
          <PrimaryId id={id} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase text-slate-500 w-16">Display</span>
          <DisplayCode code={displayCode} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <PrimaryId id={id} />
      <DisplayCode code={displayCode} />
    </div>
  );
}
