(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if ("IntersectionObserver" in window && !prefersReduced) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -24px 0px" }
    );
    document.querySelectorAll(".fade").forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll(".fade").forEach(function (el) { el.classList.add("is-visible"); });
  }

  var navToggle = document.querySelector("[data-nav-toggle]");
  var mobileNav = document.getElementById("mobile-nav");
  if (navToggle && mobileNav) {
    navToggle.addEventListener("click", function () {
      var open = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!open));
      mobileNav.classList.toggle("is-open", !open);
    });
    mobileNav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        navToggle.setAttribute("aria-expanded", "false");
        mobileNav.classList.remove("is-open");
      });
    });
  }

  document.querySelectorAll("[data-faq-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      btn.closest(".faq-item").classList.toggle("is-open");
    });
  });

  var overlay = document.querySelector("[data-modal-overlay]");
  var NEED_LABELS = { office: "Office space", retail: "Retail space", lease: "Lease out my property" };
  var WHATSAPP = "918105279639";

  function openModal() {
    if (!overlay) return;
    overlay.hidden = false;
    requestAnimationFrame(function () { overlay.classList.add("is-open"); });
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    if (!overlay) return;
    overlay.classList.remove("is-open");
    document.body.style.overflow = "";
    setTimeout(function () { overlay.hidden = true; }, 200);
  }

  document.querySelectorAll("[data-open-modal]").forEach(function (b) {
    b.addEventListener("click", openModal);
  });
  var closeBtn = document.querySelector("[data-close-modal]");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (overlay) {
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) closeModal();
    });
  }
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && overlay && overlay.classList.contains("is-open")) closeModal();
  });

  var needPills = document.querySelector("[data-need-pills]");
  var needInput = document.querySelector("[data-need-input]");
  if (needPills && needInput) {
    needPills.querySelectorAll("[data-need]").forEach(function (pill) {
      pill.addEventListener("click", function () {
        needPills.querySelectorAll("[data-need]").forEach(function (p) { p.classList.remove("is-selected"); });
        pill.classList.add("is-selected");
        needInput.value = pill.getAttribute("data-need");
      });
    });
  }

  var form = document.querySelector("[data-lead-form]");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var name = String(fd.get("name") || "").trim();
      var phone = String(fd.get("phone") || "").trim();
      var need = String(fd.get("need") || "office");
      var brief = String(fd.get("brief") || "").trim();
      if (!name || !phone || !brief) return;
      var body = [
        "Gentle Space - property e-brochure request",
        "",
        "Name: " + name,
        "WhatsApp: " + phone,
        "Need: " + (NEED_LABELS[need] || need),
        "Brief: " + brief,
      ].join("\n");
      window.open("https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(body), "_blank", "noopener,noreferrer");
      closeModal();
      form.reset();
      if (needInput) needInput.value = "office";
      if (needPills) {
        needPills.querySelectorAll("[data-need]").forEach(function (p) {
          p.classList.toggle("is-selected", p.getAttribute("data-need") === "office");
        });
      }
    });
  }
})();
