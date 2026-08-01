(function () {
  "use strict";

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Scroll reveal ----------
  if ("IntersectionObserver" in window && !prefersReducedMotion) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(".reveal").forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  // ---------- Sticky header shadow ----------
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // ---------- Mobile nav toggle ----------
  var navToggle = document.querySelector("[data-nav-toggle]");
  var mobileNav = document.getElementById("mobile-nav");
  if (navToggle && mobileNav) {
    navToggle.addEventListener("click", function () {
      var open = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!open));
      mobileNav.classList.toggle("is-open", !open);
    });
    mobileNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navToggle.setAttribute("aria-expanded", "false");
        mobileNav.classList.remove("is-open");
      });
    });
  }

  // ---------- Magnetic buttons ----------
  if (!prefersReducedMotion) {
    document.querySelectorAll("[data-magnetic]").forEach(function (btn) {
      var strength = 0.3;
      btn.addEventListener("mousemove", function (event) {
        var rect = btn.getBoundingClientRect();
        var x = event.clientX - rect.left - rect.width / 2;
        var y = event.clientY - rect.top - rect.height / 2;
        btn.style.transform = "translate(" + x * strength + "px, " + y * strength + "px)";
      });
      btn.addEventListener("mouseleave", function () {
        btn.style.transform = "translate(0, 0)";
      });
    });
  }

  // ---------- FAQ accordion ----------
  document.querySelectorAll("[data-faq-toggle]").forEach(function (button) {
    button.addEventListener("click", function () {
      var item = button.closest(".faq-item");
      item.classList.toggle("is-open");
    });
  });

  // ---------- Lead capture modal ----------
  var overlay = document.querySelector("[data-modal-overlay]");
  var openButtons = document.querySelectorAll("[data-open-modal]");
  var closeButton = document.querySelector("[data-close-modal]");
  var leadForm = document.querySelector("[data-lead-form]");
  var needPillsWrap = document.querySelector("[data-need-pills]");
  var needInput = document.querySelector("[data-need-input]");

  var NEED_LABELS = {
    office: "Office space",
    retail: "Retail space",
    lease: "Lease out my property",
  };
  var WHATSAPP_NUMBER = "918105279639";

  function openModal() {
    if (!overlay) return;
    overlay.hidden = false;
    requestAnimationFrame(function () {
      overlay.classList.add("is-open");
    });
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (!overlay) return;
    overlay.classList.remove("is-open");
    document.body.style.overflow = "";
    window.setTimeout(function () {
      overlay.hidden = true;
    }, 300);
  }

  openButtons.forEach(function (btn) {
    btn.addEventListener("click", openModal);
  });
  if (closeButton) closeButton.addEventListener("click", closeModal);
  if (overlay) {
    overlay.addEventListener("mousedown", function (event) {
      if (event.target === overlay) closeModal();
    });
  }
  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && overlay && overlay.classList.contains("is-open")) closeModal();
  });

  if (needPillsWrap && needInput) {
    needPillsWrap.querySelectorAll("[data-need]").forEach(function (pill) {
      pill.addEventListener("click", function () {
        needPillsWrap.querySelectorAll("[data-need]").forEach(function (p) {
          p.classList.remove("is-selected");
        });
        pill.classList.add("is-selected");
        needInput.value = pill.getAttribute("data-need");
      });
    });
  }

  if (leadForm) {
    leadForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var formData = new FormData(leadForm);
      var name = (formData.get("name") || "").toString().trim();
      var phone = (formData.get("phone") || "").toString().trim();
      var need = (formData.get("need") || "office").toString();
      var brief = (formData.get("brief") || "").toString().trim();
      if (!name || !phone || !brief) return;

      var body = [
        "Gentle Space - property e-brochure request",
        "",
        "Name: " + name,
        "WhatsApp: " + phone,
        "Need: " + (NEED_LABELS[need] || need),
        "Brief: " + brief,
      ].join("\n");

      window.open("https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(body), "_blank", "noopener,noreferrer");
      closeModal();
      leadForm.reset();
      if (needPillsWrap) {
        needPillsWrap.querySelectorAll("[data-need]").forEach(function (p) {
          p.classList.toggle("is-selected", p.getAttribute("data-need") === "office");
        });
      }
      if (needInput) needInput.value = "office";
    });
  }
})();
