// Shared FAQ content — consumed by the FAQ component (UI) and the FAQPage
// JSON-LD builder, so the two never drift.

export const FAQ_ITEMS = [
  {
    question: "How do fees work?",
    answer:
      "Standard requirements cost nothing. If we need to search outside our existing network for something highly specific, we agree a fixed fee with you first.",
  },
  {
    question: "Which Bangalore locations do you cover?",
    answer:
      "All of Bangalore and the areas around it. Whitefield, Outer Ring Road, Koramangala, Indiranagar, HSR Layout, Electronic City, MG Road, and Sarjapur Road see the most activity, and that's just a sample of where we work.",
  },
  {
    question: "How are commercial real estate consultants different from property listings?",
    answer:
      "Listings show you what's available. They don't tell you if the building has legal issues, if the landlord is reliable, or if the price is inflated. We check all of that before you tour anything.",
  },
  {
    question: "How long does the consulting process take?",
    answer:
      "A shortlist usually follows your brief within five working days. Getting from brief to signed lease typically takes one to four weeks, depending on what you need.",
  },
  {
    question: "Do you handle verification, legal, and paperwork?",
    answer:
      "Yes, through handover, and we stay involved for renewals and expansions after you've moved in.",
  },
  {
    question: "Why choose Gentle Space CRE as commercial real estate consultants in Bangalore?",
    answer:
      "We work across every commercial property type in Bangalore, for both companies and property owners, and we stay on the deal through verification, legal, and paperwork instead of handing you off after the intro call.",
  },
] as const;

export type FaqItem = (typeof FAQ_ITEMS)[number];
