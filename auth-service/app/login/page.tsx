import { Lock } from "lucide-react";
import { signIn } from "@/auth";
import { BrandLockup } from "@/components/BrandLockup";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const DEFAULT_RETURN_TO = process.env.ADS_APP_URL?.trim() || "http://localhost:3030/";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const { return_to } = await searchParams;
  const returnTo = return_to && return_to.length > 0 ? return_to : DEFAULT_RETURN_TO;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <Card className="auth-card-enter w-full max-w-sm">
        <CardHeader className="items-center gap-4 pt-8 text-center">
          <BrandLockup />
          <div className="flex flex-col gap-1.5">
            <CardTitle>Sign in to continue</CardTitle>
            <CardDescription className="text-balance">
              Use your Google account. New teammates get access once an admin assigns a role.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form
            action={async () => {
              "use server";
              await signIn("google", {
                redirectTo: `/bridge?return_to=${encodeURIComponent(returnTo)}`,
              });
            }}
          >
            <Button type="submit" variant="outline" size="lg" className="w-full">
              <GoogleIcon />
              Continue with Google
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center pb-8">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" strokeWidth={2} aria-hidden="true" />
            Secured with Google sign-in
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
