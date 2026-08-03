// Lead-capture modal + WhatsApp deep link, ported from the app's real
// lib/whatsapp.ts logic so this sandbox behaves like the production form.
(function () {
  const PHONE_E164 = "918105279639";
  const NEED_LABELS = {
    office: "Office space",
    retail: "Retail space",
    lease: "Lease out my property",
  };

  const overlay = document.querySelector("[data-modal-overlay]");
  const form = document.getElementById("lead-form");
  const nameInput = document.getElementById("lead-name");
  const phoneInput = document.getElementById("lead-phone");
  const briefInput = document.getElementById("lead-brief");
  const needButtons = document.querySelectorAll(".need-btn");
  let need = "office";

  function openModal() {
    overlay.classList.add("open");
  }

  function closeModal() {
    overlay.classList.remove("open");
    form.reset();
    need = "office";
    needButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.need === "office"));
  }

  document.querySelectorAll("[data-open-modal]").forEach((btn) => btn.addEventListener("click", openModal));
  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", closeModal));
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay.classList.contains("open")) closeModal();
  });

  needButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      need = btn.dataset.need;
      needButtons.forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  function buildWhatsAppUrl({ name, phone, need, brief }) {
    const body = [
      "Gentle Space — property e-brochure request",
      "",
      `Name: ${name.trim()}`,
      `WhatsApp: ${phone.trim()}`,
      `Need: ${NEED_LABELS[need]}`,
      `Brief: ${brief.trim()}`,
    ].join("\n");
    return `https://wa.me/${PHONE_E164}?text=${encodeURIComponent(body)}`;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = nameInput.value;
    const phone = phoneInput.value;
    const brief = briefInput.value;
    if (!name.trim() || !phone.trim() || !brief.trim()) return;
    window.open(buildWhatsAppUrl({ name, phone, need, brief }), "_blank", "noopener,noreferrer");
    closeModal();
  });
})();
