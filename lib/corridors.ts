// Bangalore commercial corridors. Single source of truth for the /bangalore/[corridor]
// landing pages, the sitemap, and the MicroMarkets links on the homepage.
// Copy stays in the Gentle Space voice: plain, specific, no hype.

export type Corridor = {
  slug: string;
  name: string;
  /** Alternate name shown as a subtitle, if any. */
  aka?: string;
  /** Bare <title>; the layout template appends the brand. */
  metaTitle: string;
  /** ~150-160 char meta description. */
  metaDescription: string;
  /** Hero line on the corridor page. */
  tagline: string;
  /** One or two sentences of orientation. */
  intro: string;
  /** What the corridor is known for — rendered as chips. */
  knownFor: string[];
  /** Space types commonly available here. */
  spaceTypes: string[];
  /** Who the corridor tends to suit. */
  bestFor: string;
};

export const CORRIDORS: Corridor[] = [
  {
    slug: "whitefield",
    name: "Whitefield",
    metaTitle: "Office Space in Whitefield, Bangalore",
    metaDescription:
      "Find office, retail and warehouse space in Whitefield, Bangalore — matched to your brief, verified and negotiated through to signing.",
    tagline: "Commercial space in Whitefield, matched to your brief.",
    intro:
      "Whitefield is East Bangalore's mature IT hub — campus-style tech parks, established infrastructure, and deep occupier demand. We help you find space here without wading through inflated listings.",
    knownFor: ["Tech parks & IT campuses", "Established occupier base", "East Bangalore"],
    spaceTypes: ["Managed & coworking", "Bare-shell offices", "Retail", "Warehouse"],
    bestFor: "IT/ITeS teams and GCCs wanting a settled East Bangalore address.",
  },
  {
    slug: "outer-ring-road",
    name: "Outer Ring Road",
    aka: "ORR",
    metaTitle: "Office Space on Outer Ring Road (ORR), Bangalore",
    metaDescription:
      "Office space on Outer Ring Road (ORR), Bangalore — Grade A corridors from Marathahalli to Sarjapur, matched to your brief and lease terms.",
    tagline: "Commercial space on Outer Ring Road, matched to your brief.",
    intro:
      "The ORR corridor from Marathahalli to Sarjapur is Bangalore's office spine — Grade A stock and the highest concentration of large occupiers in the city. We track what's actually available and what it should cost.",
    knownFor: ["Grade A office spine", "GCC & enterprise density", "Marathahalli–Sarjapur"],
    spaceTypes: ["Grade A offices", "Managed & coworking", "Bare-shell floors"],
    bestFor: "Enterprises and GCCs needing large, well-connected Grade A floors.",
  },
  {
    slug: "koramangala",
    name: "Koramangala",
    metaTitle: "Office & Retail Space in Koramangala, Bangalore",
    metaDescription:
      "Office, coworking and retail space in Koramangala, Bangalore — central, startup-dense and metro-connected, matched to your brief.",
    tagline: "Commercial space in Koramangala, matched to your brief.",
    intro:
      "Koramangala is central Bangalore's startup heartland — premium addresses, a dense coworking scene, and strong high-street retail. We help you secure the right space before it moves.",
    knownFor: ["Startup ecosystem", "High-street retail", "Central & metro-linked"],
    spaceTypes: ["Coworking & managed", "Boutique offices", "High-street retail"],
    bestFor: "Startups and consumer brands wanting a central, high-visibility base.",
  },
  {
    slug: "indiranagar",
    name: "Indiranagar",
    metaTitle: "Office & Retail Space in Indiranagar, Bangalore",
    metaDescription:
      "Office and retail space in Indiranagar, Bangalore — a premium central address on 100 Feet Road and CMH Road, matched to your brief.",
    tagline: "Commercial space in Indiranagar, matched to your brief.",
    intro:
      "Indiranagar pairs premium boutique offices with some of Bangalore's strongest retail frontage on 100 Feet Road and CMH Road. We match your brief to space that fits the address and the budget.",
    knownFor: ["Premium retail frontage", "Boutique offices", "Central & connected"],
    spaceTypes: ["Boutique offices", "Coworking", "High-street retail"],
    bestFor: "Brands and smaller teams wanting a premium, central presence.",
  },
  {
    slug: "hsr-layout",
    name: "HSR Layout",
    metaTitle: "Office & Coworking Space in HSR Layout, Bangalore",
    metaDescription:
      "Office and coworking space in HSR Layout, Bangalore — a fast-growing startup corridor close to ORR, matched to your brief and budget.",
    tagline: "Commercial space in HSR Layout, matched to your brief.",
    intro:
      "HSR Layout has become a startup corridor in its own right — coworking, managed offices, and residential-adjacent convenience close to the ORR belt. We help you find the right fit as it fills up.",
    knownFor: ["Growing startup base", "Coworking-heavy", "Close to ORR"],
    spaceTypes: ["Coworking & managed", "Furnished offices", "Retail"],
    bestFor: "Early-stage and scaling startups wanting flexibility near ORR.",
  },
  {
    slug: "electronic-city",
    name: "Electronic City",
    metaTitle: "Office Space in Electronic City, Bangalore",
    metaDescription:
      "Office and warehouse space in Electronic City, Bangalore — cost-effective South Bangalore IT belt on the elevated expressway, matched to your brief.",
    tagline: "Commercial space in Electronic City, matched to your brief.",
    intro:
      "Electronic City anchors South Bangalore's IT and manufacturing belt — larger footprints at more workable rents, with the elevated expressway easing the commute. We source and verify the options that fit.",
    knownFor: ["IT & manufacturing belt", "Workable rents", "South Bangalore"],
    spaceTypes: ["Bare-shell offices", "Managed offices", "Warehouse & industrial"],
    bestFor: "Teams wanting larger space at a more efficient cost per seat.",
  },
  {
    slug: "mg-road",
    name: "MG Road",
    metaTitle: "Office Space on MG Road, Bangalore",
    metaDescription:
      "Office and retail space on MG Road, Bangalore — the established central business district, metro-connected, matched to your brief.",
    tagline: "Commercial space on MG Road, matched to your brief.",
    intro:
      "MG Road and the surrounding CBD remain Bangalore's established business address — premium buildings, direct metro access, and a central location. We help you find space that holds up on terms as well as prestige.",
    knownFor: ["Central business district", "Direct metro access", "Premium buildings"],
    spaceTypes: ["Grade A offices", "Managed offices", "Retail"],
    bestFor: "Firms wanting a prestigious, central, well-connected address.",
  },
  {
    slug: "sarjapur-road",
    name: "Sarjapur Road",
    metaTitle: "Office Space on Sarjapur Road, Bangalore",
    metaDescription:
      "Office and coworking space on Sarjapur Road, Bangalore — a fast-growing extension of the ORR tech belt, matched to your brief and lease terms.",
    tagline: "Commercial space on Sarjapur Road, matched to your brief.",
    intro:
      "Sarjapur Road extends the ORR tech belt into one of Bangalore's fastest-growing corridors — new stock, strong residential catchment, and rising occupier interest. We track what's coming and what it should cost.",
    knownFor: ["Fast-growing corridor", "Extends the ORR belt", "New stock"],
    spaceTypes: ["Managed & coworking", "Bare-shell offices", "Retail"],
    bestFor: "Teams wanting newer space with room to grow near ORR.",
  },
];

export function getCorridor(slug: string): Corridor | undefined {
  return CORRIDORS.find((c) => c.slug === slug);
}
