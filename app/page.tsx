"use client";

import { useState, useEffect, useRef } from "react";
import {
  UploadCloud,
  ShieldCheck,
  CalendarPlus,
  Trash2,
  Download,
  Info,
  CheckCircle2,
  Zap,
  Search,
} from "lucide-react";
import { useGoogleLogin } from "@react-oauth/google";
import ReviewModal from "./components/ReviewModal";
import RenewalGuide from "./components/RenewalGuide";
import PrivacyInspector from "./components/PrivacyInspector";
import { getUrgencyInfo } from "./lib/urgency";
import { downloadICS } from "./lib/calendarSync";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Shape of each record persisted in localStorage under 'expiryDocs'.
 * Rules.md §2 Storage Scope — only these fields are ever written.
 */
interface DocumentRecord {
  id: number;
  createdAt: string;
  nickname: string;
  docType: string;
  expiryDate: string;
  /** True once this document has been successfully synced to Google Calendar. */
  isSynced?: boolean;
  /** Optional family member tag (rules.md §2 `familyMember` field). */
  familyMember?: string;
}

const STORAGE_KEY = "expiryDocs";
const MAX_CANVAS_WIDTH = 1024; // px — cap before base64 encode to save API quota

// ── Storage helpers ───────────────────────────────────────────────────────────

function loadDocs(): DocumentRecord[] {
  try {
    return JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]",
    ) as DocumentRecord[];
  } catch {
    return [];
  }
}

function saveDocs(docs: DocumentRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
}

function sortByUrgency(docs: DocumentRecord[]): DocumentRecord[] {
  return [...docs].sort((a, b) => {
    return (
      getUrgencyInfo(a.expiryDate).daysRemaining -
      getUrgencyInfo(b.expiryDate).daysRemaining
    );
  });
}

// ── Image compression ─────────────────────────────────────────────────────────

/**
 * Resizes an image file via an off-screen <canvas> if its width exceeds
 * MAX_CANVAS_WIDTH, then exports it as a JPEG at 0.75 quality.
 * This drastically reduces the base64 payload sent to /api/extract,
 * saving Gemini API quota and speeding up the request.
 *
 * Zero-retention: the canvas and its blob are created and used only inside
 * this function; nothing is written to any persistent storage.
 */
function compressImageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const canvas = document.createElement("canvas");
      let { width, height } = img;
      const MAX_CANVAS_WIDTH = 1024;

      if (width > MAX_CANVAS_WIDTH) {
        height = Math.round((height * MAX_CANVAS_WIDTH) / width);
        width = MAX_CANVAS_WIDTH;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Could not get canvas 2D context."));

      // Just draw the image directly. No messy background manipulations.
      ctx.drawImage(img, 0, 0, width, height);

      resolve(canvas.toDataURL("image/jpeg", 0.75));
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image for compression."));
    };

    img.src = objectUrl;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DocumentExpiryTracker() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [auditLog, setAuditLog] = useState<string>("");

  const [docs, setDocs] = useState<DocumentRecord[]>([]);

  const [showReview, setShowReview] = useState(false);
  const [extractedDocType, setExtractedDocType] = useState("");
  const [extractedExpiryDate, setExtractedExpiryDate] = useState("");

  const [calendarSyncing, setCalendarSyncing] = useState<number | null>(null);
  const [activeGuideDocType, setActiveGuideDocType] = useState<string | null>(
    null,
  );
  const [showPrivacyInspector, setShowPrivacyInspector] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingDocRef = useRef<DocumentRecord | null>(null);

  // ── Google Calendar OAuth ───────────────────────────────────────────────────

  /**
   * Sends a calendar event to /api/calendar using the ephemeral access_token.
   * Rule 6 §Ephemeral Auth: token lives only in this async function scope.
   */
  const postCalendarEvent = async (
    doc: DocumentRecord,
    accessToken: string,
    testMode = false,
  ) => {
    // Rule 6 §Payload Minimization — only nickname, docType, expiryDate sent.
    const res = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        docType: doc.docType,
        nickname: doc.nickname,
        expiryDate: doc.expiryDate,
        accessToken, // ephemeral — never stored
        testMode,
      }),
    });

    return res.json() as Promise<{ success: boolean; error?: string }>;
  };

  const calendarLogin = useGoogleLogin({
    // Rule 6 §Scope: minimum required permission only.
    scope: "https://www.googleapis.com/auth/calendar.events",

    onSuccess: async (tokenResponse) => {
      const doc = pendingDocRef.current;
      if (!doc) return;

      const ephemeralToken = tokenResponse.access_token;
      // Determine whether this was triggered as a test
      const isTest =
        (
          pendingDocRef as React.MutableRefObject<
            (DocumentRecord & { _testMode?: boolean }) | null
          >
        ).current?._testMode ?? false;

      try {
        const result = await postCalendarEvent(doc, ephemeralToken, isTest);

        if (result.success) {
          if (isTest) {
            setAuditLog(
              `✓ Test alert scheduled for 5 min from now — API connection verified!`,
            );
          } else {
            // Mark isSynced and persist so a reload preserves the state.
            setDocs((prev) => {
              const updated = prev.map((d) =>
                d.id === doc.id ? { ...d, isSynced: true } : d,
              );
              saveDocs(updated);
              return updated;
            });
            setAuditLog(
              `✓ Synced "${doc.nickname}" to Google Calendar with 30-day and 7-day reminders.`,
            );
          }
        } else {
          setAuditLog(
            `Calendar sync error: ${result.error ?? "Unknown error"}`,
          );
        }
      } catch (err: unknown) {
        console.error("[calendarSync] Fetch error:", err);
        setAuditLog(
          err instanceof Error
            ? `Calendar sync failed: ${err.message}`
            : "Calendar sync failed.",
        );
      } finally {
        setCalendarSyncing(null);
        pendingDocRef.current = null;
      }
    },

    // ── Handles OAuth-level errors (invalid client, scope denied, etc.) ──────
    onError: (err) => {
      console.error("[calendarSync] OAuth error:", err);
      setCalendarSyncing(null);
      pendingDocRef.current = null;
      setAuditLog("Calendar sync cancelled or failed.");
    },

    // ── Handles popup close / network failure BEFORE OAuth completes ─────────
    // Without this, closing the popup leaves calendarSyncing set forever.
    onNonOAuthError: (err) => {
      console.warn("[calendarSync] Non-OAuth error (popup closed?):", err);
      setCalendarSyncing(null);
      pendingDocRef.current = null;
      setAuditLog("Calendar sync cancelled or failed.");
    },
  });

  /**
   * Stores the target doc (with optional testMode flag) then triggers OAuth.
   * Rule 6 §Client-Side Trigger: must only be called from an onClick handler.
   */
  function triggerCalendarSync(doc: DocumentRecord, testMode = false) {
    // We piggyback a _testMode flag on the ref object so onSuccess can read it.
    (
      pendingDocRef as React.MutableRefObject<
        (DocumentRecord & { _testMode?: boolean }) | null
      >
    ).current = {
      ...doc,
      _testMode: testMode,
    };
    setCalendarSyncing(doc.id);
    calendarLogin();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  useEffect(() => {
    setDocs(sortByUrgency(loadDocs()));
  }, []);

  const resetExtractionState = () => {
    setShowReview(false);
    setExtractedDocType("");
    setExtractedExpiryDate("");
  };

  // ── File upload & Gemini extraction ────────────────────────────────────────

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Strict file type guard: Only accept images, explicitly block PDFs and docs
    if (!file.type.startsWith("image/")) {
      setAuditLog(
        "Error: Only image files (JPG/PNG) are supported for this demo. PDFs are not supported.",
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsProcessing(true);
    setAuditLog("Compressing and analyzing document securely...");

    // ZERO-RETENTION: clear the input immediately
    if (fileInputRef.current) fileInputRef.current.value = "";

    try {
      const compressedBase64 = await compressImageToBase64(file);

      try {
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Sending the full data URL since your backend handles the split
          body: JSON.stringify({
            imageBase64: compressedBase64,
            mimeType: "image/jpeg",
          }),
        });

        let result = await res.json().catch(() => ({
          success: false,
          error: `Server returned ${res.status} (non-JSON body)`,
        }));

        if (!res.ok || !result.success) {
          setAuditLog(`Error: ${result.error ?? `HTTP ${res.status}`}`);
        } else {
          setAuditLog(
            "Image compressed, transmitted, and purged (0 Bytes Retained).",
          );
          setExtractedDocType(result.data?.docType ?? "");
          setExtractedExpiryDate(result.data?.expiryDate ?? "");
          setShowReview(true);
        }
      } catch (fetchErr) {
        setAuditLog(
          fetchErr instanceof Error
            ? `Network error: ${fetchErr.message}`
            : "Failed to reach API.",
        );
      } finally {
        setIsProcessing(false);
      }
    } catch (compressionErr) {
      setIsProcessing(false);
      setAuditLog(
        compressionErr instanceof Error
          ? `Compression failed: ${compressionErr.message}`
          : "Failed to process image.",
      );
    }
  };

  // ── Modal callbacks ─────────────────────────────────────────────────────────

  const handleConfirm = (confirmed: {
    docType: string;
    expiryDate: string;
    nickname: string;
    familyMember?: string;
  }) => {
    const newDoc: DocumentRecord = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      nickname: confirmed.nickname,
      docType: confirmed.docType,
      expiryDate: confirmed.expiryDate,
      familyMember: confirmed.familyMember,
    };

    const existing = loadDocs();
    const updated = sortByUrgency([...existing, newDoc]);
    saveDocs(updated);
    setDocs(updated);

    resetExtractionState();
    setAuditLog(
      "Saved securely to your browser storage. No image or ID data retained.",
    );
  };

  const handleDiscard = () => {
    resetExtractionState();
    setAuditLog("Discarded. No data was saved.");
  };

  // ── Document list actions ───────────────────────────────────────────────────

  const handleDelete = (id: number) => {
    const updated = sortByUrgency(loadDocs().filter((d) => d.id !== id));
    saveDocs(updated);
    setDocs(updated);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <main className="min-h-screen bg-gray-50 p-8 text-gray-900">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* ── HEADER ─────────────────────────────────────────────────── */}
          <header className="text-center space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              Document Expiry Tracker
            </h1>
            <p className="text-gray-500 flex items-center justify-center gap-2">
              <ShieldCheck className="w-4 h-4 text-green-600" />
              100% Private. Images are never stored.
            </p>
          </header>

          {/* ── UPLOAD ZONE ────────────────────────────────────────────── */}
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
                  <p className="text-blue-600 font-medium">
                    Compressing & extracting expiry date...
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <UploadCloud className="w-12 h-12 text-gray-400 mx-auto" />
                  <p className="text-lg font-medium">
                    Click to upload a document photo
                  </p>
                  <p className="text-sm text-gray-500">
                    Supports Driving Licence, PUC, Insurance, Passport, Warranty
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── AUDIT LOG ──────────────────────────────────────────────── */}
          {auditLog && (
            <div className="bg-gray-900 text-green-400 font-mono text-sm p-4 rounded-lg shadow-inner">
              {auditLog}
            </div>
          )}

          {/* ── REVIEW MODAL (inline) ───────────────────────────────────── */}
          {showReview && (
            <ReviewModal
              initialDocType={extractedDocType}
              initialExpiryDate={extractedExpiryDate}
              onConfirm={handleConfirm}
              onDiscard={handleDiscard}
            />
          )}

          {/* ── TRACKED DOCUMENTS DASHBOARD ────────────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
              Tracked Documents
            </h2>

            {docs.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-gray-200 rounded-xl p-10 text-center space-y-2">
                <p className="text-gray-500 font-medium">
                  No documents tracked yet.
                </p>
                <p className="text-sm text-gray-400">
                  Upload a document above to get started.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {docs.map((doc) => {
                  const urgency = getUrgencyInfo(doc.expiryDate);
                  const isExpired = urgency.tier === "EXPIRED";

                  return (
                    <li
                      key={doc.id}
                      className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3"
                    >
                      {/* ── Top row: nickname + urgency badge + delete ── */}
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <span className="font-semibold text-gray-900 truncate">
                            {doc.nickname}
                          </span>
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${urgency.badgeClass}`}
                          >
                            {urgency.label}
                          </span>
                          {/* Family member chip */}
                          {doc.familyMember && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
                              {doc.familyMember}
                            </span>
                          )}
                        </div>

                        <button
                          onClick={() => handleDelete(doc.id)}
                          aria-label={`Delete ${doc.nickname}`}
                          className="text-gray-400 hover:text-red-500 transition-colors shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* ── Meta row: doc type + expiry date ── */}
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="bg-gray-100 px-2 py-0.5 rounded font-medium">
                          {doc.docType}
                        </span>
                        <span>
                          Expires{" "}
                          <span className="font-mono text-gray-700">
                            {doc.expiryDate}
                          </span>
                        </span>
                      </div>

                      {/* ── Action row ── */}
                      <div className="flex gap-2 pt-1 flex-wrap">
                        {/* ── Calendar sync / expired state ── */}
                        {isExpired ? (
                          // Expired docs: hide calendar sync; make "How to Renew" primary
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 cursor-default">
                            Expired — Renewal Required
                          </span>
                        ) : doc.isSynced ? (
                          // Already synced: show static confirmation badge
                          <button
                            disabled
                            className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 cursor-not-allowed"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Synced to Calendar
                          </button>
                        ) : (
                          // Normal sync + test alert buttons
                          <>
                            <button
                              onClick={() => triggerCalendarSync(doc)}
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

                            {/* Test Alert — schedules event 5 min from now */}
                            <button
                              onClick={() => triggerCalendarSync(doc, true)}
                              disabled={calendarSyncing === doc.id}
                              title="Schedules a test event 5 minutes from now to verify API connectivity"
                              className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-800 hover:bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              <Zap className="w-3.5 h-3.5" />
                              Test Alert
                            </button>
                          </>
                        )}

                        {/* ── .ics fallback ── */}
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

                        {/* ── How to Renew — primary when expired ── */}
                        <button
                          onClick={() => setActiveGuideDocType(doc.docType)}
                          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                            isExpired
                              ? "text-white bg-violet-600 hover:bg-violet-700 border-violet-700"
                              : "text-violet-600 hover:text-violet-800 hover:bg-violet-50 border-violet-200"
                          }`}
                        >
                          <Info className="w-3.5 h-3.5" />
                          How to Renew
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── FOOTER ─────────────────────────────────────────────────── */}
          <footer className="pt-4 pb-2 border-t border-gray-200 flex items-center justify-center">
            <button
              onClick={() => setShowPrivacyInspector(true)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              Developer: Inspect localStorage
            </button>
          </footer>
        </div>
      </main>

      {/* ── RENEWAL GUIDE MODAL ──────────────────────────────────────────── */}
      <RenewalGuide
        docType={activeGuideDocType}
        isOpen={!!activeGuideDocType}
        onClose={() => setActiveGuideDocType(null)}
      />

      {/* ── PRIVACY STORAGE INSPECTOR MODAL ─────────────────────────────── */}
      <PrivacyInspector
        isOpen={showPrivacyInspector}
        onClose={() => setShowPrivacyInspector(false)}
      />
    </>
  );
}
