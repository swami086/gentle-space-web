import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { BrandLockup } from "@/components/BrandLockup";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const ERROR_COPY: Record<string, string> = {
  Configuration: "Google sign-in isn't configured correctly. Contact an admin.",
  AccessDenied: "Google denied this sign-in request. Try again with a different account.",
  OAuthSignin: "Couldn't start the Google sign-in request. Try again.",
  OAuthCallback: "Google's response couldn't be verified. Try again.",
  OAuthAccountNotLinked: "This email is already linked to a different sign-in method.",
  Default: "Something went wrong verifying your Google account. Try again, or contact an admin if this keeps happening.",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = (error && ERROR_COPY[error]) || ERROR_COPY.Default;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <Card className="auth-card-enter w-full max-w-sm">
        <CardHeader className="items-center gap-4 pt-8 text-center">
          <BrandLockup />
          <div className="flex flex-col items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10">
              <TriangleAlert className="size-5 text-destructive" strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-1.5">
              <CardTitle>Sign-in didn&apos;t go through</CardTitle>
              <CardDescription className="text-balance">{message}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg" className="w-full">
            <Link href="/login">Try again</Link>
          </Button>
        </CardContent>
        <CardFooter className="justify-center pb-8">
          <p className="text-xs text-muted-foreground">
            Still stuck? Ask an admin to check your access.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
