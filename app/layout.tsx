import "./globals.css";

export const metadata = {
  title: "Agentic Coach UX",
  description: "Frontend concept for the Agentic Coach experience."
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
