import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const { return_to } = await searchParams;
  const returnTo = return_to ?? "/";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-xl font-semibold">Gentle Space Admin</h1>
      <p className="max-w-sm text-sm text-gray-500">
        Sign in with your Google account. New accounts need an admin to grant access before you can
        use the dashboard.
      </p>
      <form
        action={async () => {
          "use server";
          await signIn("google", {
            redirectTo: `/bridge?return_to=${encodeURIComponent(returnTo)}`,
          });
        }}
      >
        <button
          type="submit"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
        >
          Sign in with Google
        </button>
      </form>
    </div>
  );
}
