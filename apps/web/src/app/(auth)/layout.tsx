import { BrandMark } from "@/components/brand-mark";

/** Sign-in, 2FA, onboarding and invitations: one narrow stitched panel on the linen background. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <span className="text-lg font-bold tracking-[-0.015em]">Mendwell</span>
        </div>
        <div className="patch px-7 py-8 sm:px-9">{children}</div>
        <p className="mt-6 text-xs text-muted-foreground">
          Mendwell fixes common issues and verifies each fix. It does not certify ADA/WCAG compliance.
        </p>
      </div>
    </main>
  );
}
