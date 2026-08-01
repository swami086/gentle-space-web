/**
 * MOCK DATA — for frontend-redesign design lab only.
 * Not connected to the real Postgres listings DB, sync pipeline, or /api/spaces/* routes.
 * Field shapes mirror lib/db/listings.ts / lib/listings/public.ts (PublicListing) so this
 * can be swapped for a real fetch() later without changing markup.
 */
window.MOCK_LISTINGS = [
  {
    id: "mock-1",
    slug: "whitefield-tech-park-suite",
    title: "Whitefield Tech Park Suite",
    area: "Whitefield",
    city: "Bengaluru",
    shortTeaser: "Furnished 40-seat floor with a private terrace, five minutes from ITPL.",
    description:
      "A full furnished floor inside a Grade-A tech park campus, built for a team that wants to move in without a fit-out cycle. The terrace overlooks the internal courtyard and gets used for informal stand-ups most mornings.",
    amenities: ["High-speed fiber", "24/7 access", "Terrace", "Cafeteria", "Power backup"],
    images: [
      "https://picsum.photos/seed/gs-whitefield-tech/960/720",
      "https://picsum.photos/seed/gs-whitefield-tech-2/960/720",
    ],
    source: "coworker",
    approxLat: 12.9698,
    approxLng: 77.75,
    approxRadiusM: 500,
  },
  {
    id: "mock-2",
    slug: "indiranagar-100ft-loft",
    title: "Indiranagar 100ft Road Loft",
    area: "Indiranagar",
    city: "Bengaluru",
    shortTeaser: "Boutique 18-seat loft above a corner cafe, walk-to-everything location.",
    description:
      "A converted duplex on 100 Feet Road with exposed brick and a small private balcony. Best suited to a design or early-stage product team that wants a walkable neighborhood over a business park.",
    amenities: ["Meeting room", "Balcony", "Pantry", "Bike parking"],
    images: [
      "https://picsum.photos/seed/gs-indiranagar-loft/960/720",
      "https://picsum.photos/seed/gs-indiranagar-loft-2/960/720",
    ],
    source: "myhq",
    approxLat: 12.9716,
    approxLng: 77.6412,
    approxRadiusM: 500,
  },
  {
    id: "mock-3",
    slug: "koramangala-managed-office",
    title: "Koramangala Managed Office Floor",
    area: "Koramangala",
    city: "Bengaluru",
    shortTeaser: "60-seat managed floor near Sony World Junction with on-site IT support.",
    description:
      "A full managed office spanning one floor of a commercial building near Sony World Junction, with an on-site facilities and IT team already in place. Popular with Series A to C teams doing their first proper office fit-out.",
    amenities: ["On-site IT support", "Server room", "Cafeteria", "24/7 access", "Parking"],
    images: [
      "https://picsum.photos/seed/gs-koramangala-office/960/720",
      "https://picsum.photos/seed/gs-koramangala-office-2/960/720",
    ],
    source: "cofynd",
    approxLat: 12.9352,
    approxLng: 77.6245,
    approxRadiusM: 500,
  },
  {
    id: "mock-4",
    slug: "hsr-layout-startup-floor",
    title: "HSR Layout Startup Floor",
    area: "HSR Layout",
    city: "Bengaluru",
    shortTeaser: "Raw shell floor in Sector 2, ready for a custom fit-out.",
    description:
      "An unfurnished floor in HSR Sector 2, ideal for a team that wants to design its own layout rather than inherit someone else's floor plan. Landlord allows a phased fit-out over the first sixty days.",
    amenities: ["Raw shell", "Freight lift", "Power backup", "Parking"],
    images: [
      "https://picsum.photos/seed/gs-hsr-startup/960/720",
      "https://picsum.photos/seed/gs-hsr-startup-2/960/720",
    ],
    source: "gofloaters",
    approxLat: 12.9121,
    approxLng: 77.6446,
    approxRadiusM: 500,
  },
  {
    id: "mock-5",
    slug: "outer-ring-road-campus-block",
    title: "Outer Ring Road Campus Block",
    area: "Outer Ring Road",
    city: "Bengaluru",
    shortTeaser: "Independent block inside a business park, suited to a GCC setting up its first India office.",
    description:
      "A standalone block inside a larger business park campus on Outer Ring Road, with its own entrance and signage rights. Frequently shortlisted by overseas businesses opening their first Bangalore office.",
    amenities: ["Dedicated entrance", "Signage rights", "Cafeteria", "24/7 access", "Parking"],
    images: [
      "https://picsum.photos/seed/gs-orr-campus/960/720",
      "https://picsum.photos/seed/gs-orr-campus-2/960/720",
    ],
    source: "coworker",
    approxLat: 12.9351,
    approxLng: 77.6968,
    approxRadiusM: 500,
  },
  {
    id: "mock-6",
    slug: "mg-road-boutique-suite",
    title: "MG Road Boutique Suite",
    area: "MG Road",
    city: "Bengaluru",
    shortTeaser: "12-seat suite in a heritage building, five minutes from the metro.",
    description:
      "A small boutique suite in a restored heritage building just off MG Road, well suited to a client-facing team that values the address. Metro access makes it an easy commute from most parts of the city.",
    amenities: ["Metro access", "Reception service", "Meeting room", "Pantry"],
    images: [
      "https://picsum.photos/seed/gs-mgroad-suite/960/720",
      "https://picsum.photos/seed/gs-mgroad-suite-2/960/720",
    ],
    source: "myhq",
    approxLat: 12.9758,
    approxLng: 77.6069,
    approxRadiusM: 500,
  },
];
