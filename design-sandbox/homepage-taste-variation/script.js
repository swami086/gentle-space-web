// Reveal-on-scroll via IntersectionObserver (never window scroll listeners,
// per design-taste-frontend Section 5.D) + the real lib/whatsapp.ts lead flow.
(function () {
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!reduceMotion && "IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    document.querySelectorAll(".reveal").forEach(function (el) {
      observer.observe(el);
    });
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  var PHONE_E164 = "918105279639";
  var NEED_LABELS = {
    office: "Office space",
    retail: "Retail space",
    lease: "Lease out my property",
  };

  var overlay = document.querySelector("[data-modal-overlay]");
  var form = document.getElementById("lead-form");
  var nameInput = document.getElementById("lead-name");
  var phoneInput = document.getElementById("lead-phone");
  var briefInput = document.getElementById("lead-brief");
  var needButtons = document.querySelectorAll(".need-btn");
  var need = "office";

  function openModal() {
    overlay.classList.add("open");
  }

  function closeModal() {
    overlay.classList.remove("open");
    form.reset();
    need = "office";
    needButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.need === "office");
    });
  }

  document.querySelectorAll("[data-open-modal]").forEach(function (btn) {
    btn.addEventListener("click", openModal);
  });
  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", closeModal);
  });
  overlay.addEventListener("mousedown", function (event) {
    if (event.target === overlay) closeModal();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && overlay.classList.contains("open")) closeModal();
  });

  needButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      need = btn.dataset.need;
      needButtons.forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
    });
  });

  function buildWhatsAppUrl(data) {
    var body = [
      "Gentle Space — property e-brochure request",
      "",
      "Name: " + data.name.trim(),
      "WhatsApp: " + data.phone.trim(),
      "Need: " + NEED_LABELS[data.need],
      "Brief: " + data.brief.trim(),
    ].join("\n");
    return "https://wa.me/" + PHONE_E164 + "?text=" + encodeURIComponent(body);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var name = nameInput.value;
    var phone = phoneInput.value;
    var brief = briefInput.value;
    if (!name.trim() || !phone.trim() || !brief.trim()) return;
    window.open(buildWhatsAppUrl({ name: name, phone: phone, need: need, brief: brief }), "_blank", "noopener,noreferrer");
    closeModal();
  });

  // Close the mobile menu after a link is tapped.
  var navToggle = document.getElementById("nav-toggle");
  document.querySelectorAll(".mobile-nav a").forEach(function (a) {
    a.addEventListener("click", function () {
      navToggle.checked = false;
    });
  });
})();
