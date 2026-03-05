import "./globals.css";

export const metadata = {
  title: "Executive & Leadership Coaching",
  description:
    "Evidence-based executive coaching designed for visionaries shaping the future."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
