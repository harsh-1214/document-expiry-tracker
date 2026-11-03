import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { GoogleOAuthProvider } from "@react-oauth/google";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Document Expiry Tracker",
  description: "100% private document expiry tracking powered by Gemini AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/*
          GoogleOAuthProvider must wrap the entire tree so that useGoogleLogin
          hooks inside client components can access the OAuth context.
          NEXT_PUBLIC_GOOGLE_CLIENT_ID is set in .env.local and is safe to
          expose to the browser (it is a public OAuth client ID, not a secret).
        */}
        <GoogleOAuthProvider
          clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ""}
        >
          {children}
        </GoogleOAuthProvider>
      </body>
    </html>
  );
}
