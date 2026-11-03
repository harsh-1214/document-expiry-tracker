"use client";

import { X, ExternalLink, Info, ShieldCheck } from "lucide-react";

interface RenewalGuideProps {
  docType: string | null;
  isOpen: boolean;
  onClose: () => void;
}

const GUIDE_DATA: Record<string, { url: string; title: string; steps: string[] }> = {
  "Driving Licence": {
    url: "https://sarathi.parivahan.gov.in/",
    title: "Parivahan Sarathi (Ministry of Road Transport)",
    steps: [
      "Select your State from the dropdown.",
      "Click on 'Apply for DL Renewal'.",
      "Keep your expired DL number and Aadhaar ready for eKYC.",
    ],
  },
  "PUC Certificate": {
    url: "https://vahan.parivahan.gov.in/puc/",
    title: "Parivahan PUCC Portal",
    steps: [
      "PUC cannot be renewed entirely online. You must visit a local emission testing center.",
      "Use the portal link to check your old PUC details using your Registration Number.",
      "Carry your vehicle to the nearest fuel pump with a PUC kiosk.",
    ],
  },
  "Passport": {
    url: "https://www.passportindia.gov.in/",
    title: "Passport Seva (Ministry of External Affairs)",
    steps: [
      "Log in to the Passport Seva portal.",
      "Click 'Apply for Fresh Passport/Re-issue of Passport'.",
      "Pay the fee online and book an appointment at your nearest PSK/POPSK.",
    ],
  },
  "Vehicle Insurance": {
    url: "https://www.policybazaar.com/motor-insurance/",
    title: "Your Insurance Provider or Aggregator",
    steps: [
      "Locate your previous policy document for the Policy Number.",
      "Log in to your specific provider (e.g., HDFC Ergo, Acko) or an aggregator.",
      "Do not let it lapse, or your vehicle will require physical inspection.",
    ],
  },
  "Appliance Warranty": {
    url: "#",
    title: "Manufacturer's Official Support",
    steps: [
      "Locate your original purchase invoice (Amazon/Flipkart or physical bill).",
      "Find the brand's official toll-free number or support website.",
      "Have your product Serial Number ready before calling.",
    ],
  },
};

export default function RenewalGuide({ docType, isOpen, onClose }: RenewalGuideProps) {
  if (!isOpen || !docType) return null;

  const guide = GUIDE_DATA[docType] || {
    url: "#",
    title: "General Renewal Process",
    steps: ["Check official documentation.", "Contact the issuing authority."],
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="bg-blue-600 p-5 flex items-start justify-between text-white">
          <div>
            <h2 className="text-xl font-bold">How to Renew</h2>
            <p className="text-blue-100 text-sm mt-1">{docType}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-blue-500 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
              <Info className="w-4 h-4" /> Checklist
            </h3>
            <ul className="space-y-2">
              {guide.steps.map((step, idx) => (
                <li key={idx} className="flex gap-3 text-sm text-slate-700">
                  <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold text-xs">
                    {idx + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 mb-1">
              <ShieldCheck className="w-4 h-4" /> Official Portal
            </div>
            <p className="text-sm font-medium text-slate-900">{guide.title}</p>
            
            {guide.url !== "#" ? (
              <a 
                href={guide.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                Proceed to Portal <ExternalLink className="w-4 h-4" />
              </a>
            ) : (
              <button disabled className="w-full py-2.5 bg-slate-200 text-slate-500 rounded-lg text-sm font-medium cursor-not-allowed">
                Refer to local provider
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}