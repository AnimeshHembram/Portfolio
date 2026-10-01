/* =====================================================================
   AB2 — HTML snapshot → <canvas>
   Used only by ab2.html.

   Rasterises a live DOM element into a 2D canvas using the SVG
   <foreignObject> technique (the same general approach as the WICG
   "html-in-canvas" proposal's polyfills): clone the element, embed it in an
   SVG, load that SVG as an image, and draw the image into a canvas.

   Written from scratch for AB2. Two choices differ from typical examples so
   it works on this static site (including opened straight from disk):
     - Instead of copying the page's stylesheets into the SVG (which fails
       for file:// pages, where stylesheets can't be read), every cloned node
       gets its *computed* style inlined. The SVG therefore matches whatever
       responsive state the page is in right now.
     - Web fonts can't be fetched from inside an SVG image, so the Google
       Fonts CSS is fetched once, trimmed to the Latin subset (all this page
       uses), and each font file is embedded as a data: URI.
   ===================================================================== */
(function () {
  "use strict";

  var AB2 = (window.AB2 = window.AB2 || {});

  // Properties that affect how this page's content looks. A whitelist keeps
  // the SVG small (a full computed style is ~350 properties per node).
  var PROPS = [
    "display", "position", "top", "right", "bottom", "left", "z-index",
    "box-sizing", "width", "height", "min-width", "min-height", "max-width", "max-height",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
    "align-items", "align-self", "align-content", "justify-content", "justify-self", "justify-items",
    "grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-area",
    "row-gap", "column-gap", "order",
    "font-family", "font-size", "font-weight", "font-style", "font-stretch",
    "line-height", "letter-spacing", "word-spacing", "text-align", "text-transform",
    "text-indent", "text-wrap", "text-wrap-mode", "text-wrap-style", "white-space", "word-break", "overflow-wrap",
    "vertical-align", "color", "background-color", "opacity",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-top-left-radius", "border-top-right-radius",
    "border-bottom-right-radius", "border-bottom-left-radius",
    "overflow-x", "overflow-y", "transform", "transform-origin",
    "clip", "visibility", "-webkit-font-smoothing"
  ];

  var fontCssPromise = null;

  function blobToDataUri(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // Keep only the "latin" @font-face blocks Google Fonts returns.
  function latinOnly(css) {
    var out = [];
    var re = /\/\*\s*([a-z-]+)\s*\*\/\s*(@font-face\s*{[^}]*})/g;
    var m;
    while ((m = re.exec(css))) {
      if (m[1] === "latin") out.push(m[2]);
    }
    // Some responses have no subset comments; keep everything then.
    return out.length ? out.join("\n") : css;
  }

  function embedFontCss() {
    if (fontCssPromise) return fontCssPromise;
    var links = Array.prototype.slice.call(
      document.querySelectorAll('link[rel="stylesheet"][href*="fonts.googleapis.com"]')
    );
    fontCssPromise = Promise.all(links.map(function (link) {
      return fetch(link.href)
        .then(function (r) { return r.ok ? r.text() : ""; })
        .then(function (css) {
          css = latinOnly(css);
          var urls = [];
          css.replace(/url\((https:\/\/[^)"']+)\)/g, function (_, u) {
            if (urls.indexOf(u) < 0) urls.push(u);
          });
          return Promise.all(urls.map(function (u) {
            return fetch(u)
              .then(function (r) { return r.blob(); })
              .then(blobToDataUri)
              .then(function (d) { return [u, d]; })
              .catch(function () { return [u, null]; });
          })).then(function (pairs) {
            pairs.forEach(function (p) {
              if (p[1]) css = css.split(p[0]).join(p[1]);
            });
            return css;
          });
        })
        .catch(function () { return ""; });
    })).then(function (parts) { return parts.join("\n"); });
    return fontCssPromise;
  }

  function escapeAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  // Deep clone with computed styles inlined.
  function cloneWithStyles(node) {
    if (node.nodeType === 3) return document.createTextNode(node.nodeValue);
    if (node.nodeType !== 1) return null;
    var tag = node.tagName.toLowerCase();
    if (tag === "script" || tag === "style") return null;

    var cs = getComputedStyle(node);
    var clone = document.createElement(tag);
    var decl = "";
    for (var i = 0; i < PROPS.length; i++) {
      var v = cs.getPropertyValue(PROPS[i]);
      if (v) decl += PROPS[i] + ":" + v + ";";
    }
    // Snapshot must be static.
    decl += "animation:none;transition:none;";
    clone.setAttribute("style", decl);

    for (var c = node.firstChild; c; c = c.nextSibling) {
      var cc = cloneWithStyles(c);
      if (cc) clone.appendChild(cc);
    }
    return clone;
  }

  /**
   * @param {HTMLElement} element  the DOM to rasterise
   * @param {object} opts          { pixelRatio, maxSize }
   */
  function HtmlSnapshot(element, opts) {
    opts = opts || {};
    this.element = element;
    this.pixelRatio = opts.pixelRatio || 1;
    this.maxSize = opts.maxSize || 4096;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.width = 1;
    this.height = 1;
    this._busy = null;
    this._again = false;
  }

  HtmlSnapshot.prototype.setSize = function (width, height) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
  };

  HtmlSnapshot.prototype._buildSvg = function (fontCss) {
    var w = this.width, h = this.height;
    var clone = cloneWithStyles(this.element);
    // Root is parked offscreen in the live page; pin it to the SVG origin.
    clone.style.position = "relative";
    clone.style.left = "0px";
    clone.style.top = "0px";
    clone.style.margin = "0px";
    clone.style.width = w + "px";
    clone.style.height = h + "px";
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");

    var html = new XMLSerializer().serializeToString(clone);
    var style = fontCss
      ? '<style xmlns="http://www.w3.org/1999/xhtml">/*<![CDATA[*/' + fontCss + "/*]]>*/</style>"
      : "";
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<foreignObject x="0" y="0" width="100%" height="100%">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="' +
      escapeAttr("width:" + w + "px;height:" + h + "px;margin:0;padding:0;") + '">' +
      style + html +
      "</div></foreignObject></svg>"
    );
  };

  HtmlSnapshot.prototype._renderOnce = function () {
    var self = this;
    return embedFontCss().then(function (fontCss) {
      var pr = self.pixelRatio;
      var cw = Math.round(self.width * pr);
      var ch = Math.round(self.height * pr);
      var scale = Math.min(1, self.maxSize / Math.max(cw, ch));
      cw = Math.floor(cw * scale);
      ch = Math.floor(ch * scale);
      if (self.canvas.width !== cw || self.canvas.height !== ch) {
        self.canvas.width = cw;
        self.canvas.height = ch;
      }
      var svg = self._buildSvg(fontCss);
      var img = new Image();
      img.decoding = "async";
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      return img.decode().then(function () {
        var ctx = self.ctx;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        // Some browsers "taint" canvases that drew a foreignObject SVG, which
        // would make WebGL refuse the texture. Detect it here so the page can
        // fall back to the flat layout instead of failing silently.
        // Checked once; repeated readbacks would slow the canvas down.
        if (!self._taintChecked) {
          ctx.getImageData(0, 0, 1, 1);
          self._taintChecked = true;
        }
      });
    });
  };

  /** Re-rasterise. Calls made while busy are coalesced into one more pass. */
  HtmlSnapshot.prototype.update = function () {
    var self = this;
    if (this._busy) { this._again = true; return this._busy; }
    var run = function () {
      self._again = false;
      return self._renderOnce().then(function () {
        if (self._again) return run();
      });
    };
    this._busy = run().then(
      function () { self._busy = null; },
      function (e) { self._busy = null; throw e; }
    );
    return this._busy;
  };

  AB2.HtmlSnapshot = HtmlSnapshot;
})();
