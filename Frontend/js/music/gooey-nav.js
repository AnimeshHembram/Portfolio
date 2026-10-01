// ---------------------------------------------------------------------
// Music — GooeyNav (vanilla port)
// ---------------------------------------------------------------------
// A line-by-line behavioral port of the user-supplied React GooeyNav
// component (hooks + JSX) to plain DOM/JS. This portfolio has no build
// step, framework, or npm — same constraint that governed the Infinite
// Gallery's Three.js code (ported off React-Three-Fiber the same way).
// Nothing about the animation, particle physics, or gooey-pill visual
// effect is redesigned here: the math (noise/getXY/createParticle), the
// DOM structure it produces (nav > ul > li > a, plus the two .effect
// spans), and the accompanying CSS (music.css) are all kept as given.
//
// The one behavioral adaptation: the original demo used real <a href>
// navigation targets ("#", etc.). Here GooeyNav drives an in-page
// Songs / My Sounds / FM switcher (per approved Phase 1 plan), so each
// item's click/keydown handler calls the supplied onChange(index)
// instead of letting the browser navigate — everything else (particle
// burst on change, gooey pill fill, focus/keyboard handling) is
// unchanged.
//
// Plain classic script (no import/export, no JSX) — same convention as
// every other page in this portfolio — publishing itself as
// window.Music.createGooeyNav.
(function (global) {
  "use strict";

  function noise(n) {
    if (n === undefined) n = 1;
    return n / 2 - Math.random() * n;
  }

  function getXY(distance, pointIndex, totalPoints) {
    var angle = ((360 + noise(8)) / totalPoints) * pointIndex * (Math.PI / 180);
    return [distance * Math.cos(angle), distance * Math.sin(angle)];
  }

  function createParticle(i, t, d, r, particleCount, colors) {
    var rotate = noise(r / 10);
    return {
      start: getXY(d[0], particleCount - i, particleCount),
      end: getXY(d[1] + noise(7), particleCount - i, particleCount),
      time: t,
      scale: 1 + noise(0.2),
      color: colors[Math.floor(Math.random() * colors.length)],
      rotate: rotate > 0 ? (rotate + r / 20) * 10 : (rotate - r / 20) * 10,
    };
  }

  /**
   * @param {{
   *   container: HTMLElement,
   *   items: Array<{label: string}>,
   *   animationTime?: number,
   *   particleCount?: number,
   *   particleDistances?: [number, number],
   *   particleR?: number,
   *   timeVariance?: number,
   *   colors?: number[],
   *   initialActiveIndex?: number,
   *   onChange?: (index: number) => void,
   * }} options
   */
  function createGooeyNav(options) {
    var container = options.container;
    var items = options.items || [];
    var animationTime = options.animationTime || 600;
    var particleCount = options.particleCount || 15;
    var particleDistances = options.particleDistances || [90, 10];
    var particleR = options.particleR || 100;
    var timeVariance = options.timeVariance || 300;
    var colors = options.colors || [1, 2, 3, 1, 2, 3, 1, 4];
    var initialActiveIndex = options.initialActiveIndex || 0;
    var onChange = options.onChange || function () {};

    var activeIndex = initialActiveIndex;

    container.classList.add("gooey-nav-container");
    container.innerHTML = "";

    var nav = document.createElement("nav");
    var ul = document.createElement("ul");
    nav.appendChild(ul);

    var liEls = items.map(function (item, index) {
      var li = document.createElement("li");
      if (index === initialActiveIndex) li.classList.add("active");

      var a = document.createElement("a");
      a.href = "#";
      a.textContent = item.label;
      a.addEventListener("click", function (e) {
        e.preventDefault(); // in-page switcher, not a real navigation target
        handleSelect(index, li);
      });
      a.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          handleSelect(index, li);
        }
      });

      li.appendChild(a);
      ul.appendChild(li);
      return li;
    });

    var filterEl = document.createElement("span");
    filterEl.className = "effect filter";
    var textEl = document.createElement("span");
    textEl.className = "effect text";

    container.appendChild(nav);
    container.appendChild(filterEl);
    container.appendChild(textEl);

    function updateEffectPosition(el) {
      var containerRect = container.getBoundingClientRect();
      var pos = el.getBoundingClientRect();
      var styles = {
        left: pos.left - containerRect.left + "px",
        top: pos.top - containerRect.top + "px",
        width: pos.width + "px",
        height: pos.height + "px",
      };
      Object.assign(filterEl.style, styles);
      Object.assign(textEl.style, styles);
      textEl.textContent = el.textContent;
    }

    function makeParticles(element) {
      var d = particleDistances;
      var r = particleR;
      var bubbleTime = animationTime * 2 + timeVariance;
      element.style.setProperty("--time", bubbleTime + "ms");

      var _loop = function (i) {
        var t = animationTime * 2 + noise(timeVariance * 2);
        var p = createParticle(i, t, d, r, particleCount, colors);
        element.classList.remove("active");

        setTimeout(function () {
          var particle = document.createElement("span");
          var point = document.createElement("span");
          particle.classList.add("particle");
          particle.style.setProperty("--start-x", p.start[0] + "px");
          particle.style.setProperty("--start-y", p.start[1] + "px");
          particle.style.setProperty("--end-x", p.end[0] + "px");
          particle.style.setProperty("--end-y", p.end[1] + "px");
          particle.style.setProperty("--time", p.time + "ms");
          particle.style.setProperty("--scale", String(p.scale));
          particle.style.setProperty("--color", "var(--color-" + p.color + ", white)");
          particle.style.setProperty("--rotate", p.rotate + "deg");

          point.classList.add("point");
          particle.appendChild(point);
          element.appendChild(particle);
          requestAnimationFrame(function () {
            element.classList.add("active");
          });
          setTimeout(function () {
            try {
              element.removeChild(particle);
            } catch (err) {
              // already removed — fine
            }
          }, p.time);
        }, 30);
      };

      for (var i = 0; i < particleCount; i++) _loop(i);
    }

    function handleSelect(index, liEl) {
      if (activeIndex === index) return;

      liEls.forEach(function (li) {
        li.classList.remove("active");
      });
      liEl.classList.add("active");
      activeIndex = index;

      updateEffectPosition(liEl);

      var particles = filterEl.querySelectorAll(".particle");
      particles.forEach(function (p) {
        filterEl.removeChild(p);
      });

      textEl.classList.remove("active");
      void textEl.offsetWidth; // force reflow so the class removal registers before re-adding
      textEl.classList.add("active");

      makeParticles(filterEl);

      onChange(index);
    }

    var initialLi = liEls[initialActiveIndex];
    if (initialLi) {
      // One frame so the container has real layout (it may have just
      // been inserted/shown) before measuring it — mirrors the original
      // component's mount-time effect, minus React's lifecycle.
      requestAnimationFrame(function () {
        updateEffectPosition(initialLi);
        textEl.classList.add("active");
      });
    }

    var resizeObserver = new ResizeObserver(function () {
      var currentLi = liEls[activeIndex];
      if (currentLi) updateEffectPosition(currentLi);
    });
    resizeObserver.observe(container);

    return {
      setActive: function (index) {
        var li = liEls[index];
        if (li) handleSelect(index, li);
      },
      destroy: function () {
        resizeObserver.disconnect();
      },
    };
  }

  global.Music = global.Music || {};
  global.Music.createGooeyNav = createGooeyNav;
})(window);
