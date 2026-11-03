"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, XCircle, Calendar, Tag, FileText, Users } from "lucide-react";

interface ReviewModalProps {
  initialDocType: string;
  initialExpiryDate: string;
  onConfirm: (confirmedData: {
    docType: string;
    expiryDate: string;
    nickname: string;
    familyMember?: string;
  }) => void;
  onDiscard: () => void;
}

const ALLOWED_DOC_TYPES = [
  "Driving Licence",
  "PUC Certificate",
  "Vehicle Insurance",
  "Passport",
  "Appliance Warranty",
];

const FAMILY_MEMBER_OPTIONS = [
  "Self",
  "Spouse",
  "Parents",
  "Vehicle/Asset",
  "Other",
];

export default function ReviewModal({
  initialDocType,
  initialExpiryDate,
  onConfirm,
  onDiscard,
}: ReviewModalProps) {
  const [docType, setDocType] = useState(
    ALLOWED_DOC_TYPES.includes(initialDocType) ? initialDocType : ALLOWED_DOC_TYPES[0]
  );
  const [expiryDate, setExpiryDate] = useState(initialExpiryDate);
  const [nickname, setNickname] = useState("");
  const [familyMember, setFamilyMember] = useState(FAMILY_MEMBER_OPTIONS[0]);
  const [error, setError] = useState("");

  const handleSave = () => {
    if (!nickname.trim()) {
      setError("Please provide a nickname (e.g., 'Mom\u2019s Passport' or 'Swift PUC').");
      return;
    }
    if (!expiryDate) {
      setError("Please select or confirm a valid expiry date.");
      return;
    }
    setError("");
    onConfirm({ docType, expiryDate, nickname, familyMember });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 space-y-5 animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex items-start justify-between border-b pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Verify Detected Details</h2>
              <p className="text-xs text-gray-500">Human-in-the-loop review before persisting data</p>
            </div>
          </div>
          <button onClick={onDiscard} className="text-gray-400 hover:text-gray-600">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* AI Notice Banner */}
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
          <span>AI outputs can have errors. Check this against your original document.</span>
        </div>

        {/* Form Inputs */}
        <div className="space-y-4">

          {/* Document Type */}
          <div>
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1.5 mb-1">
              <FileText className="w-3.5 h-3.5 text-gray-400" /> Document Type
            </label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
            >
              {ALLOWED_DOC_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          {/* Expiry Date */}
          <div>
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1.5 mb-1">
              <Calendar className="w-3.5 h-3.5 text-gray-400" /> Expiry Date
            </label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all font-mono"
            />
          </div>

          {/* Nickname */}
          <div>
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1.5 mb-1">
              <Tag className="w-3.5 h-3.5 text-gray-400" /> Nickname
            </label>
            <input
              type="text"
              placeholder="e.g., Personal Honda Activa PUC"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
            />
            <p className="text-[11px] text-gray-400 mt-1">Never enter ID card numbers or personal addresses.</p>
          </div>

          {/* Family Member */}
          <div>
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1.5 mb-1">
              <Users className="w-3.5 h-3.5 text-gray-400" /> Belongs To
            </label>
            <select
              value={familyMember}
              onChange={(e) => setFamilyMember(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
            >
              {FAMILY_MEMBER_OPTIONS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onDiscard}
            className="flex-1 py-2.5 border border-gray-300 text-gray-700 font-medium text-sm rounded-lg hover:bg-gray-50 transition-colors"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 bg-blue-600 text-white font-medium text-sm rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            Confirm &amp; Save
          </button>
        </div>

      </div>
    </div>
  );
}
