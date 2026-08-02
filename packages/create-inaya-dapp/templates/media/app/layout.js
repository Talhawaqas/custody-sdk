import "./globals.css";

export const metadata = {
  title: "Inaya Media Viewer",
  description: "Fetch and decrypt Inaya-anchored assets for viewing, built on @inaya-network/custody-sdk.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
