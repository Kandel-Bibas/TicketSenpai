import "./globals.css";
import { Shell } from "../components/shell";
export const metadata = {
  title: "TicketSenpai — Your next great night",
  description: "Discover live music, pick your seats, and keep the memories.",
};
export default function Layout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
