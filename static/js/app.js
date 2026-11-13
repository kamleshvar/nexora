/* Nexora AI — user workspace. */
(function () {
  "use strict";

  var SETTINGS_KEY = "nexora_settings";
  var CACHE_PREFIX = "nexora_cache_v2";
  var state = {
    user: null,
    models: {},
    defaultModel: "",
    conversations: [],
    currentId: null,
    currentTitle: "",
    messagesData: [],
    busy: false,
    stream: null,
    attachments: [],
    webSearch: false,
    imageMode: false,
    ads: [],
    adsLoaded: false,
    credits: null,
    settings: { model: "", temperature: 0.7, max_tokens: 4096 }
  };

  var el = {};

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(init);

  function init() {
    var boot = window.NEXORA || {};
    state.user = boot.user || {};
    state.models = boot.models || {};
    state.defaultModel = boot.defaultModel || "";
    loadSettings();

    el.sidebar = document.getElementById("sidebar");
    el.scrim = document.getElementById("sidebar-scrim");
    el.messages = document.getElementById("messages");
    el.welcome = document.getElementById("welcome");
    el.chat = document.getElementById("chat");
    el.list = document.getElementById("conversation-list");
    el.search = document.getElementById("conversation-search");
    el.input = document.getElementById("message-input");
    el.form = document.getElementById("chat-form");
    el.send = document.getElementById("send-btn");
    el.stop = document.getElementById("stop-btn");
    el.scrollBottom = document.getElementById("scroll-bottom");
    el.modelLabel = document.getElementById("model-label");
    el.modelSelect = document.getElementById("model-select");
    el.temp = document.getElementById("temperature");
    el.tempValue = document.getElementById("temp-value");
    el.maxTokens = document.getElementById("max-tokens");
    el.trashList = document.getElementById("trash-list");
    el.sidebarName = document.getElementById("sidebar-name");
    el.tray = document.getElementById("attachment-tray");
    el.fileInput = document.getElementById("file-input");
    el.attachBtn = document.getElementById("attach-btn");
    el.webToggle = document.getElementById("web-toggle");
    el.imageToggle = document.getElementById("image-toggle");
    el.aspect = document.getElementById("aspect-ratio");
    el.ads = document.getElementById("chat-ads");
    el.status = document.getElementById("composer-status");

    bind();
    applyUserUI();
    applySettingsUI();
    renderAttachmentTray();
    loadAds();
    NX.maybeShowGuidelines(boot.guidelinesVersion);

    var cached = readCache();
    if (cached.conversations && cached.conversations.length) {
      state.conversations = cached.conversations;
      renderConversations();
    }

    Promise.all([
      loadConversations().catch(function (error) {
        if (error && error.status === 401) throw error;
        return state.conversations;
      }),
      NX.api("/api/me").catch(function () { return null; })
    ]).then(function (results) {
      var cloud = results[1];
      if (cloud) applyCloudState(cloud);
      var last = readCache().lastId || (cloud && cloud.last_conversation_id) || null;
      var exists = last && state.conversations.some(function (item) { return item.id === last; });
      if (exists) openConversation(last);
      else if (state.conversations.length) openConversation(state.conversations[0].id);
      else showWelcome();
    }).catch(fail);
  }

  /* ---------------- offline / refresh cache ---------------- */
  function cacheKey() {
    return CACHE_PREFIX + ":" + ((state.user && state.user.username) || "guest");
  }

  function readCache() {
    try {
      return JSON.parse(window.localStorage.getItem(cacheKey()) || "null") || {};
    } catch (e) {
      return {};
    }
  }

  function writeCache(patch) {
    try {
      var cache = readCache();
      Object.keys(patch).forEach(function (key) { cache[key] = patch[key]; });
      window.localStorage.setItem(cacheKey(), JSON.stringify(cache));
    } catch (e) {}
  }

  function cacheConversations(list) {
    writeCache({ conversations: list || [], at: Date.now() });
  }

  function cacheMessages(id, data) {
    var messages = readCache().messages || {};
    messages[id] = { title: data.title || "", messages: data.messages || [], at: Date.now() };
    writeCache({ messages: messages, lastId: id });
  }

  function cachedMessages(id) {
    var entry = (readCache().messages || {})[id];
    return entry || null;
  }

  function rememberLast(id) {
    writeCache({ lastId: id });
    if (id) NX.api("/api/sync/last", { method: "POST", body: { conversation_id: id } }).catch(function () {});
  }

  /* ---------------- settings ---------------- */
  function loadSettings() {
    var stored = null;
    try { stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "null"); } catch (e) { stored = null; }
    if (stored && typeof stored === "object") {
      state.settings.model = state.models[stored.model] ? stored.model : state.defaultModel;
      state.settings.temperature = clamp(Number(stored.temperature), 0, 1, 0.7);
      state.settings.max_tokens = clamp(Number(stored.max_tokens), 64, 8192, 4096);
    } else {
      state.settings.model = state.defaultModel;
    }
  }

  function clamp(value, min, max, fallback) {
    if (isNaN(value)) return fallback;
    return Math.max(min, Math.min(max, value));
  }

  function applySettingsUI() {
    if (el.modelSelect) el.modelSelect.value = state.settings.model;
    if (el.temp) el.temp.value = state.settings.temperature;
    if (el.tempValue) el.tempValue.textContent = String(state.settings.temperature);
    if (el.maxTokens) el.maxTokens.value = String(state.settings.max_tokens);
    updateModelLabel();
  }

  function updateModelLabel() {
    if (el.modelLabel) {
      el.modelLabel.textContent = state.models[state.settings.model] || state.settings.model || "Nexora AI";
    }
    if (el.modelSelect) el.modelSelect.value = state.settings.model;
  }

  function savePreferences() {
    state.settings.model = el.modelSelect ? el.modelSelect.value : state.settings.model;
    state.settings.temperature = el.temp ? Number(el.temp.value) : state.settings.temperature;
    state.settings.max_tokens = el.maxTokens ? Number(el.maxTokens.value) : state.settings.max_tokens;
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) {}
    updateModelLabel();
    NX.api("/api/sync/preferences", { method: "POST", body: state.settings }).then(function () {
      NX.toast("Preferences saved to your account.");
    }).catch(function () {
      NX.toast("Preferences saved on this device. Cloud sync will retry.", "error");
    });
  }

  function requestGodMode() {
    var btn = document.getElementById("god-request-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Requesting…"; }
    NX.confirm(
      "Request God Mode?",
      "God mode unlocks Nemotron 3 Ultra with 500k tokens per 12 hours, higher output limits, and priority access. An administrator will review your request.",
      "Request"
    ).then(function (ok) {
      if (!ok) { if (btn) { btn.disabled = false; btn.textContent = "Request God Mode"; } return; }
      var message = window.prompt("Optional: Tell the admin why you need God mode (e.g. building a website, complex project):", "") || "";
      NX.api("/api/user/god-request", { method: "POST", body: { message: message } })
        .then(function () {
          state.user.god_request_status = { status: "pending" };
          renderPlan();
          NX.toast("God mode request submitted. An admin will review it shortly.");
        })
        .catch(function (error) {
          if (btn) { btn.disabled = false; btn.textContent = "Request God Mode"; }
          fail(error);
        });
    });
  }

  function applyCloudState(data) {
    if (!data) return;
    if (data.user) state.user = data.user;
    if (data.god_request_status) {
      state.user.god_request_status = data.god_request_status;
    }
    if (data.credits) state.credits = data.credits;
    if (data.preferences && typeof data.preferences === "object") {
      if (state.models[data.preferences.model]) state.settings.model = data.preferences.model;
      if (typeof data.preferences.temperature === "number") state.settings.temperature = data.preferences.temperature;
      if (typeof data.preferences.max_tokens === "number") state.settings.max_tokens = data.preferences.max_tokens;
      try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) {}
    }
    applyUserUI();
    applySettingsUI();
    renderCredits();
    if (data.ads_enabled === false) {
      state.ads = [];
      if (el.ads) el.ads.classList.add("hidden");
    }
  }

  function formatTokens(value) {
    var number = Number(value) || 0;
    if (number >= 1000000) return (number / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (number >= 1000) return (number / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(number);
  }

  function renderCredits() {
    var credits = state.credits;
    var chip = document.getElementById("credit-chip");
    var summary = document.getElementById("credit-summary");
    var bar = document.getElementById("credit-bar");
    var note = document.getElementById("credit-note");
    if (!credits) {
      if (chip) chip.classList.add("hidden");
      return;
    }
    var remaining = Math.max(0, Number(credits.remaining) || 0);
    var limit = Math.max(1, Number(credits.limit) || 1);
    var percent = Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)));
    if (chip) {
      chip.classList.remove("hidden");
      chip.textContent = formatTokens(remaining) + " credits";
      chip.title = formatTokens(remaining) + " of " + formatTokens(limit) +
        " tokens left in your rolling " + (credits.window_hours || 6) + "-hour window";
      chip.classList.toggle("low", percent <= 10);
    }
    if (summary) summary.textContent = formatTokens(remaining) + " / " + formatTokens(limit) + " tokens left";
    if (bar) {
      bar.style.width = percent + "%";
      bar.classList.toggle("low", percent <= 10);
    }
    if (note) note.textContent = "Rolling " + (credits.window_hours || 6) + "-hour window · refills automatically.";
  }

  function refreshCredits() {
    NX.api("/api/credits").then(function (credits) {
      if (credits) {
        state.credits = credits;
        renderCredits();
      }
    }).catch(function () {});
  }

  /* ---------------- user / profile ---------------- */
  function applyUserUI() {
    var name = state.user.display_name || state.user.username || "You";
    NX.avatar(document.getElementById("sidebar-avatar"), name, state.user.avatar);
    NX.avatar(document.getElementById("profile-avatar"), name, state.user.avatar);
    if (el.sidebarName) el.sidebarName.textContent = name;
    var profileName = document.getElementById("profile-name");
    if (profileName) profileName.textContent = name;
    var joined = document.getElementById("profile-joined");
    if (joined) joined.textContent = NX.formatDate(state.user.created_at);
    var displayInput = document.getElementById("profile-display-name");
    if (displayInput) displayInput.value = name;
    var nicknameInput = document.getElementById("profile-nickname");
    if (nicknameInput) nicknameInput.value = state.user.nickname || "";
    renderPlan();
  }

  function renderPlan() {
    var badge = document.getElementById("plan-badge");
    var note = document.getElementById("plan-note");
    var btn = document.getElementById("god-request-btn");
    if (!badge || !note) return;
    var plan = state.user && state.user.plan ? state.user.plan : "standard";
    badge.textContent = plan === "god" ? "God mode" : "Standard";
    badge.className = plan === "god" ? "plan-badge god" : "plan-badge";
    if (plan === "god") {
      note.textContent = "God mode: 500k tokens / 12h · Nemotron 3 Ultra · Max features";
      if (btn) btn.style.display = "none";
      return;
    }
    var request = state.user && state.user.god_request_status ? state.user.god_request_status : null;
    if (request && request.status === "pending") {
      note.textContent = "Standard: 100k tokens / 6h · God mode request pending review.";
      if (btn) {
        btn.style.display = "inline-flex";
        btn.disabled = true;
        btn.textContent = "Requested · pending review";
      }
      return;
    }
    note.textContent = "Standard: 100k tokens / 6h · Nemotron 3.5 models";
    if (btn) {
      btn.style.display = "inline-flex";
      btn.disabled = false;
      btn.textContent = "Request God Mode";
      if (request && request.status === "rejected") {
        note.textContent = "Standard: 100k tokens / 6h · Your earlier God mode request was declined." +
          (request.admin_note ? " Note: " + request.admin_note : "");
      }
    }
  }

  /* ---------------- conversations ---------------- */
  function loadConversations() {
    return NX.api("/api/conversations").then(function (list) {
      state.conversations = list || [];
      cacheConversations(state.conversations);
      renderConversations();
      return state.conversations;
    });
  }

  function renderConversations() {
    if (!el.list) return;
    var query = (el.search && el.search.value || "").toLowerCase().replace(/^\s+|\s+$/g, "");
    var conversations = state.conversations.filter(function (c) {
      return !query || String(c.title || "").toLowerCase().indexOf(query) !== -1;
    });

    el.list.innerHTML = "";
    if (!conversations.length) {
      var empty = document.createElement("div");
      empty.className = "conversation-empty";
      empty.textContent = query ? "No conversations match your search." : "No conversations yet. Start a new one.";
      el.list.appendChild(empty);
      return;
    }

    var currentGroup = "";
    conversations.forEach(function (conversation) {
      var group = NX.dayGroup(conversation.updated_at || conversation.created_at);
      if (group !== currentGroup) {
        var label = document.createElement("div");
        label.className = "conversation-group";
        label.textContent = group;
        el.list.appendChild(label);
        currentGroup = group;
      }

      var item = document.createElement("div");
      item.className = "conversation-item" + (conversation.id === state.currentId ? " active" : "");

      var title = document.createElement("button");
      title.type = "button";
      title.className = "conv-title";
      title.textContent = conversation.title || "Untitled conversation";
      title.title = conversation.title || "";
      title.addEventListener("click", function () { openConversation(conversation.id); });
      title.addEventListener("dblclick", function (event) {
        event.preventDefault();
        startRename(item, title, conversation);
      });

      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "conv-delete";
      remove.setAttribute("aria-label", "Delete conversation");
      remove.title = "Delete conversation";
      remove.innerHTML = NX.icon("x");
      remove.addEventListener("click", function (event) {
        event.stopPropagation();
        deleteConversation(conversation);
      });

      item.appendChild(title);
      item.appendChild(remove);
      el.list.appendChild(item);
    });
  }

  function startRename(item, titleButton, conversation) {
    if (state.busy) return;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "conv-rename";
    input.maxLength = 100;
    input.value = conversation.title || "";
    item.replaceChild(input, titleButton);
    input.focus();
    input.select();
    var done = false;

    function finish(save) {
      if (done) return;
      done = true;
      var value = (input.value || "").replace(/^\s+|\s+$/g, "");
      if (save && value && value !== conversation.title) {
        NX.api("/api/conversations/" + conversation.id, { method: "PATCH", body: { title: value } })
          .then(function () {
            conversation.title = value;
            if (state.currentId === conversation.id) state.currentTitle = value;
            renderConversations();
            NX.toast("Conversation renamed.");
          })
          .catch(fail);
      } else {
        renderConversations();
      }
    }

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      else if (event.key === "Escape") { finish(false); }
    });
    input.addEventListener("blur", function () { finish(true); });
  }

  function openConversation(id) {
    if (state.busy) return;
    clearAttachments();
    setImageMode(false);
    var cached = cachedMessages(id);
    if (cached) {
      state.currentId = id;
      state.currentTitle = cached.title || "";
      state.messagesData = cached.messages || [];
      renderMessages(state.messagesData);
      renderConversations();
    }
    return NX.api("/api/conversations/" + id).then(function (data) {
      state.currentId = id;
      state.currentTitle = data.title || "";
      state.messagesData = data.messages || [];
      cacheMessages(id, data);
      rememberLast(id);
      renderMessages(state.messagesData);
      renderConversations();
      closeSidebar();
    }).catch(function (error) {
      if (cached && (!error || error.status !== 401)) {
        state.currentId = id;
        state.currentTitle = cached.title || "";
        state.messagesData = cached.messages || [];
        renderMessages(state.messagesData);
        renderConversations();
        closeSidebar();
        NX.toast("Showing the saved copy of this chat. Reconnecting…", "error");
        return;
      }
      fail(error);
    });
  }

  function createConversation() {
    return NX.api("/api/conversations", { method: "POST", body: {} }).then(function (conversation) {
      state.currentId = conversation.id;
      state.currentTitle = conversation.title || "New conversation";
      state.messagesData = [];
      return loadConversations().then(function () { return conversation; });
    });
  }

  function newConversation() {
    if (state.busy) return;
    clearAttachments();
    setImageMode(false);
    createConversation().then(function () {
      el.messages.innerHTML = "";
      showWelcome();
      renderConversations();
      closeSidebar();
      if (el.input) el.input.focus();
    }).catch(fail);
  }

  function deleteConversation(conversation) {
    NX.confirm(
      "Delete conversation?",
      '“' + (conversation.title || "Untitled") + '” will move to Recently deleted. You can restore it later; administrators keep an archive.',
      "Delete"
    ).then(function (ok) {
      if (!ok) return;
      NX.api("/api/conversations/" + conversation.id, { method: "DELETE" }).then(function () {
        if (state.currentId === conversation.id) {
          state.currentId = null;
          state.currentTitle = "";
          state.messagesData = [];
          el.messages.innerHTML = "";
          showWelcome();
        }
        var cache = readCache();
        if (cache.lastId === conversation.id) cache.lastId = null;
        writeCache(cache);
        return loadConversations();
      }).then(function () {
        NX.toast("Conversation moved to Recently deleted.");
      }).catch(fail);
    });
  }

  /* ---------------- messages ---------------- */
  function showWelcome() {
    if (el.welcome) el.welcome.classList.remove("hidden");
    if (el.messages) el.messages.innerHTML = "";
    if (el.ads) el.ads.classList.add("hidden");
    if (el.input) el.input.focus();
  }

  function renderMessages(messages) {
    el.messages.innerHTML = "";
    if (!messages || !messages.length) {
      showWelcome();
      return;
    }
    if (el.welcome) el.welcome.classList.add("hidden");

    var lastAssistant = -1;
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].role === "assistant") lastAssistant = i;
    }
    for (var j = 0; j < messages.length; j++) {
      addMessageEl(messages[j].role, messages[j].content, {
        id: messages[j].id,
        created_at: messages[j].created_at,
        meta: messages[j].meta,
        regenerate: messages[j].role === "assistant" && j === lastAssistant
      });
    }
    scrollBottom(true);
    renderAds();
  }

  function addMessageEl(role, content, options) {
    options = options || {};
    var wrap = document.createElement("div");
    wrap.className = "message " + role;
    if (options.id) wrap.setAttribute("data-id", String(options.id));
    wrap._raw = content || "";

    var avatar = document.createElement("span");
    avatar.className = "avatar" + (role === "assistant" ? " assistant-avatar" : " avatar-user");
    if (role === "assistant") {
      avatar.innerHTML = '<img src="/static/img/logo-mark.png" alt="">';
    } else {
      NX.avatar(avatar, state.user.display_name || state.user.username, state.user.avatar);
    }

    var body = document.createElement("div");
    body.className = "msg-body";

    var head = document.createElement("div");
    head.className = "msg-head";
    var name = document.createElement("b");
    name.textContent = role === "assistant" ? "Nexora" : (state.user.display_name || "You");
    var time = document.createElement("span");
    time.textContent = options.created_at ? NX.formatTime(options.created_at) : "now";
    head.appendChild(name);
    head.appendChild(time);

    var bubble = document.createElement("div");
    bubble.className = "bubble";
    if (options.streaming) {
      bubble.innerHTML = '<span class="typing">Thinking…</span>';
    } else if (role === "assistant") {
      bubble.innerHTML = NX.markdown(content);
    } else {
      bubble.innerHTML = NX.esc(content).replace(/\n/g, "<br>");
    }

    var extras = document.createElement("div");
    extras.className = "msg-extras";
    extras._data = options.meta || null;
    if (options.meta) renderExtras(extras, options.meta);

    var actions = document.createElement("div");
    actions.className = "msg-actions";

    actions.appendChild(actionButton("Copy", function () {
      NX.copyText(wrap._raw).then(function (ok) {
        NX.toast(ok ? "Message copied." : "Copy is not available on this device.", ok ? "" : "error");
      });
    }));

    if (role === "user" && options.id) {
      actions.appendChild(actionButton("Edit", function () {
        startEdit(wrap, bubble, body, options.id);
      }));
    }
    if (role === "assistant" && options.regenerate) {
      actions.appendChild(actionButton("Regenerate", function () {
        regenerate(wrap);
      }));
    }

    body.appendChild(head);
    body.appendChild(bubble);
    body.appendChild(extras);
    body.appendChild(actions);
    wrap.appendChild(avatar);
    wrap.appendChild(body);
    el.messages.appendChild(wrap);
    if (el.welcome) el.welcome.classList.add("hidden");
    scrollBottom(false);

    return { el: wrap, bubble: bubble, body: body, extras: extras };
  }

  function formatSize(bytes) {
    var size = Number(bytes) || 0;
    if (size < 1024) return size + " B";
    if (size < 1048576) return Math.round(size / 1024) + " KB";
    return (size / 1048576).toFixed(1) + " MB";
  }

  function renderExtras(container, meta) {
    if (!container) return;
    container.innerHTML = "";
    meta = meta || {};

    var attachments = meta.attachments || [];
    if (attachments.length) {
      var docRow = document.createElement("div");
      docRow.className = "doc-row";
      attachments.forEach(function (file) {
        var chip = document.createElement("span");
        chip.className = "doc-chip";
        chip.innerHTML = NX.icon("file-text") + " " + NX.esc(file.name || "Document");
        docRow.appendChild(chip);
      });
      container.appendChild(docRow);
    }

    var artifacts = meta.artifacts || [];
    artifacts.forEach(function (artifact) {
      var card = document.createElement("a");
      card.className = "artifact-card";
      card.href = artifact.url;
      card.setAttribute("download", artifact.filename || "");
      card.innerHTML =
        '<span class="artifact-icon" aria-hidden="true">' +
        (artifact.kind === "image" ? NX.icon("image") : artifact.kind === "pdf" ? NX.icon("file-text") : artifact.kind === "xlsx" ? NX.icon("table") : NX.icon("file-text")) +
        "</span><span class=\"artifact-text\"><b>" + NX.esc(artifact.filename || "Download file") +
        "</b><small>" + NX.esc(String(artifact.kind || "file").toUpperCase()) + " · " + formatSize(artifact.size) +
        "</small></span><span class=\"artifact-arrow\" aria-hidden=\"true\">" + NX.icon("download") + "</span>";
      container.appendChild(card);
    });

    var sources = meta.sources || [];
    if (sources.length) {
      var details = document.createElement("details");
      details.className = "sources";
      var summary = document.createElement("summary");
      summary.textContent = "Sources · " + sources.length;
      details.appendChild(summary);
      var list = document.createElement("ol");
      sources.forEach(function (source) {
        var item = document.createElement("li");
        var link = document.createElement("a");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.title || source.url;
        item.appendChild(link);
        if (source.snippet) {
          var snippet = document.createElement("small");
          snippet.textContent = source.snippet;
          item.appendChild(snippet);
        }
        list.appendChild(item);
      });
      details.appendChild(list);
      container.appendChild(details);
    }
  }

  function actionButton(label, handler) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "msg-action";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function startEdit(wrap, bubble, body, id) {
    if (state.busy) return;
    var box = document.createElement("div");
    box.className = "edit-box";
    var area = document.createElement("textarea");
    area.value = wrap._raw;
    var actions = document.createElement("div");
    actions.className = "edit-actions";
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-btn";
    cancel.textContent = "Cancel";
    var save = document.createElement("button");
    save.type = "button";
    save.className = "primary-btn";
    save.textContent = "Save & resend";
    actions.appendChild(cancel);
    actions.appendChild(save);
    box.appendChild(area);
    box.appendChild(actions);
    body.replaceChild(box, bubble);
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);

    cancel.addEventListener("click", function () { body.replaceChild(bubble, box); });
    save.addEventListener("click", function () {
      var text = (area.value || "").replace(/^\s+|\s+$/g, "");
      if (!text) return NX.toast("Message cannot be empty.", "error");
      if (text === wrap._raw) { body.replaceChild(bubble, box); return; }
      if (state.busy) return;

      while (wrap.nextSibling) el.messages.removeChild(wrap.nextSibling);
      wrap._raw = text;
      var editedIndex = -1;
      for (var k = 0; k < state.messagesData.length; k++) {
        if (Number(state.messagesData[k].id) === Number(id)) { editedIndex = k; break; }
      }
      state.messagesData = editedIndex >= 0 ? state.messagesData.slice(0, editedIndex + 1) : [];
      bubble.innerHTML = NX.esc(text).replace(/\n/g, "<br>");
      body.replaceChild(bubble, box);

      runChat({ edit_message_id: id, message: text });
    });
  }

  function regenerate(wrap) {
    if (state.busy || !state.currentId) return;
    while (wrap.nextSibling) el.messages.removeChild(wrap.nextSibling);
    el.messages.removeChild(wrap);
    state.messagesData = state.messagesData.filter(function (message) {
      return Number(message.id) !== Number(wrap.getAttribute("data-id"));
    });
    runChat({ regenerate: true });
  }

  function sendMessage(text) {
    if (state.busy) return;
    text = (text || "").replace(/^\s+|\s+$/g, "");
    if (!text) return;

    var fileIds = state.attachments.map(function (file) { return file.id; });
    var fileNames = state.attachments.map(function (file) { return file.name; });
    var payload = {
      message: text,
      file_ids: fileIds,
      web_search: state.webSearch,
      image_mode: state.imageMode,
      aspect_ratio: el.aspect ? el.aspect.value : "1:1"
    };

    var send = function () {
      addMessageEl("user", text, { meta: fileNames.length ? { attachments: fileNames.map(function (name) { return { name: name }; }) } : null });
      if (el.input) {
        el.input.value = "";
        NX.autoGrow(el.input);
      }
      clearAttachments();
      setImageMode(false);
      runChat(payload);
    };

    if (!state.currentId) {
      createConversation().then(send).catch(fail);
    } else {
      send();
    }
  }

  function runChat(payload) {
    if (!state.currentId) return;
    var assistant = addMessageEl("assistant", "", { streaming: true });
    var answer = "";
    var reasoning = "";
    var meta = null;
    state.busy = true;
    updateComposer();
    setStatus("");

    var request = Object.assign({
      conversation_id: state.currentId,
      model: state.settings.model,
      temperature: state.settings.temperature,
      max_tokens: state.settings.max_tokens
    }, payload);

    state.stream = NX.streamChat(request, {
      onStatus: function (text) {
        setStatus(text);
        if (!answer) assistant.bubble.innerHTML = '<span class="typing">' + NX.esc(text) + "</span>";
      },
      onReasoning: function (text) {
        reasoning += text;
        if (!answer) {
          assistant.bubble.innerHTML = '<div class="thinking">' + NX.esc(reasoning) + "</div>";
          scrollBottom(false);
        }
      },
      onToken: function (text) {
        answer += text;
        assistant.bubble.innerHTML = NX.markdown(answer);
        scrollBottom(false);
      },
      onSources: function (sources) {
        meta = meta || {};
        meta.sources = sources;
        renderExtras(assistant.extras, meta);
        scrollBottom(false);
      },
      onArtifact: function (artifact) {
        meta = meta || {};
        meta.artifacts = (meta.artifacts || []).concat([artifact]);
        renderExtras(assistant.extras, meta);
        scrollBottom(false);
      },
      onArtifacts: function (artifacts) {
        meta = meta || {};
        meta.artifacts = artifacts || [];
        renderExtras(assistant.extras, meta);
        scrollBottom(false);
      },
      onMeta: function (finalMeta) {
        if (finalMeta) meta = finalMeta;
        if (meta) renderExtras(assistant.extras, meta);
      },
      onCredits: function (credits) {
        if (credits) {
          state.credits = credits;
          renderCredits();
        }
      },
      onDone: function (finalMeta) {
        if (finalMeta) meta = finalMeta;
        if (meta) renderExtras(assistant.extras, meta);
        finishChat(answer, reasoning, assistant, true);
      },
      onAbort: function () {
        finishChat(answer, reasoning, assistant, true);
      },
      onError: function (error) {
        setStatus("");
        if (error && error.credits) {
          state.credits = error.credits;
          renderCredits();
        }
        if (answer) {
          assistant.bubble.innerHTML = NX.markdown(answer) +
            '<p class="error-text">' + NX.esc(error.message) + "</p>";
        } else {
          assistant.bubble.innerHTML = '<p class="error-text">' + NX.esc(error.message) + "</p>";
        }
        state.busy = false;
        state.stream = null;
        updateComposer();
        NX.toast(error.message, "error");
      },
      onAuthError: function () {
        window.location.href = "/login";
      }
    });
  }

  function finishChat(answer, reasoning, assistant, refresh) {
    state.busy = false;
    state.stream = null;
    setStatus("");
    updateComposer();
    refreshCredits();

    if (!answer && reasoning) {
      assistant.bubble.innerHTML = '<div class="thinking">' + NX.esc(reasoning) + "</div>" +
        '<p class="typing">The model stopped while thinking. Try again with more maximum tokens.</p>';
      return;
    }
    if (!answer && !reasoning) {
      assistant.bubble.innerHTML = '<p class="typing">No response received. Check the selected model and API access.</p>';
      return;
    }
    if (refresh) {
      setTimeout(function () {
        refreshCurrentConversation().then(function () {
          loadConversations().catch(function () {});
        }).catch(function () {});
      }, 350);
    }
  }

  function refreshCurrentConversation() {
    if (!state.currentId) return Promise.resolve();
    var id = state.currentId;
    return NX.api("/api/conversations/" + id).then(function (data) {
      if (state.currentId !== id) return;
      state.currentTitle = data.title || "";
      state.messagesData = data.messages || [];
      cacheMessages(id, data);
      renderMessages(state.messagesData);
    });
  }

  function updateComposer() {
    if (el.send) el.send.disabled = state.busy;
    if (el.stop) el.stop.classList.toggle("hidden", !state.busy);
    if (el.attachBtn) el.attachBtn.disabled = state.busy;
  }

  function setStatus(text) {
    if (el.status) el.status.textContent = text || "";
  }

  /* ---------------- attachments ---------------- */
  function renderAttachmentTray() {
    if (!el.tray) return;
    el.tray.innerHTML = "";
    if (!state.attachments.length) {
      el.tray.classList.add("hidden");
      return;
    }
    el.tray.classList.remove("hidden");
    state.attachments.forEach(function (file) {
      var chip = document.createElement("div");
      chip.className = "attachment-chip" + (file.uploading ? " uploading" : "");
      var label = document.createElement("span");
      label.className = "attachment-name";
      label.innerHTML = '<b aria-hidden="true">' + (file.uploading ? NX.icon("clock") : NX.icon("file-text")) + "</b><span>" +
        NX.esc(file.name) + "</span>" + (file.size ? "<small>" + formatSize(file.size) + "</small>" : "");
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "attachment-remove";
      remove.setAttribute("aria-label", "Remove " + file.name);
      remove.innerHTML = NX.icon("x");
      remove.addEventListener("click", function () {
        if (file.uploading) return;
        if (file.id) NX.api("/api/files/" + file.id, { method: "DELETE" }).catch(function () {});
        state.attachments = state.attachments.filter(function (item) { return item !== file; });
        renderAttachmentTray();
      });
      chip.appendChild(label);
      if (!file.uploading) chip.appendChild(remove);
      el.tray.appendChild(chip);
    });
  }

  function uploadFiles(fileList) {
    if (!fileList || !fileList.length) return;
    var files = Array.prototype.slice.call(fileList, 0, 5);
    var pending = files.map(function (file) {
      return { name: file.name || "Document", size: file.size || 0, uploading: true };
    });
    state.attachments = state.attachments.concat(pending);
    renderAttachmentTray();
    setStatus("Uploading " + files.length + " file" + (files.length > 1 ? "s" : "") + "…");

    var form = new FormData();
    files.forEach(function (file) { form.append("files", file); });
    if (state.currentId) form.append("conversation_id", state.currentId);

    NX.api("/api/files", { method: "POST", body: form }).then(function (data) {
      state.attachments = state.attachments.filter(function (item) { return pending.indexOf(item) === -1; });
      (data.files || []).forEach(function (file) {
        state.attachments.push(file);
        if (file.warning) NX.toast(file.name + ": " + file.warning, "error");
      });
      renderAttachmentTray();
      setStatus("");
    }).catch(function (error) {
      state.attachments = state.attachments.filter(function (item) { return pending.indexOf(item) === -1; });
      renderAttachmentTray();
      setStatus("");
      fail(error);
    });
  }

  function clearAttachments() {
    state.attachments = [];
    renderAttachmentTray();
  }

  /* ---------------- toggles ---------------- */
  function setWebSearch(on) {
    state.webSearch = !!on;
    if (el.webToggle) {
      el.webToggle.classList.toggle("active", state.webSearch);
      el.webToggle.setAttribute("aria-pressed", state.webSearch ? "true" : "false");
    }
  }

  function setImageMode(on) {
    state.imageMode = !!on;
    if (el.imageToggle) {
      el.imageToggle.classList.toggle("active", state.imageMode);
      el.imageToggle.setAttribute("aria-pressed", state.imageMode ? "true" : "false");
    }
    if (el.aspect) el.aspect.classList.toggle("hidden", !state.imageMode);
  }

  /* ---------------- advertisements ---------------- */
  function loadAds() {
    if (state.adsLoaded) { renderAds(); return; }
    NX.api("/api/ads").then(function (ads) {
      state.ads = (ads || []).filter(function (ad) { return ad && ad.url; });
      state.adsLoaded = true;
      renderAds();
    }).catch(function () { state.adsLoaded = true; });
  }

  function renderAds() {
    if (!el.ads) return;
    if (!state.ads.length) {
      el.ads.classList.add("hidden");
      return;
    }
    el.ads.classList.remove("hidden");
    el.ads.innerHTML = "";
    var head = document.createElement("div");
    head.className = "ads-head";
    head.innerHTML = "<span><b>TechOrigin</b> apps</span><small>Made with care · worth a look</small>";
    el.ads.appendChild(head);

    var grid = document.createElement("div");
    grid.className = "ads-grid";
    var ordered = state.ads.slice();
    for (var i = ordered.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var swap = ordered[i];
      ordered[i] = ordered[j];
      ordered[j] = swap;
    }
    ordered.forEach(function (ad) {
      var card = document.createElement("a");
      card.className = "ad-card";
      card.href = ad.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.setAttribute("aria-label", ad.title + " (opens in a new tab)");

      var media = document.createElement("span");
      media.className = "ad-media";
      if (ad.image) {
        var img = document.createElement("img");
        img.src = ad.image;
        img.alt = "";
        img.loading = "lazy";
        media.appendChild(img);
      } else {
        media.textContent = NX.initials(ad.title || "TechOrigin");
      }
      var text = document.createElement("span");
      text.className = "ad-text";
      var title = document.createElement("b");
      title.textContent = ad.title || "TechOrigin app";
      var description = document.createElement("small");
      description.textContent = ad.description || "";
      var host = document.createElement("em");
      try { host.textContent = new URL(ad.url).hostname.replace(/^www\./, ""); }
      catch (e) { host.textContent = ad.url; }
      text.appendChild(title);
      if (ad.description) text.appendChild(description);
      text.appendChild(host);
      var arrow = document.createElement("span");
      arrow.className = "ad-arrow";
      arrow.innerHTML = NX.icon("arrow-up-right");
      card.appendChild(media);
      card.appendChild(text);
      card.appendChild(arrow);
      grid.appendChild(card);
    });
    el.ads.appendChild(grid);
  }

  /* ---------------- trash ---------------- */
  function openTrash() {
    NX.openModal("trash-modal");
    if (!el.trashList) return;
    el.trashList.innerHTML = '<p class="typing">Loading…</p>';
    NX.api("/api/conversations/trash").then(function (items) {
      el.trashList.innerHTML = "";
      if (!items.length) {
        el.trashList.innerHTML = '<p class="typing">Nothing in the trash.</p>';
        return;
      }
      items.forEach(function (conversation) {
        var row = document.createElement("div");
        row.className = "trash-item";
        var text = document.createElement("div");
        text.className = "trash-text";
        var title = document.createElement("b");
        title.textContent = conversation.title || "Untitled conversation";
        var meta = document.createElement("small");
        meta.textContent = "Deleted " + NX.formatDateTime(conversation.deleted_at);
        text.appendChild(title);
        text.appendChild(meta);

        var actions = document.createElement("div");
        actions.className = "trash-actions";
        var restore = document.createElement("button");
        restore.type = "button";
        restore.className = "secondary-btn compact";
        restore.textContent = "Restore";
        restore.addEventListener("click", function () {
          NX.api("/api/conversations/" + conversation.id + "/restore", { method: "POST" })
            .then(function () {
              NX.toast("Conversation restored.");
              openTrash();
              loadConversations();
            }).catch(fail);
        });
        var purge = document.createElement("button");
        purge.type = "button";
        purge.className = "danger-btn compact";
        purge.textContent = "Delete forever";
        purge.addEventListener("click", function () {
          NX.confirm(
            "Delete forever?",
            "This permanently removes the conversation and its messages. It cannot be undone.",
            "Delete forever"
          ).then(function (ok) {
            if (!ok) return;
            NX.api("/api/conversations/" + conversation.id + "/purge", { method: "DELETE" })
              .then(function () {
                var cache = readCache();
                if (cache.messages) delete cache.messages[conversation.id];
                if (cache.lastId === conversation.id) cache.lastId = null;
                writeCache(cache);
                if (state.currentId === conversation.id) {
                  state.currentId = null;
                  showWelcome();
                }
                NX.toast("Conversation permanently deleted.");
                openTrash();
                loadConversations();
                refreshCredits();
              }).catch(fail);
          });
        });
        actions.appendChild(restore);
        actions.appendChild(purge);
        row.appendChild(text);
        row.appendChild(actions);
        el.trashList.appendChild(row);
      });
    }).catch(fail);
  }

  /* ---------------- settings actions ---------------- */
  function openSettings() {
    applyUserUI();
    applySettingsUI();
    NX.openModal("settings-modal");
  }

  function saveProfile() {
    var input = document.getElementById("profile-display-name");
    var nickInput = document.getElementById("profile-nickname");
    var name = (input.value || "").replace(/^\s+|\s+$/g, "");
    var nickname = (nickInput && nickInput.value || "").replace(/^\s+|\s+$/g, "");
    if (!name) return NX.toast("Display name cannot be empty.", "error");
    NX.api("/api/profile", { method: "POST", body: { display_name: name, nickname: nickname } }).then(function (data) {
      state.user.display_name = name;
      state.user.nickname = data.nickname || null;
      applyUserUI();
      NX.toast("Profile updated.");
    }).catch(fail);
  }

  function uploadAvatar(file) {
    if (!file) return;
    var status = document.getElementById("avatar-status");
    if (status) {
      status.classList.remove("hidden");
      status.textContent = "Uploading photo…";
    }
    var form = new FormData();
    form.append("avatar", file);
    NX.api("/api/profile/avatar", { method: "POST", body: form }).then(function (data) {
      state.user.avatar = data.avatar;
      applyUserUI();
      if (status) status.textContent = "Photo updated.";
      NX.toast("Profile photo updated.");
    }).catch(function (error) {
      if (status) status.textContent = error.message || "Upload failed.";
      fail(error);
    });
  }

  function changePassword() {
    var current = document.getElementById("current-password");
    var next = document.getElementById("new-password");
    var status = document.getElementById("password-status");
    if (status) status.textContent = "";
    NX.api("/api/profile/password", {
      method: "POST",
      body: { current_password: current.value, new_password: next.value }
    }).then(function () {
      current.value = "";
      next.value = "";
      NX.toast("Password updated.");
    }).catch(function (error) {
      if (status) status.textContent = error.message || "Could not update password.";
    });
  }

  /* ---------------- export ---------------- */
  function exportChat() {
    if (!state.currentId || !state.messagesData.length) {
      NX.toast("Open a conversation with messages to export.", "error");
      return;
    }
    var title = state.currentTitle || "Nexora conversation";
    var lines = ["# " + title, "", "Exported from Nexora AI on " + new Date().toLocaleString(), ""];
    state.messagesData.forEach(function (message) {
      lines.push("## " + (message.role === "user" ? "You" : "Nexora"));
      lines.push("");
      lines.push(message.content || "");
      lines.push("");
    });
    var blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    var filename = (title.replace(/[^\w-. ]+/g, "").replace(/\s+/g, "-").substring(0, 60) || "nexora-chat") + ".md";
    var anchor = document.createElement("a");
    if (window.URL && window.URL.createObjectURL) {
      anchor.href = window.URL.createObjectURL(blob);
    } else {
      anchor.href = "data:text/markdown;charset=utf-8," + encodeURIComponent(lines.join("\n"));
    }
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    if (window.URL && window.URL.revokeObjectURL) {
      setTimeout(function () { window.URL.revokeObjectURL(anchor.href); }, 1000);
    }
    NX.toast("Conversation exported.");
  }

  /* ---------------- UI helpers ---------------- */
  function scrollBottom(force) {
    if (!el.chat) return;
    var distance = el.chat.scrollHeight - el.chat.scrollTop - el.chat.clientHeight;
    if (force || distance < 140) el.chat.scrollTop = el.chat.scrollHeight;
  }

  function updateScrollButton() {
    if (!el.scrollBottom || !el.chat) return;
    var distance = el.chat.scrollHeight - el.chat.scrollTop - el.chat.clientHeight;
    el.scrollBottom.classList.toggle("hidden", distance < 180);
  }

  function openSidebar() {
    if (el.sidebar) el.sidebar.classList.add("open");
    if (el.scrim) el.scrim.classList.remove("hidden");
  }

  function closeSidebar() {
    if (el.sidebar) el.sidebar.classList.remove("open");
    if (el.scrim) el.scrim.classList.add("hidden");
  }

  function fail(error) {
    if (error && error.status === 401) {
      window.location.href = "/login";
      return;
    }
    NX.toast((error && error.message) || "Something went wrong.", "error");
  }

  function setSettingsTab(name) {
    NX.$$("[data-settings-tab]").forEach(function (tab) {
      tab.classList.toggle("active", tab.getAttribute("data-settings-tab") === name);
    });
    NX.$$("[data-settings-panel]").forEach(function (panel) {
      panel.classList.toggle("hidden", panel.getAttribute("data-settings-panel") !== name);
    });
  }

  /* ---------------- bindings ---------------- */
  function bind() {
    document.getElementById("new-chat").addEventListener("click", newConversation);
    document.getElementById("mobile-menu").addEventListener("click", openSidebar);
    document.getElementById("sidebar-close").addEventListener("click", closeSidebar);
    if (el.scrim) el.scrim.addEventListener("click", closeSidebar);

    document.getElementById("settings-open").addEventListener("click", openSettings);
    document.getElementById("settings-top").addEventListener("click", openSettings);
    document.getElementById("trash-open").addEventListener("click", openTrash);
    document.getElementById("export-chat").addEventListener("click", exportChat);
    document.getElementById("logout").addEventListener("click", function () {
      NX.confirm("Sign out?", "Your conversations will still be here when you return.", "Sign out")
        .then(function (ok) {
          if (!ok) return;
          NX.api("/api/logout", { method: "POST", body: {} }).then(function () {
            window.location.href = "/login";
          }).catch(function () { window.location.href = "/login"; });
        });
    });

    el.form.addEventListener("submit", function (event) {
      event.preventDefault();
      sendMessage(el.input.value);
    });
    el.input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        el.form.requestSubmit ? el.form.requestSubmit() : sendMessage(el.input.value);
      }
    });
    el.input.addEventListener("input", function () { NX.autoGrow(el.input); });

    if (el.attachBtn) el.attachBtn.addEventListener("click", function () { el.fileInput.click(); });
    if (el.fileInput) el.fileInput.addEventListener("change", function () {
      uploadFiles(el.fileInput.files);
      el.fileInput.value = "";
    });
    if (el.webToggle) el.webToggle.addEventListener("click", function () { setWebSearch(!state.webSearch); });
    if (el.imageToggle) el.imageToggle.addEventListener("click", function () {
      setImageMode(!state.imageMode);
      if (state.imageMode && el.input) {
        el.input.placeholder = "Describe the image you want to create…";
        el.input.focus();
      } else if (el.input) {
        el.input.placeholder = "Ask Nexora anything…";
      }
    });

    el.stop.addEventListener("click", function () {
      if (state.stream) {
        state.stream.abort();
        state.stream = null;
      }
      state.busy = false;
      updateComposer();
      NX.toast("Generation stopped.");
      setTimeout(function () { refreshCurrentConversation().catch(function () {}); }, 1200);
    });

    el.search.addEventListener("input", renderConversations);

    NX.$$(".suggestion").forEach(function (button) {
      button.addEventListener("click", function () {
        el.input.value = button.getAttribute("data-prompt") || "";
        NX.autoGrow(el.input);
        el.input.focus();
      });
    });

    el.chat.addEventListener("scroll", updateScrollButton);
    el.scrollBottom.addEventListener("click", function () { scrollBottom(true); });

    var avatarInput = document.getElementById("avatar-input");
    if (avatarInput) {
      avatarInput.addEventListener("change", function () {
        uploadAvatar(avatarInput.files && avatarInput.files[0]);
        avatarInput.value = "";
      });
    }

    var profileForm = document.getElementById("profile-form");
    if (profileForm) profileForm.addEventListener("submit", function (event) { event.preventDefault(); saveProfile(); });
    var passwordForm = document.getElementById("password-form");
    if (passwordForm) passwordForm.addEventListener("submit", function (event) { event.preventDefault(); changePassword(); });

    var preferencesSave = document.getElementById("preferences-save");
    if (preferencesSave) preferencesSave.addEventListener("click", savePreferences);
    var godRequestBtn = document.getElementById("god-request-btn");
    if (godRequestBtn) godRequestBtn.addEventListener("click", requestGodMode);
    if (el.temp) el.temp.addEventListener("input", function () { el.tempValue.textContent = el.temp.value; });

    NX.$$("[data-settings-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () { setSettingsTab(tab.getAttribute("data-settings-tab")); });
    });

    document.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        newConversation();
      }
      if (event.key === "Escape") closeSidebar();
    });
  }
})();
