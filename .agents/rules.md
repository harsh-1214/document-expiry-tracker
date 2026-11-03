# Document Expiry Tracker — Project Architecture & Rules

## 1. Stack & Framework Constraints
- **Framework:** Next.js 14 App Router (`app/` directory).
- **Language & Styling:** TypeScript (strict mode) + Tailwind CSS + Lucide React.
- **Client Components:** Mark components using React hooks (`useState`, `useEffect`, `useRef`) or browser APIs with `"use client";` at line 1.
- **Node.js Environment:** Node 20 LTS.

## 2. Non-Negotiable Privacy Mandates (Zero-Retention)
- **NO Image Persistence:** Never save, cache, or persist uploaded document photos to any disk, cloud storage, or database.
- **Purge on Extract:** Always release object URLs using `URL.revokeObjectURL()` immediately after reading base64 data on the client.
- **NO ID Numbers or Addresses:** Never extract, display, or store document numbers, chassis/registration numbers, or home addresses.
- **Storage Scope:** Client storage (`localStorage`) must ONLY store:
  - `id`: unique timestamp string or number
  - `nickname`: user-provided label (e.g., "Dad's Car PUC")
  - `docType`: one of the 5 allowed document types
  - `expiryDate`: ISO date string (`YYYY-MM-DD`)
  - `familyMember`: optional string for stretch goal

## 3. Supported Document Types (Strict Scope)
Only process the following 5 document categories:
1. Driving Licence
2. PUC Certificate
3. Vehicle Insurance
4. Passport
5. Appliance Warranty

## 4. Human-in-the-Loop Protocol
- Never commit AI extraction results directly to storage.
- Always require the user to verify/edit the detected `docType` and `expiryDate` via `ReviewModal.tsx` before writing to `localStorage`.

## 5. Coding Standards & Error Handling
- Never use `any` types for document metadata; use structured TypeScript interfaces (`DocumentRecord`).
- Wrap all async operations in clean try/catch blocks with user-friendly error state indicators.
- Do not add external heavy state management (Redux, Zustand); standard React state and hooks are sufficient.

## 6. Third-Party API Guardrails (Google Calendar)
- **Ephemeral Auth:** Never persist Google OAuth `access_token` strings to `localStorage` or cookies. The token must only exist in temporary React memory during the sync execution.
- **Strict Payload Minimization:** Google Calendar event descriptions and titles must ONLY contain the document `nickname`, `docType`, and static reminder text. Never attach raw JSON dumps, image data, or unverified extracted text to calendar events.
- **Client-Side Trigger:** Calendar syncing must remain an explicit, user-initiated action per document (via a "Sync" button), never an automatic background process.