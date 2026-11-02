import crypto from "node:crypto";
import { redirect } from "next/navigation";

const MAX_TTL_SEC = 7 * 24 * 60 * 60;

type ListingPayload = {
  listingId: string;
  phone: string;
  exp: number;
};

type VerifyResult =
  | { ok: true; payload: ListingPayload }
  | { ok: false; message: string };

function verifyListingToken(token: string): VerifyResult {
  const secret = process.env.LISTING_PAGE_SECRET;
  if (!secret) {
    return { ok: false, message: "This link is not available right now." };
  }

  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, message: "This link is invalid." };
  }

  const payloadPart = token.slice(0, dot);
  const sigHex = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/i.test(sigHex)) {
    return { ok: false, message: "This link is invalid." };
  }

  let payloadBytes: Buffer;
  try {
    payloadBytes = Buffer.from(payloadPart, "base64url");
  } catch {
    return { ok: false, message: "This link is invalid." };
  }

  const expected = crypto.createHmac("sha256", secret).update(payloadBytes).digest();
  const given = Buffer.from(sigHex, "hex");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, message: "This link is invalid." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return { ok: false, message: "This link is invalid." };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as ListingPayload).listingId !== "string" ||
    typeof (parsed as ListingPayload).phone !== "string" ||
    typeof (parsed as ListingPayload).exp !== "number"
  ) {
    return { ok: false, message: "This link is invalid." };
  }

  const payload = parsed as ListingPayload;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now || payload.exp > now + MAX_TTL_SEC) {
    return { ok: false, message: "This link has expired." };
  }

  return { ok: true, payload };
}

async function echoListingFactsPreview(formData: FormData) {
  "use server";

  const token = formData.get("token");
  if (typeof token !== "string") {
    return;
  }

  const verified = verifyListingToken(token);
  if (!verified.ok) {
    redirect(`/l/${encodeURIComponent(token)}`);
  }

  const rent = String(formData.get("rent") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const photo = formData.get("photo");
  const photoName =
    photo instanceof File && photo.name.length > 0 ? photo.name : "(no file selected)";

  const q = new URLSearchParams({
    preview: "1",
    rent,
    description,
    photoName,
  });
  redirect(`/l/${encodeURIComponent(token)}?${q.toString()}`);
}

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{
    preview?: string;
    rent?: string;
    description?: string;
    photoName?: string;
  }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const verified = verifyListingToken(token);

  if (!verified.ok) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <p className="text-sm text-muted-foreground">{verified.message}</p>
      </main>
    );
  }

  const { listingId, phone } = verified.payload;
  const showPreview = sp.preview === "1";

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-medium text-foreground">Listing details</h1>
        <p className="text-sm text-muted-foreground">
          Listing <span className="font-mono text-foreground">{listingId}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Phone <span className="font-mono text-foreground">{phone}</span>
        </p>
      </header>

      <form action={echoListingFactsPreview} className="flex flex-col gap-4" encType="multipart/form-data">
        <input type="hidden" name="token" value={token} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Rent</span>
          <input
            name="rent"
            type="text"
            defaultValue={sp.rent ?? ""}
            className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Short description</span>
          <textarea
            name="description"
            rows={3}
            defaultValue={sp.description ?? ""}
            className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Photo</span>
          <input name="photo" type="file" accept="image/*" className="text-sm text-muted-foreground" />
        </label>
        <button
          type="submit"
          className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Preview
        </button>
      </form>

      {showPreview && (
        <section className="rounded-md border border-border p-4">
          <h2 className="text-sm font-medium text-foreground">Preview (not saved)</h2>
          <dl className="mt-2 space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Rent</dt>
              <dd className="text-foreground">{sp.rent ?? ""}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Description</dt>
              <dd className="whitespace-pre-wrap text-foreground">{sp.description ?? ""}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Photo file</dt>
              <dd className="font-mono text-foreground">{sp.photoName ?? "(no file selected)"}</dd>
            </div>
          </dl>
        </section>
      )}
    </main>
  );
}
