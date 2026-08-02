import "./globals.css";
import { Providers } from "./providers";

export const metadata = {
  title: "Inaya Vault",
  description: "A decentralized personal storage app built on @inaya-network/custody-sdk.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
