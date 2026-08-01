export const SITE = {
  /** Full brand for titles, WhatsApp, and plain-text contexts. */
  name: "Gentle Space CRE",
  nameCore: "Gentle Space",
  nameQualifier: "CRE",
  nameQualifierExpanded: "Commercial Real Estate",
  legalName: "Gentle Space Global Solutions",
  email: "email@gentlespacesolutions.com",
  phoneDisplay: "+91 81052 79639",
  phoneE164: "918105279639",
  addressShort:
    "Rear wing, Ground Floor, Vakil Square, BTM 1st Stage, Bengaluru 560029",
  addressFull:
    "Rear wing, Ground Floor, Vakil Square, KEB Colony, New Gurappana Palya, 1st Stage, BTM 1st Stage, Bengaluru, Karnataka 560029",
  mapsUrl:
    "https://www.google.com/maps?daddr=Rear+wing,+Ground+Floor,+Vakil+Square,+KEB+Colony,+New+Gurappana+Palya,+1st+Stage,+BTM+1st+Stage,+Bengaluru,+Karnataka+560029",
  gstin: "29AAKCG5685J1ZU",
  cin: "U68100KA2023PTC175577",
  linkedinFounder: "https://in.linkedin.com/in/sanjay-singh-5a354347",
  linkedinCompany:
    "https://www.linkedin.com/company/gentle-space-global-solutions",
  heroImage:
    "https://images.unsplash.com/photo-1684791394054-f79686977f29?auto=format&fit=crop&w=1080&q=80",
} as const;

export function spaceListingUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gentle-space-web.onrender.com";
  return `${base.replace(/\/$/, "")}/spaces/${slug}`;
}
