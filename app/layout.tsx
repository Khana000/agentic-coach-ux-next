import "./globals.css";
import "./future.css";
import "./styles/fix-06.css";
import "./styles/fix-07.css";
import "./styles/fix-08.css";
import "./styles/fix-10.css";
import "./styles/fix-12.css";
import "./styles/fix-14.css";
import "./styles/fix-15.css";
import "./styles/change-avatar.css";

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
