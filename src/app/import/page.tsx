import { ImportPanel } from "./import-panel";

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-black tracking-tight">Import Question Banks</h1>
      <p className="muted mt-2">Add one or more versioned JSON files. Each valid file is imported atomically.</p>
      <ImportPanel />
    </div>
  );
}
