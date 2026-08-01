// JSON-LD schema builders. Kept framework-agnostic (plain objects) so they can be
// serialized by the <JsonLd> component on any server page.
import { FAQ_ITEMS } from "./content-faq";
import { SITE, SITE_URL } from "./site";

const ORG_ID = `${SITE_URL}/#organization`;

/** RealEstateAgent / LocalBusiness for the homepage. */
export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    "@id": ORG_ID,
    name: SITE.name,
    legalName: SITE.legalName,
    url: SITE_URL,
    email: SITE.email,
    telephone: SITE.phoneDisplay,
    image: `${SITE_URL}/opengraph-image`,
    address: {
      "@type": "PostalAddress",
      streetAddress:
        "Rear wing, Ground Floor, Vakil Square, KEB Colony, New Gurappana Palya, 1st Stage, BTM 1st Stage",
      addressLocality: "Bengaluru",
      addressRegion: "Karnataka",
      postalCode: "560029",
      addressCountry: "IN",
    },
    areaServed: { "@type": "City", name: "Bengaluru" },
    sameAs: [SITE.linkedinCompany, SITE.linkedinFounder],
  };
}

/** FAQPage from the shared FAQ content. */
export function faqPageSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function breadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: entry.url,
    })),
  };
}

export function realEstateListingSchema(opts: {
  name: string;
  description: string;
  url: string;
  images: string[];
  locality: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: opts.name,
    description: opts.description,
    url: opts.url,
    ...(opts.images.length > 0 ? { image: opts.images } : {}),
    areaServed: { "@type": "City", name: opts.locality || "Bengaluru" },
    provider: { "@id": ORG_ID },
  };
}
