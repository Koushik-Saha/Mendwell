import type { Metadata } from "next";
import { server } from "@/lib/server/context";
import { getSessionPageContext } from "@/lib/server/page-context";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage() {
  const ctx = await getSessionPageContext("/onboarding");
  const existing = await server().repos.access.listForUser(ctx.user.id);
  return (
    <>
      <h1 className="text-xl font-semibold">{existing.length ? "Create another workspace" : "Set up your workspace"}</h1>
      <p className="mt-1 text-muted-foreground">A workspace holds your sites, fixes and reports. You can rename it later.</p>
      <OnboardingForm />
    </>
  );
}
