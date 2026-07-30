export const SERVICES_CONTENT = {
  kicker: "WHAT WE DO",
  heading: "Commercial real estate across Bangalore, matched to your brief.",
  subtext:
    "Every requirement is different, so we start with yours: space type, corridor, budget, and lease terms. Then we verify, negotiate, and handle the paperwork through close.",
  groups: [
    {
      label: "FOR COMPANIES",
      items: [
        {
          title: "Tenant Representation",
          body:
            "We search, tour, and negotiate to your brief. Verification, legal, and paperwork are handled through handover.",
        },
        {
          title: "Managed & Coworking Advisory",
          body:
            "Need a space ready to move into? We help with managed offices, coworking, and furnished floors.",
        },
        {
          title: "Multi-location Portfolio Strategy",
          body:
            "Opening a second or third Bangalore location? We plan the leases together, on the same timeline, so terms and renewal dates line up across your footprint.",
        },
      ],
    },
    {
      label: "FOR PROPERTY OWNERS",
      items: [
        {
          title: "Tenant Sourcing & Leasing",
          body:
            "We screen occupants against your asset, corridor, and lease goals before they ever see the space.",
        },
        {
          title: "Rent & Asset Positioning",
          body:
            "We price your space against current Bangalore rent and vacancy data for that corridor, so the number holds up in negotiation.",
        },
        {
          title: "Renewal & Retention",
          body:
            "Good tenants are worth keeping. Renewals are where deals quietly fall apart if nobody owns the paperwork, so we do.",
        },
      ],
    },
  ],
} as const;

export const HOW_IT_WORKS_CONTENT = {
  kicker: "HOW IT WORKS",
  heading: "From brief to signed lease, six steps.",
  steps: [
    {
      label: "01",
      title: "Client Requirement",
      body:
        "Team size, budget, locations, lease length, timeline: every detail that decides whether a space actually fits your business.",
    },
    {
      label: "02",
      title: "Pre-Vetted Sourcing",
      body:
        "We source Bangalore options across every property type and score them on rent, location, and building quality. Documents get checked before anything reaches your shortlist.",
    },
    {
      label: "03",
      title: "Shortlist",
      body:
        "Built around your parameters: location, budget, size, quality, commute, lease terms. Everything on it fits your brief.",
    },
    {
      label: "04",
      title: "Property Tours",
      body:
        "We walk you through each option with real context on pricing and demand in that corridor.",
    },
    {
      label: "05",
      title: "Price Negotiations",
      body:
        "We negotiate rent, lock-in, and incentives using live Bangalore lease comps.",
    },
    {
      label: "06",
      title: "Verification, Legal & Paperwork",
      body:
        "Handled through to handover.",
    },
  ],
} as const;
