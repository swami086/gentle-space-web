const FAQ_ITEMS = [
  {
    question: "How do fees work?",
    answer:
      "We charge no fees for standard requirements. For highly customised needs where we invest our efforts to find properties outside of our standard inventory list, we charge a fixed fee.",
  },
  {
    question: "Which Bangalore locations do you cover?",
    answer:
      "Gentle Space covers all areas in Bangalore and can meet any custom requirements, We can accelerate across high growth areas like Whitefield, Outer Ring Road, Koramangala, Indiranagar, HSR Layout, Electronic City, MG Road, and Sarjapur Road for office and commercial leasing in Bangalore.",
  },
  {
    question: "How are commercial real estate consultants different from property listings?",
    answer:
      "Property listings are often inflated and mask crucial details that could present legal and commecial risk for client businesses. Gentle Space cater to highly customised needs for clients in a high trust environment ensuring that our clients get a market aligned deal that has been throughly vetted and legally safe.",
  },
  {
    question: "How long does the consulting process take?",
    answer:
      "A custom shortlist usually follows the brief within about five working days. Brief to signed lease can anywhere be between 1 to 4 weeks, depending on requirements.",
  },
  {
    question: "Do you handle verification, legal, and paperwork?",
    answer:
      "Yes. Gentle Space provides end-to-end support including verification, legal, and associated paperwork through handover, plus renewals and expansions after you move in.",
  },
  {
    question: "Why choose Gentle Space as commercial real estate consultants in Bangalore?",
    answer:
      "Gentle Space specialises in custom commercial real estate requirements in Bangalore for companies and property owners, with end-to-end verification, legal, and paperwork.",
  },
] as const;

export function FAQ() {
  return (
    <section className="bg-[var(--surface)] px-6 py-24 lg:px-[160px]">
      <div className="mx-auto flex max-w-[800px] flex-col items-center gap-12">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[1.2px] text-[var(--accent)]">
            FAQ
          </p>
          <h2 className="text-[28px] font-semibold tracking-tight text-[var(--ink)] lg:text-[34px]">
            FAQs: commercial real estate consultants in Bangalore
          </h2>
        </div>

        <div className="flex w-full flex-col gap-8">
          {FAQ_ITEMS.map((item) => (
            <div key={item.question} className="flex flex-col gap-2.5 pb-7">
              <h3 className="text-lg font-semibold text-[var(--ink)]">{item.question}</h3>
              <p className="text-[15px] leading-[1.6] text-[var(--ink-secondary)]">{item.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
