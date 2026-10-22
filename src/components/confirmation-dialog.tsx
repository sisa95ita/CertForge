"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function ConfirmationDialog({ title, children, cancelLabel, confirmLabel, busy, onCancel, onConfirm }: {
  title: string; children: ReactNode; cancelLabel: string; confirmLabel: string;
  busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={id} aria-describedby={id + "-description"}
    className="card m-auto w-full max-w-lg p-6 backdrop:bg-slate-900/40"
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id={id} className="text-xl font-extrabold">{title}</h2>
    <div id={id + "-description"} className="muted mt-3 leading-6">{children}</div>
    <div className="mt-6 flex justify-end gap-3">
      <button type="button" className="btn" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </dialog>;
}
