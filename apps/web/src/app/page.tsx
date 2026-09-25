import { redirect } from "next/navigation";

// The public landing page replaces this once marketing pages land.
export default function Home() {
  redirect("/dashboard");
}
