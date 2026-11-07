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
  Lock,
} from "lucide-react";
import { useGoogleLogin } from "@react-oauth/google";
import { useUser, SignInButton } from "@clerk/nextjs";
import ReviewModal from "./components/ReviewModal";
import RenewalGuide from "./components/RenewalGuide";
import PrivacyInspector from "./components/PrivacyInspector";
import { getUrgencyInfo } from "./lib/urgency";
import { downloadICS } from "./lib/calendarSync";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Shape of each record persisted in localStorage under user-scoped keys.
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

// ── Storage helpers ───────────────────────────────────────────────────────────

function loadDocs(key: string): DocumentRecord[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Validation filter: ensure corrupted records are safely discarded
    return parsed.filter(
      (item): item is DocumentRecord =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof item.id === "number" &&
            typeof item.nickname === "string" &&
            typeof item.docType === "string" &&
            typeof item.expiryDate === "string"
        )
    );
  } catch {
    return [];
  }
}

function saveDocs(key: string, docs: DocumentRecord[]): void {
  localStorage.setItem(key, JSON.stringify(docs));
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
      const MAX_CANVAS_WIDTH = 1024; // px — cap before base64 encode to save API quota

      if (width > MAX_CANVAS_WIDTH) {
        height = Math.round((height * MAX_CANVAS_WIDTH) / width);
        width = MAX_CANVAS_WIDTH;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Could not get canvas 2D context."));

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
  const { user, isLoaded, isSignedIn } = useUser();
  const storageKey = user ? `expiryDocs_${user.id}` : null;

  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [auditLog, setAuditLog] = useState<string>("");

  const [docs, setDocs] = useState<DocumentRecord[]>([]);

  const [showReview, setShowReview] = useState(false);
  const [extractedDocType, setExtractedDocType] = useState("");
  const [extractedExpiryDate, setExtractedExpiryDate] = useState("");

  const [calendarSyncing, setCalendarSyncing] = useState<number | null>(null);
  const [activeGuideDocType, setActiveGuideDocType] = useState<string | null>(null);
  const [showPrivacyInspector, setShowPrivacyInspector] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingDocRef = useRef<DocumentRecord | null>(null);

  // ── Scoped Storage Lifecycle ───────────────────────────────────────────────

  useEffect(() => {
    if (storageKey) {
      setDocs(sortByUrgency(loadDocs(storageKey)));
    } else {
      setDocs([]);
    }
  }, [storageKey]);

  // ── Google Calendar OAuth ───────────────────────────────────────────────────

  const postCalendarEvent = async (
    doc: DocumentRecord,
    accessToken: string,
    testMode = false
  ) => {
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
    scope: "https://www.googleapis.com/auth/calendar.events",

    onSuccess: async (tokenResponse) => {
      const doc = pendingDocRef.current;
      if (!doc) return;

      const ephemeralToken = tokenResponse.access_token;
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
              `✓ Test alert scheduled for 5 min from now — API connection verified!`
            );
          } else {
            setDocs((prev) => {
              const updated = prev.map((d) =>
                d.id === doc.id ? { ...d, isSynced: true } : d
              );
              if (storageKey) {
                saveDocs(storageKey, updated);
              }
              return updated;
            });
            setAuditLog(
              `✓ Synced "${doc.nickname}" to Google Calendar with 30-day and 7-day reminders.`
            );
          }
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
      setCalendarSyncing(null);
      pendingDocRef.current = null;
      setAuditLog("Calendar sync cancelled or failed.");
    },

    onNonOAuthError: (err) => {
      console.warn("[calendarSync] Non-OAuth error (popup closed?):", err);
      setCalendarSyncing(null);
      pendingDocRef.current = null;
      setAuditLog("Calendar sync cancelled or failed.");
    },
  });

  function triggerCalendarSync(doc: DocumentRecord, testMode = false) {
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

  const resetExtractionState = () => {
    setShowReview(false);
    setExtractedDocType("");
    setExtractedExpiryDate("");
  };

  // ── File upload & Gemini extraction ────────────────────────────────────────

  const processFile = async (file: File) => {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setAuditLog(
        "Error: Only image files (JPG/PNG) are supported. Other file types are blocked."
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsProcessing(true);
    setAuditLog("Compressing and analyzing document securely...");

    if (fileInputRef.current) fileInputRef.current.value = "";

    try {
      const compressedBase64 = await compressImageToBase64(file);

      try {
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
            "Image compressed, transmitted, and purged (0 Bytes Retained). No ID numbers stored."
          );
          setExtractedDocType(result.data?.docType ?? "");
          setExtractedExpiryDate(result.data?.expiryDate ?? "");
          setShowReview(true);
        }
      } catch (fetchErr) {
        setAuditLog(
          fetchErr instanceof Error
            ? `Network error: ${fetchErr.message}`
            : "Failed to reach extraction API."
        );
      } finally {
        setIsProcessing(false);
      }
    } catch (compressionErr) {
      setIsProcessing(false);
      setAuditLog(
        compressionErr instanceof Error
          ? `Compression failed: ${compressionErr.message}`
          : "Failed to process image."
      );
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  // ── Modal callbacks ─────────────────────────────────────────────────────────

  const handleConfirm = (confirmed: {
    docType: string;
    expiryDate: string;
    nickname: string;
    familyMember?: string;
  }) => {
    if (!storageKey) {
      setAuditLog("Error: You must be signed in to save documents.");
      return;
    }

    const newDoc: DocumentRecord = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      nickname: confirmed.nickname,
      docType: confirmed.docType,
      expiryDate: confirmed.expiryDate,
      familyMember: confirmed.familyMember,
    };

    const existing = loadDocs(storageKey);
    const updated = sortByUrgency([...existing, newDoc]);
    saveDocs(storageKey, updated);
    setDocs(updated);

    resetExtractionState();
    setAuditLog(
      "Saved securely to your browser storage. No image or ID data retained."
    );
  };

  const handleDiscard = () => {
    resetExtractionState();
    setAuditLog("Discarded. No data was saved.");
  };

  // ── Document list actions ───────────────────────────────────────────────────

  const handleDelete = (id: number) => {
    if (!storageKey) return;
    const updated = sortByUrgency(loadDocs(storageKey).filter((d) => d.id !== id));
    saveDocs(storageKey, updated);
    setDocs(updated);
  };

  // ── Guard Views ────────────────────────────────────────────────────────────

  // 1. Loading View
  if (!isLoaded) {
    return (
      <main className="min-h-[70vh] bg-gray-50 flex flex-col items-center justify-center p-8">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-semibold text-gray-600">
          Loading your private vault...
        </p>
      </main>
    );
  }

  // 2. Logged-out Hero Landing View
  if (!isSignedIn) {
    return (
      <main className="min-h-[85vh] bg-gray-50 p-6 sm:p-12 text-gray-900 flex items-center justify-center">
        <div className="max-w-xl mx-auto text-center bg-white border border-gray-200 rounded-3xl p-8 sm:p-12 shadow-sm space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-inner">
            <Lock className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Private Document Expiry Vault
            </h1>
            <p className="text-gray-500 text-sm leading-relaxed max-w-md mx-auto">
              Track renewal dates for Driving Licences, PUCs, Vehicle Insurance,
              Passports, and Appliance Warranties. Your documents are stored
              strictly in your user-scoped browser vault with zero database retention.
            </p>
          </div>

          <div className="pt-2">
            <SignInButton mode="modal">
              <button className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 py-3.5 text-sm font-semibold text-white shadow-md hover:bg-blue-700 transition-all hover:shadow-lg">
                Sign in to Access Your Vault
              </button>
            </SignInButton>
          </div>

          <div className="pt-6 border-t border-gray-100 grid grid-cols-3 gap-3 text-xs text-gray-500">
            <div className="flex flex-col items-center gap-1">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>100% Client-Side</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Zero Database</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Zero Image Storage</span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // 3. Authenticated Dashboard View
  return (
    <>
      <main className="min-h-screen bg-gray-50 p-6 sm:p-8 text-gray-900">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* ── HEADER ─────────────────────────────────────────────────── */}
          <header className="text-center space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              Document Expiry Tracker
            </h1>
            <p className="text-gray-500 flex items-center justify-center gap-2 text-sm">
              <ShieldCheck className="w-4 h-4 text-green-600" />
              User-Scoped Vault ({user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? "Active User"})
            </p>
          </header>

          {/* ── UPLOAD ZONE ────────────────────────────────────────────── */}
          {!showReview && (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-colors shadow-sm ${
                isDragging
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-300 bg-white hover:border-blue-500"
              }`}
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
                <div className="space-y-4 flex flex-col items-center">
                  <UploadCloud
                    className={`w-12 h-12 transition-colors ${
                      isDragging ? "text-blue-600" : "text-gray-400"
                    }`}
                  />
                  <div>
                    <p className="text-lg font-medium text-gray-900">
                      Drag & drop your document image here or click to browse
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      Supports Driving Licence, PUC, Insurance, Passport, Warranty
                    </p>
                  </div>
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
                  No documents tracked yet in this vault.
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
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
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
                        <span className="bg-gray-100 px-2 py-0.5 rounded font-medium text-gray-700">
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
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 cursor-default">
                            Expired — Renewal Required
                          </span>
                        ) : doc.isSynced ? (
                          <button
                            disabled
                            className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 cursor-not-allowed"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Synced to Calendar
                          </button>
                        ) : (
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

                        {/* ── How to Renew ── */}
                        <button
                          onClick={() => setActiveGuideDocType(doc.docType)}
                          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                            isExpired
                              ? "text-white bg-violet-600 hover:bg-violet-700 border-violet-700 shadow-sm"
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
        storageKey={storageKey ?? "expiryDocs"}
        onClose={() => setShowPrivacyInspector(false)}
      />
    </>
  );
}
