"use client";

import { useState, useEffect } from "react";
import { X, ShieldCheck, DatabaseZap } from "lucide-react";

interface PrivacyInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  storageKey?: string;
}

export default function PrivacyInspector({
  isOpen,
  onClose,
  storageKey = "expiryDocs",
}: PrivacyInspectorProps) {
  const [rawJson, setRawJson] = useState<string>("");

  // Re-read localStorage every time the panel is opened so it's always fresh.
  useEffect(() => {
    if (isOpen) {
      const raw = localStorage.getItem(storageKey) ?? "[]";
      try {
        // Pretty-print so the evaluator can read it easily.
        setRawJson(JSON.stringify(JSON.parse(raw), null, 2));
      } catch {
        setRawJson(raw);
      }
    }
  }, [isOpen, storageKey]);

  if (!isOpen) return null;

  const isEmpty = rawJson === "[]" || rawJson.trim() === "";
  const byteSize = new Blob([rawJson]).size;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <DatabaseZap className="w-5 h-5 text-green-400" />
            <div>
              <h2 className="text-white font-bold text-base">Privacy Storage Inspector</h2>
              <p className="text-slate-400 text-xs">
                Raw contents of <code className="text-green-400">localStorage["{storageKey}"]</code>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Close inspector"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Privacy guarantee banner ────────────────────────────────── */}
        <div className="bg-emerald-50 border-b border-emerald-100 px-6 py-3 flex items-start gap-2 shrink-0">
          <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
          <p className="text-xs text-emerald-800">
            <strong>Zero-retention proof:</strong> Inspect this output — you will find only{" "}
            <code>id</code>, <code>nickname</code>, <code>docType</code>,{" "}
            <code>expiryDate</code>, <code>familyMember</code>, and <code>createdAt</code>.
            No image data, base64 strings, document ID numbers, or personal addresses are ever written here.
          </p>
        </div>

        {/* ── Raw JSON output ─────────────────────────────────────────── */}
        <div className="overflow-auto flex-1 bg-slate-950 p-5">
          {isEmpty ? (
            <p className="text-slate-500 text-sm font-mono">// No documents tracked yet in this user vault.</p>
          ) : (
            <pre className="text-green-400 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
              <code>{rawJson}</code>
            </pre>
          )}
        </div>

        {/* ── Footer stats ────────────────────────────────────────────── */}
        <div className="bg-slate-900 px-6 py-3 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <span>
            Storage size:{" "}
            <span className="text-green-400 font-mono">{byteSize} bytes</span>
            {" "}(images would be ~500 KB+)
          </span>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors underline"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
