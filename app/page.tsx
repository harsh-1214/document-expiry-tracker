"use client";

import { useState, useEffect, useRef } from "react";
import { UploadCloud, ShieldCheck, CalendarPlus, Trash2, Download } from "lucide-react";
import { useGoogleLogin } from "@react-oauth/google";
import ReviewModal from "./components/ReviewModal";
import { getUrgencyInfo } from "./lib/urgency";
import { downloadICS } from "./lib/calendarSync";

/** Shape of each record persisted in localStorage under 'expiryDocs'. */
interface DocumentRecord {
  id: number;
  createdAt: string;
  nickname: string;
  docType: string;
  expiryDate: string;
}

const STORAGE_KEY = "expiryDocs";

/** Load and parse the document list from localStorage safely. */
function loadDocs(): DocumentRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as DocumentRecord[];
  } catch {
    return [];
  }
}

/** Persist the document list to localStorage. */
function saveDocs(docs: DocumentRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
}

/**
 * Sort documents by urgency: most urgent (lowest daysRemaining, including
 * negative for expired) first.
 */
function sortByUrgency(docs: DocumentRecord[]): DocumentRecord[] {
  return [...docs].sort((a, b) => {
    const aInfo = getUrgencyInfo(a.expiryDate);
    const bInfo = getUrgencyInfo(b.expiryDate);
    return aInfo.daysRemaining - bInfo.daysRemaining;
  });
}

export default function DocumentExpiryTracker() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [auditLog, setAuditLog] = useState<string>("");

  // Tracked document list (sourced from localStorage)
  const [docs, setDocs] = useState<DocumentRecord[]>([]);

  // Extraction results fed into the modal
  const [showReview, setShowReview] = useState(false);
  const [extractedDocType, setExtractedDocType] = useState("");
  const [extractedExpiryDate, setExtractedExpiryDate] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Google Calendar OAuth sync ────────────────────────────────────────────

  /**
   * ID of the document card that triggered the Calendar sync flow.
   * Used to show a per-card loading state while the OAuth + API call runs.
   * null  = no sync in progress.
   */
  const [calendarSyncing, setCalendarSyncing] = useState<number | null>(null);

  /**
   * useGoogleLogin returns a trigger function.  When called, it opens the
   * Google OAuth consent screen requesting the calendar.events write scope.
   * `doc` is captured via closure so each card's button carries its own doc.
   */

  // We keep buildCalendarLogin as a stable factory so ESLint / React are happy.
  // useGoogleLogin must be called at the top level of the component, so we
  // call it once and pass the target doc through a ref that we update before
  // triggering the flow.
  const pendingDocRef = useRef<DocumentRecord | null>(null);

  const calendarLogin = useGoogleLogin({
    scope: "https://www.googleapis.com/auth/calendar.events",
    onSuccess: async (tokenResponse) => {
      const doc = pendingDocRef.current;
      if (!doc) return;

      try {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docType: doc.docType,
            nickname: doc.nickname,
            expiryDate: doc.expiryDate,
            // accessToken is ephemeral — never written to localStorage.
            accessToken: tokenResponse.access_token,
          }),
        });

        const result = await res.json() as { success: boolean; error?: string };

        if (result.success) {
          setAuditLog(
            `✓ Synced "${doc.nickname}" to Google Calendar with 30-day and 7-day reminders.`
          );
        } else {
          setAuditLog(`Calendar sync error: ${result.error ?? "Unknown error"}`);
        }
      } catch (err: unknown) {
        console.error("[calendarSync] Fetch error:", err);
        setAuditLog(
          err instanceof Error
            ? `Calendar sync failed: ${err.message}`
            : "Calendar sync failed."
        );
      } finally {
        setCalendarSyncing(null);
        pendingDocRef.current = null;
      }
    },
    onError: (err) => {
      console.error("[calendarSync] OAuth error:", err);
      setAuditLog("Google sign-in was cancelled or failed.");
      setCalendarSyncing(null);
      pendingDocRef.current = null;
    },
  });

  /** Stores the target doc then triggers the OAuth flow. */
  function buildCalendarLogin(doc: DocumentRecord) {
    return () => {
      pendingDocRef.current = doc;
      setCalendarSyncing(doc.id);
      calendarLogin();
    };
  }

  // Load persisted docs on first mount (client-only — localStorage unavailable during SSR)
  useEffect(() => {
    setDocs(sortByUrgency(loadDocs()));
  }, []);

  const resetExtractionState = () => {
    setShowReview(false);
    setExtractedDocType("");
    setExtractedExpiryDate("");
  };

  // ── File upload & Gemini extraction ──────────────────────────────────────

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setAuditLog("Analyzing document securely...");

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        // Capture base64 immediately
        const base64data = reader.result;

        // ZERO-RETENTION: clear the file input before any network call
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }

        try {
          const res = await fetch("/api/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageBase64: base64data, mimeType: file.type }),
          });

          // Surface the real server error even when the body isn't JSON
          let result: {
            success: boolean;
            data?: { docType: string; expiryDate: string };
            error?: string;
          };
          try {
            result = await res.json();
          } catch {
            result = {
              success: false,
              error: `Server returned ${res.status} ${res.statusText} (non-JSON body)`,
            };
          }

          if (!res.ok || !result.success) {
            setAuditLog(`Error: ${result.error ?? `HTTP ${res.status}`}`);
          } else {
            // base64data is a closure-local variable and is never written to
            // localStorage, sessionStorage, or any global scope (zero-retention).
            setAuditLog("Image memory purged (0 Bytes Retained). No ID numbers stored.");
            setExtractedDocType(result.data?.docType ?? "");
            setExtractedExpiryDate(result.data?.expiryDate ?? "");
            setShowReview(true);
          }
        } catch (fetchErr) {
          console.error(fetchErr);
          setAuditLog(
            fetchErr instanceof Error
              ? `Network error: ${fetchErr.message}`
              : "Failed to reach extraction API."
          );
        } finally {
          setIsProcessing(false);
        }
      };

      // Go straight to FileReader — no blob URL created, nothing to revoke.
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
      setAuditLog("Failed to process image.");
    }
  };

  // ── Modal callbacks ───────────────────────────────────────────────────────

  /**
   * Persists ONLY the 5 allowed metadata fields to localStorage (rules.md §2).
   * Never writes image data, ID numbers, or addresses.
   */
  const handleConfirm = (confirmed: {
    docType: string;
    expiryDate: string;
    nickname: string;
  }) => {
    const newDoc: DocumentRecord = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      nickname: confirmed.nickname,
      docType: confirmed.docType,
      expiryDate: confirmed.expiryDate,
    };

    const existing = loadDocs();
    const updated = sortByUrgency([...existing, newDoc]);
    saveDocs(updated);
    setDocs(updated);

    resetExtractionState();
    setAuditLog("Saved securely to your browser storage. No image or ID data retained.");
  };

  /** Closes the modal without writing anything to storage. */
  const handleDiscard = () => {
    resetExtractionState();
    setAuditLog("Discarded. No data was saved.");
  };

  // ── Document list actions ─────────────────────────────────────────────────

  const handleDelete = (id: number) => {
    const updated = sortByUrgency(loadDocs().filter((d) => d.id !== id));
    saveDocs(updated);
    setDocs(updated);
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8 text-gray-900">
      <div className="max-w-2xl mx-auto space-y-8">

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Document Expiry Tracker</h1>
          <p className="text-gray-500 flex items-center justify-center gap-2">
            <ShieldCheck className="w-4 h-4 text-green-600" />
            100% Private. Images are never stored.
          </p>
        </header>

        {/* ── UPLOAD ZONE — hidden while the review modal is open ─────────── */}
        {!showReview && (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center bg-white cursor-pointer hover:border-blue-500 transition-colors shadow-sm"
          >
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            {isProcessing ? (
              <div className="animate-pulse space-y-4">
                <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-blue-600 font-medium">Extracting expiry date...</p>
              </div>
            ) : (
              <div className="space-y-4">
                <UploadCloud className="w-12 h-12 text-gray-400 mx-auto" />
                <p className="text-lg font-medium">Click to upload a document photo</p>
                <p className="text-sm text-gray-500">
                  Supports Driving Licence, PUC, Insurance, Passport, Warranty
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── LIVE PRIVACY AUDIT LOG ──────────────────────────────────────── */}
        {auditLog && (
          <div className="bg-gray-900 text-green-400 font-mono text-sm p-4 rounded-lg shadow-inner">
            {auditLog}
          </div>
        )}

        {/* ── HUMAN-IN-THE-LOOP REVIEW MODAL ─────────────────────────────── */}
        {showReview && (
          <ReviewModal
            initialDocType={extractedDocType}
            initialExpiryDate={extractedExpiryDate}
            onConfirm={handleConfirm}
            onDiscard={handleDiscard}
          />
        )}

        {/* ── TRACKED DOCUMENTS DASHBOARD ─────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Tracked Documents
          </h2>

          {docs.length === 0 ? (
            /* ── Empty state ── */
            <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-10 text-center space-y-2">
              <p className="text-gray-500 font-medium">No documents tracked yet.</p>
              <p className="text-sm text-gray-400">
                Upload a document above to get started.
              </p>
            </div>
          ) : (
            /* ── Document cards, sorted most-urgent first ── */
            <ul className="space-y-3">
              {docs.map((doc) => {
                const urgency = getUrgencyInfo(doc.expiryDate);

                return (
                  <li
                    key={doc.id}
                    className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3"
                  >
                    {/* Top row: nickname + urgency badge */}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-gray-900 truncate">
                          {doc.nickname}
                        </span>
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${urgency.badgeClass}`}
                        >
                          {urgency.label}
                        </span>
                      </div>

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(doc.id)}
                        aria-label={`Delete ${doc.nickname}`}
                        className="text-gray-400 hover:text-red-500 transition-colors shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Meta row: doc type + expiry date */}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span className="bg-gray-100 px-2 py-0.5 rounded font-medium">
                        {doc.docType}
                      </span>
                      <span>
                        Expires{" "}
                        <span className="font-mono text-gray-700">{doc.expiryDate}</span>
                      </span>
                    </div>

                    {/* Calendar sync row */}
                    <div className="flex gap-2 pt-1">
                      {/* ── Authenticated Google Calendar sync ── */}
                      <button
                        onClick={buildCalendarLogin(doc)}
                        disabled={calendarSyncing === doc.id}
                        className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {calendarSyncing === doc.id ? (
                          <>
                            <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                            Syncing…
                          </>
                        ) : (
                          <>
                            <CalendarPlus className="w-3.5 h-3.5" />
                            Sync to Google Calendar
                          </>
                        )}
                      </button>

                      {/* ── .ics fallback download ── */}
                      <button
                        onClick={() =>
                          downloadICS({
                            nickname: doc.nickname,
                            docType: doc.docType,
                            expiryDate: doc.expiryDate,
                          })
                        }
                        className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download .ics
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

      </div>
    </main>
  );
}
