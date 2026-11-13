/* Nexora AI shared frontend helpers — ES5-friendly, offline friendly. */
(function () {
  "use strict";

  var NX = window.NX = window.NX || {};

  /* Polyfills for older mobile browsers (basic phones, KaiOS, older Android WebViews). */
  if (!Object.assign) {
    Object.assign = function (target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];
        if (!source) continue;
        for (var key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
        }
      }
      return target;
    };
  }
  if (!Element.prototype.matches) {
    Element.prototype.matches = Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector;
  }
  if (!Element.prototype.closest) {
    Element.prototype.closest = function (selector) {
      var node = this;
      while (node && node.nodeType === 1) {
        if (node.matches && node.matches(selector)) return node;
        node = node.parentElement || node.parentNode;
      }
      return null;
    };
  }

  NX.$ = function (selector, root) { return (root || document).querySelector(selector); };
  NX.$$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };


  /* Inline SVG icon set (Lucide-style paths, stroke = currentColor).
     Rendered identically on every Windows browser - no emoji fonts needed. */
  var ICON_PATHS = {
    "x": '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    "plus": '<path d="M5 12h14"/><path d="M12 5v14"/>',
    "search": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    "trash": '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    "shield": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    "settings": '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    "power": '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
    "menu": '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
    "download": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    "arrow-up-right": '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    "stop": '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    "paperclip": '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    "globe": '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    "image": '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    "lightbulb": '<path d="M15 14c.2-1 .7-1.7 1.5-2.5A5.94 5.94 0 0 0 18 7.5 6 6 0 0 0 6 7.5c0 1.6.5 2.9 1.5 4 .8.8 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    "file-text": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    "table": '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
    "clock": '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    "message": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    "user": '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    "sparkles": '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
    "star": '<path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8-6.1-3.4-6.1 3.4 1.4-6.8L2.2 9.1l6.9-.8z"/>',
    "megaphone": '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    "archive": '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    "pin": '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/>',
    "dots": '<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>',
    "calendar": '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    "bar-chart": '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    "link": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'
  };
  NX.icon = function (name) {
    var paths = ICON_PATHS[name];
    if (!paths) return "";
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + paths + "</svg>";
  };
  function injectIcons() {
    var nodes = document.querySelectorAll("[data-icon]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].innerHTML = NX.icon(nodes[i].getAttribute("data-icon"));
      nodes[i].removeAttribute("data-icon");
    }
  }
  NX.injectIcons = injectIcons;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectIcons);
  } else {
    injectIcons();
  }

    NX.esc = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  };

  NX.fixText = function (value) {
    var text = String(value == null ? "" : value);
    var pairs = [
      ["â€™", "’"], ["â€˜", "‘"], ["â€œ", "“"], ["â€\u009d", "”"],
      ["â€“", "–"], ["â€”", "—"], ["â€¦", "…"], ["â€¢", "•"],
      ["Â ", " "], ["Â", ""], ["â€", '"']
    ];
    for (var i = 0; i < pairs.length; i++) text = text.split(pairs[i][0]).join(pairs[i][1]);
    return text;
  };

  NX.initials = function (name) {
    var text = String(name || "?").trim();
    if (!text) return "?";
    var bits = text.split(/[\s_.-]+/).filter(Boolean);
    if (bits.length > 1) return (bits[0].charAt(0) + bits[1].charAt(0)).toUpperCase();
    return text.substring(0, 2).toUpperCase();
  };

  NX.avatar = function (el, name, url) {
    if (!el) return;
    if (url) {
      el.innerHTML = '<img src="' + NX.esc(url) + '" alt="" loading="lazy">';
    } else {
      el.textContent = NX.initials(name);
    }
  };

  NX.formatDate = function (iso) {
    if (!iso) return "";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    try {
      return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (e) {
      return date.toDateString();
    }
  };

  NX.formatTime = function (iso) {
    if (!iso) return "";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    try {
      return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return date.toTimeString().substring(0, 5);
    }
  };

  NX.formatDateTime = function (iso) {
    var datePart = NX.formatDate(iso);
    var timePart = NX.formatTime(iso);
    return (datePart + " " + timePart).trim();
  };

  NX.dayGroup = function (iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "Older";
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var then = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var diff = Math.round((today - then) / 86400000);
    if (diff <= 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7) return "Previous 7 days";
    if (diff < 30) return "Previous 30 days";
    return "Older";
  };

  NX.toast = function (message, type) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.className = "toast" + (type === "error" ? " error" : "");
    el.classList.remove("hidden");
    clearTimeout(NX._toastTimer);
    NX._toastTimer = setTimeout(function () { el.classList.add("hidden"); }, 2800);
  };

  NX.openModal = function (id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove("hidden");
  };

  NX.closeModal = function (id) {
    var el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  };

  /* ---------------- confirmation ---------------- */
  var confirmResolve = null;
  NX.confirm = function (title, text, okLabel) {
    var titleEl = document.getElementById("confirm-title");
    var textEl = document.getElementById("confirm-text");
    var okEl = document.getElementById("confirm-ok");
    if (!titleEl || !textEl || !okEl) return Promise.resolve(window.confirm(text || title || "Continue?"));
    titleEl.textContent = title || "Are you sure?";
    textEl.textContent = text || "";
    okEl.textContent = okLabel || "Delete";
    NX.openModal("confirm-modal");
    return new Promise(function (resolve) { confirmResolve = resolve; });
  };

  function finishConfirm(value) {
    NX.closeModal("confirm-modal");
    if (confirmResolve) {
      var resolve = confirmResolve;
      confirmResolve = null;
      resolve(value);
    }
  }

  /* ---------------- guidelines ---------------- */
  NX.GUIDELINES_KEY = "nexora_guidelines_version";

  NX.openGuidelines = function () { NX.openModal("guidelines-modal"); };

  NX.maybeShowGuidelines = function (version) {
    if (!version) return;
    var accepted = null;
    try { accepted = window.localStorage.getItem(NX.GUIDELINES_KEY); } catch (e) { accepted = null; }
    if (accepted !== String(version)) {
      setTimeout(NX.openGuidelines, 450);
    }
  };

  /* ---------------- copy ---------------- */
  NX.copyText = function (text) {
    text = String(text == null ? "" : text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  };

  function legacyCopy(text) {
    try {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "readonly");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      area.style.top = "0";
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, area.value.length);
      var ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- markdown (safe, compact) ---------------- */
  function inline(text) {
    var codes = [];
    text = text.replace(/`([^`\n]+)`/g, function (_, code) {
      codes.push(code);
      return "\u0001" + (codes.length - 1) + "\u0001";
    });
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    text = text.replace(/\u0001(\d+)\u0001/g, function (_, index) {
      return "<code>" + codes[Number(index)] + "</code>";
    });
    return text;
  }

  function renderTextBlocks(raw) {
    var text = NX.esc(raw);
    var lines = text.split("\n");
    var html = [];
    var paragraph = [];
    var listType = null;

    function flushParagraph() {
      if (paragraph.length) {
        html.push("<p>" + inline(paragraph.join("\n")).replace(/\n/g, "<br>") + "</p>");
        paragraph = [];
      }
    }
    function closeList() {
      if (listType) {
        html.push("</" + listType + ">");
        listType = null;
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.replace(/^\s+|\s+$/g, "");
      if (!trimmed) { flushParagraph(); closeList(); continue; }

      var heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        flushParagraph(); closeList();
        var level = heading[1].length + 1;
        html.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">");
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushParagraph(); closeList(); html.push("<hr>"); continue;
      }
      if (trimmed.charAt(0) === ">") {
        flushParagraph(); closeList();
        html.push("<blockquote>" + inline(trimmed.replace(/^>\s?/, "")) + "</blockquote>");
        continue;
      }
      var unordered = trimmed.match(/^[-*+]\s+(.*)$/);
      if (unordered) {
        flushParagraph();
        if (listType !== "ul") { closeList(); html.push("<ul>"); listType = "ul"; }
        html.push("<li>" + inline(unordered[1]) + "</li>");
        continue;
      }
      var ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
      if (ordered) {
        flushParagraph();
        if (listType !== "ol") { closeList(); html.push("<ol>"); listType = "ol"; }
        html.push("<li>" + inline(ordered[1]) + "</li>");
        continue;
      }
      closeList();
      paragraph.push(line);
    }
    flushParagraph();
    closeList();
    return html.join("");
  }

  NX.markdown = function (value) {
    var text = NX.fixText(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var pattern = /```([\w+-]*)[ \t]*\n?([\s\S]*?)```/g;
    var parts = [];
    var lastIndex = 0;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: "text", value: text.substring(lastIndex, match.index) });
      }
      parts.push({ type: "code", value: match[2].replace(/\n$/, "") });
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex < text.length) parts.push({ type: "text", value: text.substring(lastIndex) });
    if (!parts.length) parts.push({ type: "text", value: text });

    return parts.map(function (part) {
      if (part.type === "code") {
        return '<div class="code-wrap"><button type="button" class="code-copy">Copy</button>' +
          "<pre><code>" + NX.esc(part.value) + "</code></pre></div>";
      }
      return renderTextBlocks(part.value);
    }).join("");
  };

  /* ---------------- API ---------------- */
  NX.api = function (url, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      var headers = options.headers || {};
      var body = options.body;

      if (window.fetch) {
        var init = {
          method: options.method || "GET",
          headers: headers,
          credentials: "same-origin"
        };
        if (body !== undefined && body !== null) {
          if (typeof body === "string" || (window.FormData && body instanceof FormData)) {
            init.body = body;
          } else {
            init.headers = Object.assign({ "Content-Type": "application/json" }, headers);
            init.body = JSON.stringify(body);
          }
        }
        window.fetch(url, init).then(function (response) {
          return response.text().then(function (raw) {
            var data = {};
            if (raw) { try { data = JSON.parse(raw); } catch (e) { data = {}; } }
            if (!response.ok) {
              var err = new Error(data.error || ("Request failed (" + response.status + ")"));
              err.status = response.status;
              reject(err);
              return;
            }
            resolve(data);
          });
        }).catch(function (err) {
          if (!err.status) err = new Error("Network error. Check your connection and try again.");
          reject(err);
        });
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open(options.method || "GET", url, true);
        xhr.withCredentials = true;
        var isForm = window.FormData && body instanceof FormData;
        if (body && !isForm) {
          xhr.setRequestHeader("Content-Type", "application/json");
          body = JSON.stringify(body);
        }
        Object.keys(headers).forEach(function (key) { xhr.setRequestHeader(key, headers[key]); });
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          var data = {};
          try { data = JSON.parse(xhr.responseText || "{}"); } catch (e) { data = {}; }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            var error = new Error(data.error || ("Request failed (" + xhr.status + ")"));
            error.status = xhr.status;
            reject(error);
          }
        };
        xhr.onerror = function () { reject(new Error("Network error. Check your connection.")); };
        xhr.send(body || null);
      }
    });
  };

  /* ---------------- chat streaming with old-browser fallback ---------------- */
  NX.canStream = function () {
    return !!(window.fetch && window.ReadableStream && window.TextDecoder && window.AbortController);
  };

  NX.streamChat = function (payload, handlers) {
    handlers = handlers || {};
    var url = handlers.url || "/api/chat";
    var supportsStream = NX.canStream();

    if (!supportsStream) {
      payload = Object.assign({}, payload, { stream: false });
      var xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var data = {};
        try { data = JSON.parse(xhr.responseText || "{}"); } catch (e) { data = {}; }
        if (xhr.status === 401 && handlers.onAuthError) return handlers.onAuthError();
        if (xhr.status < 200 || xhr.status >= 300) {
          var error = new Error(data.error || ("Request failed (" + xhr.status + ")"));
          error.status = xhr.status;
          error.credits = data.credits;
          return handlers.onError(error);
        }
        if (data.reasoning) handlers.onReasoning && handlers.onReasoning(data.reasoning);
        if (data.sources) handlers.onSources && handlers.onSources(data.sources);
        if (data.artifacts) handlers.onArtifacts && handlers.onArtifacts(data.artifacts);
        if (data.credits) handlers.onCredits && handlers.onCredits(data.credits);
        if (data.answer) handlers.onToken && handlers.onToken(data.answer);
        handlers.onDone && handlers.onDone(data.meta || null);
      };
      xhr.onerror = function () { handlers.onError(new Error("Network error. Check your connection.")); };
      xhr.send(JSON.stringify(payload));
      return { abort: function () { xhr.abort(); } };
    }

    var controller = new AbortController();
    window.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
      signal: controller.signal
    }).then(function (response) {
      if (response.status === 401) {
        if (handlers.onAuthError) handlers.onAuthError();
        return null;
      }
      if (!response.ok) {
        return response.text().then(function (raw) {
          var data = {};
          try { data = JSON.parse(raw); } catch (e) {}
          var error = new Error(data.error || ("Request failed (" + response.status + ")"));
          error.status = response.status;
          error.credits = data.credits;
          throw error;
        });
      }
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            handlers.onDone && handlers.onDone();
            return;
          }
          buffer += decoder.decode(result.value, { stream: true });
          var events = buffer.split("\n\n");
          buffer = events.pop();
          for (var i = 0; i < events.length; i++) {
            var lines = events[i].split("\n");
            for (var j = 0; j < lines.length; j++) {
              var line = lines[j];
              if (line.indexOf("data:") !== 0) continue;
              var raw = line.substring(5).replace(/^\s+|\s+$/g, "");
              if (!raw || raw === "[DONE]") continue;
              var event;
              try { event = JSON.parse(raw); } catch (e) { continue; }
              if (event.error) throw new Error(event.error);
              if (event.status && handlers.onStatus) handlers.onStatus(event.status);
              if (event.reasoning && handlers.onReasoning) handlers.onReasoning(event.reasoning);
              if (event.token && handlers.onToken) handlers.onToken(event.token);
              if (event.sources && handlers.onSources) handlers.onSources(event.sources);
              if (event.artifact && handlers.onArtifact) handlers.onArtifact(event.artifact);
              if (event.artifacts && handlers.onArtifacts) handlers.onArtifacts(event.artifacts);
              if (event.credits && handlers.onCredits) handlers.onCredits(event.credits);
              if (event.done && handlers.onMeta) handlers.onMeta(event.meta || null);
            }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (error) {
      if (error && (error.name === "AbortError" || controller.signal.aborted)) {
        if (handlers.onAbort) handlers.onAbort();
      } else if (handlers.onError) {
        handlers.onError(error);
      }
    });

    return { abort: function () { controller.abort(); } };
  };

  /* ---------------- textarea ---------------- */
  NX.autoGrow = function (el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  };

  /* ---------------- service worker ---------------- */
  NX.registerServiceWorker = function () {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () {});
    });
  };

  /* ---------------- shared bindings ---------------- */
  function bindCommon() {
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.closest) return;

      if (target.closest("[data-close-modal]")) {
        var id = target.closest("[data-close-modal]").getAttribute("data-close-modal");
        NX.closeModal(id);
      }
      if (target.closest("[data-open-guidelines]")) {
        event.preventDefault();
        NX.openGuidelines();
      }
      if (target.closest(".code-copy")) {
        var button = target.closest(".code-copy");
        var code = button.parentNode.querySelector("code");
        if (code) {
          NX.copyText(code.textContent).then(function (ok) {
            button.textContent = ok ? "Copied" : "Copy";
            setTimeout(function () { button.textContent = "Copy"; }, 1600);
          });
        }
      }
    });

    var accept = document.getElementById("guidelines-accept");
    if (accept) {
      accept.addEventListener("click", function () {
        try { window.localStorage.setItem(NX.GUIDELINES_KEY, String((window.NEXORA && window.NEXORA.guidelinesVersion) || "1")); } catch (e) {}
        NX.closeModal("guidelines-modal");
      });
    }

    var cancel = document.getElementById("confirm-cancel");
    var ok = document.getElementById("confirm-ok");
    if (cancel) cancel.addEventListener("click", function () { finishConfirm(false); });
    if (ok) ok.addEventListener("click", function () { finishConfirm(true); });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      var modals = NX.$$(".modal:not(.hidden)");
      if (modals.length) {
        var top = modals[modals.length - 1];
        if (top.id === "confirm-modal") finishConfirm(false);
        else top.classList.add("hidden");
      }
    });

    NX.registerServiceWorker();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindCommon);
  } else {
    bindCommon();
  }
})();
