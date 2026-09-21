(function () {
  var loaderScreen = document.getElementById("loaderScreen");
  var landing = document.getElementById("landing");
  var cursor = document.getElementById("cursor");

  var HOLD_DURATION = 1600; // ms — how long the loading page is shown
  var FADE_DURATION = 600; // ms — loading page fading out

  window.setTimeout(function () {
    // Loading page fades out
    loaderScreen.style.transition = "opacity " + FADE_DURATION + "ms ease";
    loaderScreen.style.opacity = "0";

    // Landing page fades in underneath, using animate.css
    landing.classList.add("animate__animated", "animate__fadeIn");

    window.setTimeout(function () {
      loaderScreen.style.display = "none";
    }, FADE_DURATION);
  }, HOLD_DURATION);

  // Hover hotspots — text follows the cursor and stays hidden until
  // the cursor is over the shape
  var hotspots = document.querySelectorAll(".hotspot");
  var hoverLabel = document.getElementById("hoverLabel");
  var hoverTitle = document.getElementById("hoverTitle");
  var hoverDesc = document.getElementById("hoverDesc");
  var LABEL_OFFSET_X = 28;
  var LABEL_OFFSET_Y = 14;
  var activeHotspot = null;

  function moveLabel(x, y) {
    hoverLabel.style.transform =
      "translate(" + (x + LABEL_OFFSET_X) + "px, " + (y - LABEL_OFFSET_Y) + "px)";
  }

  // Custom filled-circle cursor, follows the mouse
  window.addEventListener("mousemove", function (e) {
    if (cursor && window.matchMedia("(hover: hover)").matches) {
      cursor.style.transform =
        "translate(" + e.clientX + "px, " + e.clientY + "px) translate(-50%, -50%)";
    }
    if (activeHotspot) {
      moveLabel(e.clientX, e.clientY);
    }
  });

  hotspots.forEach(function (spot) {
    spot.addEventListener("mouseenter", function (e) {
      activeHotspot = spot;
      hoverTitle.textContent = spot.getAttribute("data-title");
      hoverDesc.textContent = spot.getAttribute("data-desc");
      moveLabel(e.clientX, e.clientY);
      hoverLabel.classList.add("active");
    });
    spot.addEventListener("mouseleave", function () {
      activeHotspot = null;
      hoverLabel.classList.remove("active");
    });
    // Hotspots that name a target page navigate there on click
    var href = spot.getAttribute("data-href");
    if (href) {
      spot.style.cursor = "pointer";
      spot.addEventListener("click", function () {
        window.location.href = href;
      });
    }
  });
})();
