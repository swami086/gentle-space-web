(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Word-split hero headline
  var headline = document.querySelector("[data-split-words]");
  if (headline) {
    var text = headline.textContent.trim();
    var words = text.split(/\s+/);
    headline.textContent = "";
    words.forEach(function (word, i) {
      var span = document.createElement("span");
      span.className = "word";
      span.style.setProperty("--i", String(i));
      span.textContent = word + (i < words.length - 1 ? "\u00A0" : "");
      headline.appendChild(span);
    });
    requestAnimationFrame(function () {
      headline.classList.add("is-ready");
    });
  }

  // Hero image reveal
  var heroMedia = document.querySelector("[data-hero-reveal]");
  if (heroMedia) {
    if (prefersReduced) {
      heroMedia.classList.add("is-revealed");
    } else {
      requestAnimationFrame(function () {
        heroMedia.classList.add("is-revealed");
      });
    }
  }

  // Scroll reveals
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
      { threshold: 0.12, rootMargin: "0px 0px -50px 0px" }
    );
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("is-visible"); });
  }

  // Header
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 20);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // Mobile nav
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

  // FAQ
  document.querySelectorAll("[data-faq-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      btn.closest(".faq-item").classList.toggle("is-open");
    });
  });

  // GSAP pinned services scrub (one true pin moment)
  var pinSection = document.querySelector("[data-pin-services]");
  var cards = pinSection ? pinSection.querySelectorAll(".pin-card") : [];
  var progressBar = document.querySelector("[data-pin-progress]");

  function setActiveCard(index) {
    cards.forEach(function (card, i) {
      card.classList.toggle("is-active", i === index);
    });
    if (progressBar && cards.length) {
      progressBar.style.transform = "scaleX(" + ((index + 1) / cards.length) + ")";
    }
  }

  if (pinSection && cards.length && window.gsap && window.ScrollTrigger && !prefersReduced) {
    gsap.registerPlugin(ScrollTrigger);
    setActiveCard(0);

    ScrollTrigger.create({
      trigger: pinSection,
      start: "top top",
      end: function () { return "+=" + cards.length * 80 + "%"; },
      pin: true,
      scrub: 0.4,
      onUpdate: function (self) {
        var idx = Math.min(cards.length - 1, Math.floor(self.progress * cards.length));
        setActiveCard(idx);
      },
    });
  } else if (cards.length) {
    // Fallback: show all cards stacked statically (CSS handles reduced-motion)
    setActiveCard(0);
  }

  // Modal + WhatsApp
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
    setTimeout(function () { overlay.hidden = true; }, 300);
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
