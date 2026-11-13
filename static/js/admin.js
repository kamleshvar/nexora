/* Nexora AI — administrator console. */
(function () {
  "use strict";

  var state = {
    authed: false,
    users: [],
    conversations: [],
    ads: [],
    detail: null,
    godRequests: [],
    deletedUsers: [],
    deletedUsersPagination: null,
    deletedUsersPage: 1,
    aiChats: [],
    aiCounts: { active: 0, archived: 0, deleted: 0 },
    profile: null,
    ai: {
      currentId: null,
      title: "",
      messages: [],
      busy: false,
      stream: null,
      attachments: [],
      webSearch: false,
      imageMode: false,
      aspectRatio: "1:1",
      prefs: null,
      panel: null,
      panelItems: [],
      selected: {}
    }
  };

  var el = {};

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(init);

  function init() {
    var boot = window.NEXORA || {};
    state.models = boot.models || {};
    state.defaultModel = boot.defaultModel || "";

    el.login = document.getElementById("admin-login");
    el.app = document.getElementById("admin-app");
    el.loginForm = document.getElementById("admin-login-form");
    el.password = document.getElementById("admin-password");
    el.loginError = document.getElementById("admin-login-error");

    state.guidelinesVersion = boot.guidelinesVersion;
    bind();
    checkSession();
  }

  function bind() {
    el.loginForm.addEventListener("submit", function (event) {
      event.preventDefault();
      el.loginError.textContent = "";
      var button = el.loginForm.querySelector("button[type=submit]");
      button.disabled = true;
      button.textContent = "Unlocking…";
      NX.api("/api/admin/login", { method: "POST", body: { password: el.password.value } })
        .then(function () {
          state.authed = true;
          showApp();
        })
        .catch(function (error) {
          el.loginError.textContent = error.message || "Incorrect password.";
          button.disabled = false;
          button.textContent = "Unlock admin console";
        });
    });

    NX.$$("[data-admin-view]").forEach(function (button) {
      button.addEventListener("click", function () {
        setView(button.getAttribute("data-admin-view"));
      });
    });

    document.getElementById("admin-refresh").addEventListener("click", refreshAll);
    document.getElementById("admin-search").addEventListener("input", debounce(loadAdminConversations, 300));
    document.getElementById("admin-user-filter").addEventListener("change", loadAdminConversations);
    document.getElementById("admin-include-deleted").addEventListener("change", loadAdminConversations);
    var adsToggle = document.getElementById("ads-enabled");
    if (adsToggle) adsToggle.addEventListener("change", toggleAds);
    var signupsToggle = document.getElementById("signups-enabled");
    if (signupsToggle) {
      signupsToggle.addEventListener("change", function (event) {
        var enabled = event.target.checked;
        NX.api("/api/admin/settings", { method: "POST", body: { signups_enabled: enabled } })
          .then(function () { NX.toast(enabled ? "Registrations enabled." : "Registrations paused."); })
          .catch(function (error) { event.target.checked = !enabled; fail(error); });
      });
    }

    // Deleted users controls
    var deletedSearch = document.getElementById("deleted-search");
    if (deletedSearch) deletedSearch.addEventListener("input", debounce(function () { state.deletedUsersPage = 1; loadDeletedUsers(); }, 300));
    var deletedDateFrom = document.getElementById("deleted-date-from");
    if (deletedDateFrom) deletedDateFrom.addEventListener("change", function () { state.deletedUsersPage = 1; loadDeletedUsers(); });
    var deletedDateTo = document.getElementById("deleted-date-to");
    if (deletedDateTo) deletedDateTo.addEventListener("change", function () { state.deletedUsersPage = 1; loadDeletedUsers(); });
    var deletedSort = document.getElementById("deleted-sort");
    if (deletedSort) deletedSort.addEventListener("change", function () { state.deletedUsersPage = 1; loadDeletedUsers(); });

    document.getElementById("admin-settings-open").addEventListener("click", function () {
      NX.openModal("admin-settings-modal");
    });
    document.getElementById("admin-logout").addEventListener("click", function () {
      NX.confirm("Sign out of admin?", "You can sign back in with the administrator password.", "Sign out")
        .then(function (ok) {
          if (!ok) return;
          NX.api("/api/admin/logout", { method: "POST", body: {} }).then(function () {
            window.location.href = "/admin";
          }).catch(function () { window.location.href = "/admin"; });
        });
    });

    document.getElementById("admin-menu").addEventListener("click", openMenu);
    document.getElementById("admin-sidebar-close").addEventListener("click", closeMenu);
    document.getElementById("admin-scrim").addEventListener("click", closeMenu);

    document.getElementById("admin-new-chat").addEventListener("click", newAdminChat);
    document.getElementById("admin-ai-start").addEventListener("click", newAdminChat);
    document.getElementById("admin-chat-form").addEventListener("submit", function (event) {
      event.preventDefault();
      sendAdminMessage(el.adminInput.value);
    });
    el.adminInput = document.getElementById("admin-message-input");
    el.adminInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        document.getElementById("admin-chat-form").requestSubmit
          ? document.getElementById("admin-chat-form").requestSubmit()
          : sendAdminMessage(el.adminInput.value);
      }
    });
    el.adminInput.addEventListener("input", function () { NX.autoGrow(el.adminInput); });

    // Admin AI chat tools
    if (document.getElementById("admin-ai-attach")) {
      document.getElementById("admin-ai-attach").addEventListener("click", function () {
        document.getElementById("admin-ai-file-input").click();
      });
    }
    if (document.getElementById("admin-ai-file-input")) {
      document.getElementById("admin-ai-file-input").addEventListener("change", function () {
        uploadAdminFiles(this.files);
        this.value = "";
      });
    }
    if (document.getElementById("admin-ai-web")) {
      document.getElementById("admin-ai-web").addEventListener("click", function () {
        setAdminWebSearch(!state.ai.webSearch);
      });
    }
    if (document.getElementById("admin-ai-image")) {
      document.getElementById("admin-ai-image").addEventListener("click", function () {
        setAdminImageMode(!state.ai.imageMode);
      });
    }
    if (document.getElementById("admin-ai-aspect")) {
      document.getElementById("admin-ai-aspect").addEventListener("change", function () {
        state.ai.aspectRatio = this.value;
      });
    }

    document.getElementById("admin-stop").addEventListener("click", function () {
      if (state.ai.stream) {
        state.ai.stream.abort();
        state.ai.stream = null;
      }
      state.ai.busy = false;
      updateAdminComposer();
      NX.toast("Generation stopped.");
      setTimeout(refreshAdminChat, 1200);
    });

    document.getElementById("admin-detail-restore").addEventListener("click", restoreDetail);
    document.getElementById("admin-detail-delete").addEventListener("click", purgeDetail);

    // Admin AI workspace: chat management
    document.getElementById("admin-ai-search").addEventListener("input", debounce(function () {
      loadAdminChats();
      if (state.ai.panel) loadPanelItems();
    }, 300));
    NX.$$("[data-ai-panel]").forEach(function (button) {
      button.addEventListener("click", function () {
        openPanel(button.getAttribute("data-ai-panel"));
      });
    });
    document.getElementById("admin-ai-panel-back").addEventListener("click", closePanel);
    document.getElementById("admin-ai-select-all").addEventListener("change", toggleSelectAll);
    document.getElementById("admin-ai-bulk-restore").addEventListener("click", bulkRestore);
    document.getElementById("admin-ai-bulk-purge").addEventListener("click", bulkPurge);
    document.getElementById("admin-ai-settings").addEventListener("click", function () {
      NX.openModal("admin-settings-modal");
    });

    // Model selector and settings
    var modelSelect = document.getElementById("admin-ai-model");
    modelSelect.addEventListener("change", function () {
      var model = modelSelect.value;
      savePrefs({ model: model }).then(function () {
        NX.toast("Model switched to " + modelShortName(model) + ".");
      }).catch(function () {});
    });
    document.getElementById("admin-ai-model-gear").addEventListener("click", openModelSettings);
    document.getElementById("admin-ai-prefs-form").addEventListener("submit", savePrefsForm);

    // Profile dropdown and modal
    el.profileWrap = document.getElementById("admin-profile-menu-wrap");
    el.profileButton = document.getElementById("admin-profile-button");
    el.profileDropdown = document.getElementById("admin-profile-dropdown");
    el.profileButton.addEventListener("click", function (event) {
      event.stopPropagation();
      el.profileDropdown.classList.toggle("hidden");
      el.profileButton.setAttribute("aria-expanded", el.profileDropdown.classList.contains("hidden") ? "false" : "true");
    });
    document.addEventListener("click", function (event) {
      if (el.profileWrap && !el.profileWrap.contains(event.target)) {
        el.profileDropdown.classList.add("hidden");
        el.profileButton.setAttribute("aria-expanded", "false");
      }
      NX.$$(".conv-menu").forEach(function (menu) {
        if (!menu.parentElement.contains(event.target)) menu.remove();
      });
    });
    NX.$$("[data-profile-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        el.profileDropdown.classList.add("hidden");
        handleProfileAction(button.getAttribute("data-profile-action"));
      });
    });
    NX.$$("[data-profile-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () { switchProfileTab(tab.getAttribute("data-profile-tab")); });
    });
    document.getElementById("admin-profile-form").addEventListener("submit", saveAdminProfile);
    document.getElementById("profile-avatar-input").addEventListener("change", function () {
      uploadProfileAvatar(this.files && this.files[0]);
      this.value = "";
    });
    document.getElementById("admin-password-form").addEventListener("submit", changeAdminPassword);
    document.getElementById("profile-signout-others").addEventListener("click", signOutOthers);

    document.getElementById("admin-ad-new").addEventListener("click", function () { openAdEditor(null); });
    document.getElementById("admin-ad-form").addEventListener("submit", saveAd);
    document.getElementById("ad-delete").addEventListener("click", deleteAd);
    document.getElementById("ad-image").addEventListener("change", previewAdImage);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeMenu();
    });
  }

  function uploadAdminFiles(files) {
    if (!files || !files.length) return;
    var tray = document.getElementById("admin-ai-attachment-tray");
    if (tray) tray.classList.remove("hidden");
    Array.prototype.slice.call(files).forEach(function (file) {
      var form = new FormData();
      form.append("file", file);
      var chip = document.createElement("div");
      chip.className = "attachment-chip uploading";
      chip.innerHTML = NX.icon("file-text") + '<span class="attachment-name"><span>' + NX.esc(file.name) + '</span><small>' + NX.formatSize(file.size) + '</small></span><button class="attachment-remove" type="button" aria-label="Remove" disabled>' + NX.icon("x") + '</button>';
      tray.appendChild(chip);
      NX.api("/api/upload", { method: "POST", body: form })
        .then(function (res) {
          state.ai.attachments.push({ id: res.id, name: file.name, size: file.size });
          chip.classList.remove("uploading");
          chip.querySelector(".attachment-remove").disabled = false;
          chip.querySelector(".attachment-remove").addEventListener("click", function () {
            state.ai.attachments = state.ai.attachments.filter(function (a) { return a.id !== res.id; });
            tray.removeChild(chip);
            if (!state.ai.attachments.length) tray.classList.add("hidden");
          });
        })
        .catch(function (err) {
          NX.toast("Upload failed: " + err.message, "error");
          tray.removeChild(chip);
        });
    });
  }

  function setAdminWebSearch(on) {
    state.ai.webSearch = on;
    var btn = document.getElementById("admin-ai-web");
    if (btn) btn.classList.toggle("active", on);
    if (on) {
      NX.toast("Web search enabled.");
    } else {
      NX.toast("Web search disabled.");
    }
  }

  function setAdminImageMode(on) {
    state.ai.imageMode = on;
    var btn = document.getElementById("admin-ai-image");
    var aspect = document.getElementById("admin-ai-aspect");
    if (btn) btn.classList.toggle("active", on);
    if (aspect) aspect.classList.toggle("hidden", !on);
    if (on) {
      el.adminInput.placeholder = "Describe the image you want to create…";
      NX.toast("Image mode enabled.");
    } else {
      el.adminInput.placeholder = "Message Nexora in God mode…";
      NX.toast("Image mode disabled.");
    }
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  function checkSession() {
    NX.api("/api/admin/status").then(function (data) {
      if (data.authenticated) {
        state.authed = true;
        showApp();
      } else {
        el.login.classList.remove("hidden");
        el.app.classList.add("hidden");
      }
    }).catch(function () {
      el.login.classList.remove("hidden");
      el.app.classList.add("hidden");
    });
  }

  function showApp() {
    el.login.classList.add("hidden");
    el.app.classList.remove("hidden");
    refreshAll();
    loadAdminChats();
    loadAiPrefs();
    loadAdminProfile();
    if (!state.guidelinesShown) {
      state.guidelinesShown = true;
      NX.maybeShowGuidelines(state.guidelinesVersion);
    }
  }

  function refreshAdmin() {
    loadAdminConversations();
    state.mainSelected = {};
    syncMainSelectAll();
    updateMainSelectionCount();
    var sel = document.getElementById("main-selection-toolbar");
    if (sel) sel.parentNode.removeChild(sel);
  }

  function refreshAll() {
    loadOverview();
    loadUsers();
    loadAdminConversations();
    loadAdminSettings();
  }

  function fail(error) {
    if (error && error.status === 401) {
      state.authed = false;
      el.app.classList.add("hidden");
      el.login.classList.remove("hidden");
      return;
    }
    NX.toast((error && error.message) || "Something went wrong.", "error");
  }

  /* ---------------- views ---------------- */
  function setView(view) {
    NX.$$("[data-admin-view]").forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-admin-view") === view);
    });
    ["chats", "users", "deleted-users", "god-requests", "ads", "ai"].forEach(function (name) {
      document.getElementById("view-" + name).classList.toggle("hidden", view !== name);
    });

    var titles = {
      chats: ["All chats", "Every conversation, including deleted ones."],
      users: ["Active Users", "Manage active accounts, credits, and restrictions."],
      "deleted-users": ["Deleted Users", "Manage soft-deleted accounts. Restore or permanently delete."],
      "god-requests": ["God mode requests", "Review and approve user requests for God mode (Nemotron 3 Ultra)."],
      ads: ["Advertisements", "Manage the TechOrigin cards shown at the end of chats."],
      ai: ["Admin AI chat", "Your own private workspace, separate from user conversations."]
    };
    document.getElementById("admin-title").textContent = titles[view][0];
    document.getElementById("admin-subtitle").textContent = titles[view][1];
    closeMenu();
    if (view !== "ai" && state.ai.panel) closePanel();
    if (view === "ai") loadAdminChats();
    if (view === "ads") { loadAds(); loadAdminSettings(); }
    if (view === "god-requests") loadGodRequests();
    if (view === "deleted-users") loadDeletedUsers();
  }

  /* ---------------- overview / users / chats ---------------- */
  function loadOverview() {
    NX.api("/api/admin/overview").then(function (data) {
      document.getElementById("stat-users").textContent = data.users;
      document.getElementById("stat-conversations").textContent = data.conversations;
      document.getElementById("stat-deleted").textContent = data.deleted_conversations;
      document.getElementById("stat-messages").textContent = data.messages;
    }).catch(fail);
  }

  function loadUsers() {
    NX.api("/api/admin/users").then(function (users) {
      state.users = users;
      renderUserFilter();
      renderUsers();
    }).catch(fail);
  }

  function loadGodRequests() {
    NX.api("/api/admin/god-requests").then(function (requests) {
      state.godRequests = requests;
      renderGodRequests();
    }).catch(fail);
  }

  function loadDeletedUsers() {
    var page = state.deletedUsersPage || 1;
    var perPage = 20;
    var search = document.getElementById("deleted-search") ? document.getElementById("deleted-search").value : "";
    var dateFrom = document.getElementById("deleted-date-from") ? document.getElementById("deleted-date-from").value : "";
    var dateTo = document.getElementById("deleted-date-to") ? document.getElementById("deleted-date-to").value : "";
    var sort = document.getElementById("deleted-sort") ? document.getElementById("deleted-sort").value : "newest";

    var params = new URLSearchParams();
    params.append("page", page);
    params.append("per_page", perPage);
    if (search) params.append("q", search);
    if (dateFrom) params.append("date_from", dateFrom);
    if (dateTo) params.append("date_to", dateTo);
    params.append("sort", sort);

    NX.api("/api/admin/users/deleted?" + params.toString()).then(function (data) {
      state.deletedUsers = data.users || [];
      state.deletedUsersPagination = data.pagination || { page: 1, total: 0, total_pages: 0 };
      renderDeletedUsers();
      renderDeletedPagination();
    }).catch(fail);

    // Load stats
    NX.api("/api/admin/users/deleted/stats").then(function (stats) {
      renderDeletedStats(stats);
    }).catch(function () {});
  }

  function renderDeletedStats(stats) {
    var container = document.getElementById("deleted-stats-row");
    if (!container) return;
    container.innerHTML = "";
    if (!stats) return;

    var statsHtml = [
      { label: "Total deleted", value: adminFormatTokens(stats.total_deleted), icon: NX.icon("trash") },
      { label: "Last 7 days", value: adminFormatTokens(stats.recently_deleted), icon: NX.icon("calendar") },
      { label: "Last 30 days", value: adminFormatTokens(stats.last_30_days), icon: NX.icon("bar-chart") },
    ];

    statsHtml.forEach(function (stat) {
      var card = document.createElement("div");
      card.className = "stat-card";
      card.innerHTML = '<span>' + stat.icon + ' ' + stat.label + '</span><b>' + stat.value + '</b>';
      container.appendChild(card);
    });
  }

  function renderDeletedUsers() {
    var container = document.getElementById("admin-deleted-users-list");
    if (!container) return;
    container.innerHTML = "";

    if (!state.deletedUsers || !state.deletedUsers.length) {
      container.innerHTML = '<div class="admin-empty"><img src="/static/img/logo-mark.png" alt="" width="54" height="54"><h2>No deleted users</h2><p>No accounts have been deleted yet.</p></div>';
      return;
    }

    state.deletedUsers.forEach(function (user) {
      var status = user.status || "deleted";
      var card = document.createElement("article");
      card.className = "admin-user-card status-" + status;

      var head = document.createElement("div");
      head.className = "admin-user-head";
      var avatar = document.createElement("span");
      avatar.className = "avatar avatar-user";
      NX.avatar(avatar, user.display_name || user.username, user.avatar);
      var info = document.createElement("div");
      info.className = "admin-user-info";
      var name = document.createElement("b");
      name.textContent = user.display_name || user.username;
      var username = document.createElement("small");
      username.textContent = "@" + user.username + " · joined " + NX.formatDate(user.created_at);
      info.appendChild(name);
      info.appendChild(username);
      head.appendChild(avatar);
      head.appendChild(info);

      var badge = document.createElement("span");
      badge.className = "badge user-status " + status;
      badge.textContent = status.toUpperCase();
      head.appendChild(badge);

      var stats = document.createElement("div");
      stats.className = "admin-user-stats";
      stats.innerHTML =
        "<span><b>" + user.conversation_count + "</b> chats</span>" +
        "<span><b>" + user.deleted_count + "</b> deleted</span>" +
        "<span><b>" + user.message_count + "</b> messages</span>" +
        "<span><b>" + adminFormatTokens(user.used_tokens) + " / " + adminFormatTokens(user.credit_limit) + "</b> 6h credits</span>";
      card.appendChild(head);
      card.appendChild(stats);

      var meta = document.createElement("div");
      meta.className = "admin-user-meta";
      var metaParts = [];
      if (user.deleted_at) metaParts.push("Deleted: " + NX.formatDateTime(user.deleted_at));
      if (user.deletion_reason) metaParts.push("Reason: " + user.deletion_reason);
      if (user.deleted_by) metaParts.push("By: " + user.deleted_by);
      if (user.nickname) metaParts.push("Preferred name: " + user.nickname);
      if (user.ban_reason) metaParts.push("Ban reason: " + user.ban_reason);
      if (user.flags) metaParts.push(user.flags + " moderation flag(s)");
      meta.textContent = metaParts.join(" · ");
      card.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "admin-user-actions";

      var view = document.createElement("button");
      view.type = "button";
      view.className = "secondary-btn compact";
      view.textContent = "View chats";
      view.addEventListener("click", function () {
        document.getElementById("admin-user-filter").value = user.id;
        setView("chats");
        loadAdminConversations();
      });
      actions.appendChild(view);

      var restore = document.createElement("button");
      restore.type = "button";
      restore.className = "primary-btn compact";
      restore.textContent = "Restore";
      restore.addEventListener("click", function () { restoreDeletedUser(user); });
      actions.appendChild(restore);

      var purge = document.createElement("button");
      purge.type = "button";
      purge.className = "danger-btn compact";
      purge.textContent = "Purge forever";
      purge.addEventListener("click", function () { purgeDeletedUser(user); });
      actions.appendChild(purge);

      card.appendChild(actions);
      container.appendChild(card);
    });
  }

  function renderDeletedPagination() {
    var container = document.getElementById("deleted-pagination");
    if (!container) return;
    var pagination = state.deletedUsersPagination;
    if (!pagination || pagination.total_pages <= 1) {
      container.innerHTML = "";
      return;
    }

    var html = '<div class="pagination-controls">';
    html += '<button class="secondary-btn compact" id="deleted-prev" ' + (pagination.page <= 1 ? 'disabled' : '') + '>' + NX.icon("arrow-left") + ' Previous</button>';
    html += '<span class="pagination-info">Page ' + pagination.page + ' of ' + pagination.total_pages + ' (' + pagination.total + ' total)</span>';
    html += '<button class="secondary-btn compact" id="deleted-next" ' + (pagination.page >= pagination.total_pages ? 'disabled' : '') + '>Next ' + NX.icon("arrow-right") + '</button>';
    html += '</div>';
    container.innerHTML = html;

    var prevBtn = document.getElementById("deleted-prev");
    var nextBtn = document.getElementById("deleted-next");
    if (prevBtn) prevBtn.addEventListener("click", function () {
      if (pagination.page > 1) {
        state.deletedUsersPage = pagination.page - 1;
        loadDeletedUsers();
      }
    });
    if (nextBtn) nextBtn.addEventListener("click", function () {
      if (pagination.page < pagination.total_pages) {
        state.deletedUsersPage = pagination.page + 1;
        loadDeletedUsers();
      }
    });
  }

  function restoreDeletedUser(user) {
    var reason = window.prompt("Restore @" + user.username + "? Optional reason:", "") || "";
    NX.confirm("Restore account?",
      "This will restore @" + user.username + " to active status. They will regain access to their account and data.",
      "Restore"
    ).then(function (ok) {
      if (!ok) return;
      NX.api("/api/admin/users/deleted/" + user.id + "/restore", {
        method: "POST",
        body: { reason: reason }
      }).then(function () {
        NX.toast("Account restored.");
        loadDeletedUsers();
        loadUsers();
      }).catch(fail);
    });
  }

  function purgeDeletedUser(user) {
    NX.confirm("Purge @" + user.username + " forever?",
      "This will PERMANENTLY DELETE the account and ALL associated data (chats, files, messages, usage history). This CANNOT BE UNDONE.",
      "Purge forever"
    ).then(function (ok) {
      if (!ok) return;
      NX.confirm("Are you absolutely sure?",
        "This is the final confirmation. The account @" + user.username + " will be erased completely with no way to recover.",
        "Purge forever"
      ).then(function (ok2) {
        if (!ok2) return;
        NX.api("/api/admin/users/deleted/" + user.id + "/purge", { method: "DELETE" })
          .then(function () {
            NX.toast("Account permanently deleted.");
            loadDeletedUsers();
            loadUsers();
          }).catch(fail);
      });
    });
  }

  function renderGodRequests() {
    var container = document.getElementById("admin-god-requests-list");
    container.innerHTML = "";
    if (!state.godRequests || !state.godRequests.length) {
      container.innerHTML = '<p class="typing">No God mode requests yet.</p>';
      return;
    }
    state.godRequests.forEach(function (req) {
      var card = document.createElement("article");
      card.className = "admin-god-request-card status-" + (req.status || "pending");

      var head = document.createElement("div");
      head.className = "admin-god-request-head";
      var avatar = document.createElement("span");
      avatar.className = "avatar avatar-user";
      NX.avatar(avatar, req.display_name || req.username, req.avatar);
      var info = document.createElement("div");
      info.className = "admin-god-request-info";
      var name = document.createElement("b");
      name.textContent = req.display_name || req.username;
      var username = document.createElement("small");
      username.textContent = "@" + req.username + " · requested " + NX.formatDateTime(req.created_at);
      info.appendChild(name);
      info.appendChild(username);
      head.appendChild(avatar);
      head.appendChild(info);

      var badge = document.createElement("span");
      badge.className = "badge god-request-status " + (req.status || "pending");
      badge.textContent = (req.status || "pending").toUpperCase();
      head.appendChild(badge);

      var message = document.createElement("div");
      message.className = "admin-god-request-message";
      message.textContent = req.message || "(no message)";

      var meta = document.createElement("div");
      meta.className = "admin-god-request-meta";
      meta.textContent = "Current plan: " + (req.plan || "standard");

      var actions = document.createElement("div");
      actions.className = "admin-god-request-actions";
      if ((req.status || "pending") === "pending") {
        var approve = document.createElement("button");
        approve.type = "button";
        approve.className = "primary-btn compact";
        approve.textContent = "Approve";
        approve.addEventListener("click", function () {
          resolveGodRequest(req.id, "approve");
        });
        actions.appendChild(approve);

        var reject = document.createElement("button");
        reject.type = "button";
        reject.className = "secondary-btn compact";
        reject.textContent = "Reject";
        reject.addEventListener("click", function () {
          resolveGodRequest(req.id, "reject");
        });
        actions.appendChild(reject);
      } else {
        var note = document.createElement("span");
        note.className = "admin-god-request-note";
        note.textContent = "Resolved " + NX.formatDateTime(req.resolved_at);
        if (req.admin_note) {
          note.textContent += " · Admin note: " + req.admin_note;
        }
        actions.appendChild(note);
      }

      card.appendChild(head);
      if (req.message) card.appendChild(message);
      card.appendChild(meta);
      card.appendChild(actions);
      container.appendChild(card);
    });
  }

  function resolveGodRequest(reqId, action) {
    var note = "";
    if (action === "reject") {
      note = window.prompt("Rejection reason (optional):", "") || "";
    } else {
      note = window.prompt("Approval note (optional):", "") || "";
    }
    NX.api("/api/admin/god-requests/" + reqId, {
      method: "POST",
      body: { action: action, admin_note: note }
    }).then(function () {
      NX.toast("Request " + action + "d.");
      loadGodRequests();
    }).catch(fail);
  }

  function renderUserFilter() {
    var select = document.getElementById("admin-user-filter");
    var current = select.value;
    select.innerHTML = '<option value="">All users</option>';
    state.users.forEach(function (user) {
      var option = document.createElement("option");
      option.value = user.id;
      option.textContent = "@" + user.username + (user.display_name && user.display_name !== user.username ? " · " + user.display_name : "");
      select.appendChild(option);
    });
    select.value = current;
  }

  function adminFormatTokens(value) {
    var number = Number(value) || 0;
    if (number >= 1000000) return (number / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (number >= 1000) return (number / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(number);
  }

  function setUserStatus(user, action) {
    var label = action === "ban" ? "Ban" : action === "delete" ? "Delete account"
      : action === "restrict" ? "Restrict" : "Restore access";
    var reason = "";
    if (action === "ban" || action === "delete" || action === "restrict") {
      reason = window.prompt(label + " @" + user.username + " — reason (optional):", "") || "";
    }
    NX.confirm(label + " @" + user.username + "?",
      action === "unban" || action === "unrestrict" || action === "restore"
        ? "The account will be able to sign in and chat again."
        : "The user will lose access according to this action. You can undo it at any time.",
      label
    ).then(function (ok) {
      if (!ok) return;
      NX.api("/api/admin/users/" + user.id + "/status", {
        method: "POST",
        body: { action: action, reason: reason }
      }).then(function () {
        NX.toast("Account updated.");
        loadUsers();
      }).catch(fail);
    });
  }

  function setUserCredits(user) {
    var current = user.credit_limit || 100000;
    var entered = window.prompt(
      "6-hour token limit for @" + user.username + " (1000 – 10,000,000):",
      String(current)
    );
    if (entered === null) return;
    var limit = Number(entered);
    if (!limit || limit < 1000) return NX.toast("Enter a token limit of at least 1,000.", "error");
    NX.api("/api/admin/users/" + user.id + "/credits", {
      method: "POST",
      body: { limit: limit }
    }).then(function () {
      NX.toast("Credit limit updated.");
      loadUsers();
    }).catch(fail);
  }

  function resetUserCredits(user) {
    NX.confirm("Reset usage?", "Clear @" + user.username + "'s used tokens for the current 6-hour window.", "Reset usage")
      .then(function (ok) {
        if (!ok) return;
        NX.api("/api/admin/users/" + user.id + "/credits", {
          method: "POST",
          body: { reset: true }
        }).then(function () {
          NX.toast("Usage reset.");
          loadUsers();
        }).catch(fail);
      });
  }

  function renderUsers() {
    var container = document.getElementById("admin-users-list");
    container.innerHTML = "";
    if (!state.users.length) {
      container.innerHTML = '<p class="typing">No registered users yet.</p>';
      return;
    }
    state.users.forEach(function (user) {
      var status = user.status || "active";
      var card = document.createElement("article");
      card.className = "admin-user-card status-" + status;

      var head = document.createElement("div");
      head.className = "admin-user-head";
      var avatar = document.createElement("span");
      avatar.className = "avatar avatar-user";
      NX.avatar(avatar, user.display_name || user.username, user.avatar);
      var info = document.createElement("div");
      info.className = "admin-user-info";
      var name = document.createElement("b");
      name.textContent = user.display_name || user.username;
      var username = document.createElement("small");
      username.textContent = "@" + user.username + " · joined " + NX.formatDate(user.created_at);
      info.appendChild(name);
      info.appendChild(username);
      head.appendChild(avatar);
      head.appendChild(info);

      var badge = document.createElement("span");
      badge.className = "badge user-status " + status;
      badge.textContent = status.toUpperCase();
      head.appendChild(badge);

      var stats = document.createElement("div");
      stats.className = "admin-user-stats";
      stats.innerHTML =
        "<span><b>" + user.conversation_count + "</b> chats</span>" +
        "<span><b>" + user.deleted_count + "</b> deleted</span>" +
        "<span><b>" + user.message_count + "</b> messages</span>" +
        "<span><b>" + adminFormatTokens(user.used_tokens) + " / " + adminFormatTokens(user.credit_limit) + "</b> 6h credits</span>";
      card.appendChild(head);
      card.appendChild(stats);

      if (user.nickname || user.ban_reason || user.flags) {
        var meta = document.createElement("div");
        meta.className = "admin-user-meta";
        if (user.nickname) meta.textContent = "Preferred name: " + user.nickname;
        if (user.ban_reason) meta.textContent += (meta.textContent ? " · " : "") + "Reason: " + user.ban_reason;
        if (user.flags) meta.textContent += (meta.textContent ? " · " : "") + user.flags + " moderation flag(s)";
        card.appendChild(meta);
      }

      var actions = document.createElement("div");
      actions.className = "admin-user-actions";
      var view = document.createElement("button");
      view.type = "button";
      view.className = "secondary-btn compact";
      view.textContent = "View chats";
      view.addEventListener("click", function () {
        document.getElementById("admin-user-filter").value = user.id;
        setView("chats");
        loadAdminConversations();
      });
      actions.appendChild(view);

      var credit = document.createElement("button");
      credit.type = "button";
      credit.className = "secondary-btn compact";
      credit.textContent = "Set limit";
      credit.addEventListener("click", function () { setUserCredits(user); });
      actions.appendChild(credit);

      var reset = document.createElement("button");
      reset.type = "button";
      reset.className = "secondary-btn compact";
      reset.textContent = "Reset usage";
      reset.addEventListener("click", function () { resetUserCredits(user); });
      actions.appendChild(reset);

      if (status === "banned") {
        var unban = document.createElement("button");
        unban.type = "button";
        unban.className = "secondary-btn compact";
        unban.textContent = "Unban";
        unban.addEventListener("click", function () { setUserStatus(user, "unban"); });
        actions.appendChild(unban);
      } else if (status === "deleted") {
        var restore = document.createElement("button");
        restore.type = "button";
        restore.className = "secondary-btn compact";
        restore.textContent = "Restore account";
        restore.addEventListener("click", function () { setUserStatus(user, "restore"); });
        actions.appendChild(restore);
      } else {
        var ban = document.createElement("button");
        ban.type = "button";
        ban.className = "danger-btn compact";
        ban.textContent = "Ban";
        ban.addEventListener("click", function () { setUserStatus(user, "ban"); });
        actions.appendChild(ban);

        var restrict = document.createElement("button");
        restrict.type = "button";
        restrict.className = "secondary-btn compact";
        restrict.textContent = status === "restricted" ? "Unrestrict" : "Restrict";
        restrict.addEventListener("click", function () {
          setUserStatus(user, status === "restricted" ? "unrestrict" : "restrict");
        });
        actions.appendChild(restrict);

        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary-btn compact";
        remove.textContent = "Delete";
        remove.addEventListener("click", function () { setUserStatus(user, "delete"); });
        actions.appendChild(remove);
      }

      card.appendChild(actions);
      container.appendChild(card);
    });
  }

  function loadAdminConversations() {
    var query = document.getElementById("admin-search").value;
    var userId = document.getElementById("admin-user-filter").value;
    var includeDeleted = document.getElementById("admin-include-deleted").checked ? "1" : "0";
    var url = "/api/admin/conversations?include_deleted=" + includeDeleted +
      "&q=" + encodeURIComponent(query) + "&user_id=" + encodeURIComponent(userId);

    NX.api(url).then(function (conversations) {
      state.conversations = conversations;
      renderAdminConversations();
      state.mainSelected = {};
      syncMainSelectAll();
      updateMainSelectionCount();
      var sel = document.getElementById("main-selection-toolbar");
      if (sel) sel.parentNode.removeChild(sel);
    }).catch(fail);
  }

  function renderAdminConversations() {
    var container = document.getElementById("admin-chat-list");
    container.innerHTML = "";
    if (!state.conversations.length) {
      container.innerHTML = '<p class="typing">No conversations match these filters.</p>';
      return;
    }
    state.conversations.forEach(function (conversation) {
      var row = document.createElement("div");
      row.className = "admin-chat-row";
      row.tabIndex = 0;
      row.setAttribute("role", "button");

      var main = document.createElement("span");
      main.className = "admin-chat-main";
      var title = document.createElement("b");
      title.textContent = conversation.title || "Untitled conversation";
      var preview = document.createElement("small");
      var owner = conversation.is_admin ? "Administrator" : ("@" + conversation.username);
      preview.textContent = owner + " · " + conversation.message_count + " messages · " +
        (conversation.last_message ? conversation.last_message.replace(/\s+/g, " ").substring(0, 90) : "No messages");
      main.appendChild(title);
      main.appendChild(preview);

      var side = document.createElement("span");
      side.className = "admin-chat-side";
      var badges = document.createElement("span");
      badges.className = "badges";
      if (conversation.deleted) {
        var deleted = document.createElement("span");
        deleted.className = "badge deleted";
        deleted.textContent = "DELETED";
        badges.appendChild(deleted);
      }
      if (conversation.is_admin) {
        var adminBadge = document.createElement("span");
        adminBadge.className = "badge admin";
        adminBadge.textContent = "ADMIN";
        badges.appendChild(adminBadge);
      }
      var live = document.createElement("span");
      live.className = "badge";
      live.textContent = conversation.deleted ? "archived" : "active";
      badges.appendChild(live);
      var time = document.createElement("time");
      time.textContent = NX.formatDateTime(conversation.updated_at);
      side.appendChild(badges);
      side.appendChild(time);

      // Delete icon - visible trash with tooltip
      var deleteIcon = document.createElement("button");
      deleteIcon.type = "button";
      deleteIcon.className = "admin-delete-icon";
      deleteIcon.title = "Delete conversation";
      deleteIcon.innerHTML = NX.icon("trash");
      deleteIcon.addEventListener("click", function (event) {
        event.stopPropagation();
        if (confirm("Delete this conversation move it to Deleted Chats?")) {
          NX.api("/api/admin/conversations/" + conversation.id, { method: "DELETE" })
            .then(function () {
              NX.toast("Conversation moved to Deleted Chats.");
              refreshAdmin();
            })
            .catch(fail);
        }
      });

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.mainSelected[conversation.id] === true;
      checkbox.className = "admin-chat-checkbox";
      checkbox.addEventListener("change", function () {
        state.mainSelected[conversation.id] = checkbox.checked;
        syncMainSelectAll();
        updateMainSelectionCount();
      });

      // Insert checkbox before any existing content in side (badges/time)
      side.insertBefore(checkbox, side.firstChild);
      side.appendChild(deleteIcon);

      var quickDelete = document.createElement("button");
      quickDelete.type = "button";
      quickDelete.className = "admin-row-delete";
      quickDelete.title = "Delete forever";
      quickDelete.setAttribute("aria-label", "Delete conversation forever");
      quickDelete.innerHTML = NX.icon("trash");
      quickDelete.addEventListener("click", function (event) {
        event.stopPropagation();
        purgeConversation(conversation, function () {
          NX.toast("Conversation deleted forever.");
          refreshAll();
        });
      });
      side.appendChild(quickDelete);

      row.appendChild(main);
      row.appendChild(side);
      row.addEventListener("click", function () { openDetail(conversation.id); });
      row.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetail(conversation.id);
        }
      });
      container.appendChild(row);
    });
  }

    function syncMainSelectAll() {
    var total = state.conversations.length;
    var chosen = Object.keys(state.mainSelected).length;
    var selectAll = document.getElementById("main-select-all");
    if (selectAll) {
      selectAll.checked = chosen > 0 && chosen === total;
      selectAll.indeterminate = chosen > 0 && chosen < total;
    }
  }

  function updateMainSelectionCount() {
    var count = Object.keys(state.mainSelected).length;
    var countEl = document.getElementById("main-selection-count");
    if (countEl) {
      countEl.textContent = count + " selected";
    }
    var deleteBtn = document.getElementById("main-delete-selected");
    if (deleteBtn) {
      deleteBtn.disabled = count === 0;
    }
  }

  function renderMainSelectionUI() {
    var count = Object.keys(state.mainSelected).length;
    var html = '';
    html += '<div class="admin-selection-toolbar">';
    html += '  <label class="check-field"><input type="checkbox" id="main-select-all"> Select all</label>';
    html += '  <span id="main-selection-count">' + count + " selected</span>";
    html += '  <button id="main-delete-selected" class="danger-btn compact" type="button" disabled>Delete selected</button>';
    html += '  <button id="main-delete-all" class="danger-btn" type="button">Delete all</button>';
    html += '</div>';
    var toolbar = document.querySelector('.admin-toolbar');
    if (toolbar && !document.getElementById("main-selection-toolbar")) {
      var refreshBtn = document.getElementById("admin-refresh");
      if (refreshBtn) {
        var container = refreshBtn.parentNode;
        var newDiv = document.createElement('div');
        newDiv.id = "main-selection-toolbar";
        newDiv.className = "admin-selection-toolbar";
        newDiv.innerHTML = html;
        container.insertBefore(newDiv, refreshBtn.nextSibling);
      }
    }
  }

  function refreshAdmin() {
    loadAdminConversations();
    state.mainSelected = {};
    syncMainSelectAll();
    updateMainSelectionCount();
    var sel = document.getElementById("main-selection-toolbar");
    if (sel) sel.parentNode.removeChild(sel);
  }

  function purgeConversation(conversation, onDone) {
    NX.confirm(
      "Delete forever?",
      "“" + (conversation.title || "Untitled") + "” and every message in it will be permanently removed for the user too.",
      "Delete forever"
    ).then(function (ok) {
      if (!ok) return;
      NX.api("/api/admin/conversations/" + conversation.id, { method: "DELETE" })
        .then(onDone)
        .catch(fail);
    });
  }

  function openDetail(id) {
    NX.api("/api/admin/conversations/" + id).then(function (conversation) {
      state.detail = conversation;
      document.getElementById("admin-detail-title").textContent = conversation.title || "Conversation";
      document.getElementById("admin-detail-meta").textContent =
        (conversation.is_admin ? "Administrator" : "@" + conversation.username) +
        " · created " + NX.formatDateTime(conversation.created_at) +
        " · " + conversation.messages.length + " messages" +
        (conversation.deleted ? " · deleted " + NX.formatDateTime(conversation.deleted_at) : "");

      var restore = document.getElementById("admin-detail-restore");
      restore.classList.toggle("hidden", !conversation.deleted);

      var container = document.getElementById("admin-detail-messages");
      container.innerHTML = "";
      if (!conversation.messages.length) {
        container.innerHTML = '<p class="typing">This conversation has no messages.</p>';
      } else {
        conversation.messages.forEach(function (message) {
          var row = document.createElement("div");
          row.className = "admin-detail-msg " + message.role;
          var role = document.createElement("span");
          role.className = "role";
          role.textContent = message.role === "assistant" ? "Nexora" : "User";
          var content = document.createElement("div");
          content.className = "content";
          content.innerHTML = message.role === "assistant" ? NX.markdown(message.content) : NX.esc(message.content);
          row.appendChild(role);
          row.appendChild(content);
          container.appendChild(row);
        });
      }
      NX.openModal("admin-detail-modal");
    }).catch(fail);
  }

  function restoreDetail() {
    if (!state.detail) return;
    var id = state.detail.id;
    NX.api("/api/admin/conversations/" + id + "/restore", { method: "POST" }).then(function () {
      NX.toast("Conversation restored.");
      NX.closeModal("admin-detail-modal");
      refreshAll();
    }).catch(fail);
  }

  function purgeDetail() {
    if (!state.detail) return;
    var id = state.detail.id;
    NX.confirm("Delete forever?", "This permanently deletes the conversation and every message in it, for the user too.", "Delete forever")
      .then(function (ok) {
        if (!ok) return;
        NX.api("/api/admin/conversations/" + id, { method: "DELETE" }).then(function () {
          NX.toast("Conversation deleted forever.");
          NX.closeModal("admin-detail-modal");
          refreshAll();
        }).catch(fail);
      });
  }

  /* ---------------- advertisements ---------------- */
  function loadAdminSettings() {
    NX.api("/api/admin/settings").then(function (settings) {
      var toggle = document.getElementById("ads-enabled");
      if (toggle) toggle.checked = !!settings.ads_enabled;
      var signups = document.getElementById("signups-enabled");
      if (signups) signups.checked = !!settings.signups_enabled;
    }).catch(fail);
  }

  function toggleAds(event) {
    var enabled = event.target.checked;
    NX.api("/api/admin/settings", { method: "POST", body: { ads_enabled: enabled } })
      .then(function () {
        NX.toast(enabled ? "Advertisements enabled." : "Advertisements hidden everywhere.");
      })
      .catch(function (error) {
        event.target.checked = !enabled;
        fail(error);
      });
  }

  function loadAds() {
    var container = document.getElementById("admin-ads-list");
    container.innerHTML = '<p class="typing">Loading…</p>';
    NX.api("/api/admin/ads").then(function (ads) {
      state.ads = ads || [];
      renderAds();
    }).catch(fail);
  }

  function renderAds() {
    var container = document.getElementById("admin-ads-list");
    container.innerHTML = "";
    if (!state.ads.length) {
      container.innerHTML = '<p class="typing">No advertisements yet. Add one to show a card at the end of chats.</p>';
      return;
    }
    state.ads.forEach(function (ad) {
      var card = document.createElement("article");
      card.className = "admin-ad-card" + (ad.active ? "" : " inactive");

      var media = document.createElement("div");
      media.className = "admin-ad-media";
      if (ad.image) {
        var img = document.createElement("img");
        img.src = ad.image;
        img.alt = "";
        media.appendChild(img);
      } else {
        media.textContent = NX.initials(ad.title || "Ad");
      }

      var info = document.createElement("div");
      info.className = "admin-ad-info";
      var title = document.createElement("b");
      title.textContent = ad.title;
      var description = document.createElement("small");
      description.textContent = ad.description || "No description";
      var link = document.createElement("a");
      link.href = ad.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = ad.url;
      info.appendChild(title);
      info.appendChild(description);
      info.appendChild(link);

      var side = document.createElement("div");
      side.className = "admin-ad-side";
      var badge = document.createElement("span");
      badge.className = "badge " + (ad.active ? "live" : "");
      badge.textContent = ad.active ? "VISIBLE" : "HIDDEN";
      var order = document.createElement("span");
      order.className = "badge";
      order.textContent = "ORDER " + ad.sort_order;
      var edit = document.createElement("button");
      edit.type = "button";
      edit.className = "secondary-btn compact";
      edit.textContent = "Edit";
      edit.addEventListener("click", function () { openAdEditor(ad); });
      var refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "secondary-btn compact";
      refresh.textContent = "Page preview";
      refresh.addEventListener("click", function () {
        refresh.disabled = true;
        refresh.textContent = "Capturing…";
        NX.api("/api/admin/ads/" + ad.id + "/preview", { method: "POST" }).then(function () {
          NX.toast("Landing page preview updated.");
          loadAds();
        }).catch(function (error) {
          refresh.disabled = false;
          refresh.textContent = "Page preview";
          fail(error);
        });
      });
      side.appendChild(badge);
      side.appendChild(order);
      side.appendChild(refresh);
      side.appendChild(edit);

      card.appendChild(media);
      card.appendChild(info);
      card.appendChild(side);
      container.appendChild(card);
    });
  }

  function openAdEditor(ad) {
    document.getElementById("admin-ad-title").textContent = ad ? "Edit advertisement" : "New advertisement";
    document.getElementById("ad-id").value = ad ? ad.id : "";
    document.getElementById("ad-title").value = ad ? ad.title : "";
    document.getElementById("ad-description").value = ad ? ad.description : "";
    document.getElementById("ad-url").value = ad ? ad.url : "";
    document.getElementById("ad-order").value = ad ? ad.sort_order : (state.ads.length + 1);
    document.getElementById("ad-active").checked = ad ? !!ad.active : true;
    document.getElementById("ad-image").value = "";
    document.getElementById("ad-remove-image").checked = false;
    var preview = document.getElementById("ad-image-preview");
    preview.innerHTML = "";
    if (ad && ad.image) {
      preview.classList.remove("hidden");
      var img = document.createElement("img");
      img.src = ad.image;
      img.alt = "";
      preview.appendChild(img);
    } else {
      preview.classList.add("hidden");
    }
    document.getElementById("ad-delete").classList.toggle("hidden", !ad);
    NX.openModal("admin-ad-modal");
  }

  function previewAdImage() {
    var input = document.getElementById("ad-image");
    var preview = document.getElementById("ad-image-preview");
    if (!input.files || !input.files[0]) return;
    preview.innerHTML = "";
    preview.classList.remove("hidden");
    var img = document.createElement("img");
    img.src = URL.createObjectURL(input.files[0]);
    img.alt = "";
    preview.appendChild(img);
    document.getElementById("ad-remove-image").checked = false;
  }

  function saveAd(event) {
    event.preventDefault();
    var id = document.getElementById("ad-id").value;
    var form = new FormData();
    form.append("title", document.getElementById("ad-title").value);
    form.append("description", document.getElementById("ad-description").value);
    form.append("url", document.getElementById("ad-url").value);
    form.append("sort_order", document.getElementById("ad-order").value || "0");
    form.append("active", document.getElementById("ad-active").checked ? "1" : "0");
    if (document.getElementById("ad-remove-image").checked) form.append("remove_image", "1");
    var image = document.getElementById("ad-image").files && document.getElementById("ad-image").files[0];
    if (image) form.append("image", image);

    var button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    var url = id ? "/api/admin/ads/" + id : "/api/admin/ads";
    NX.api(url, { method: "POST", body: form }).then(function () {
      NX.closeModal("admin-ad-modal");
      NX.toast(id ? "Advertisement updated." : "Advertisement added.");
      loadAds();
    }).catch(function (error) {
      button.disabled = false;
      fail(error);
    });
  }

  function deleteAd() {
    var id = document.getElementById("ad-id").value;
    if (!id) return;
    NX.confirm("Delete advertisement?", "This removes the card from every conversation.", "Delete")
      .then(function (ok) {
        if (!ok) return;
        NX.api("/api/admin/ads/" + id, { method: "DELETE" }).then(function () {
          NX.closeModal("admin-ad-modal");
          NX.toast("Advertisement deleted.");
          loadAds();
        }).catch(fail);
      });
  }

  /* ---------------- admin AI chat ---------------- */
  function loadAdminChats() {
    var searchInput = document.getElementById("admin-ai-search");
    var search = searchInput ? searchInput.value.trim() : "";
    var params = new URLSearchParams();
    params.append("state", "active");
    if (search) params.append("q", search);
    NX.api("/api/admin/ai/conversations?" + params.toString()).then(function (data) {
      state.aiChats = data.conversations || [];
      state.aiCounts = data.counts || state.aiCounts;
      renderAiCounts(state.aiCounts);
      renderAdminChatList(state.aiChats, search);
    }).catch(fail);
  }

  function renderAiCounts(counts) {
    state.aiCounts = counts || state.aiCounts;
    var archived = document.getElementById("ai-archived-count");
    var deleted = document.getElementById("ai-deleted-count");
    if (archived) archived.textContent = state.aiCounts.archived || 0;
    if (deleted) deleted.textContent = state.aiCounts.deleted || 0;
  }

  function renderAdminChatList(conversations, search) {
    var container = document.getElementById("admin-ai-conversations");
    container.innerHTML = "";
    if (!conversations.length) {
      container.innerHTML = '<div class="conversation-empty">' +
        (search ? "No chats match your search." : "No admin chats yet.") + "</div>";
      return;
    }
    conversations.forEach(function (conversation) {
      var item = document.createElement("div");
      item.className = "conversation-item has-menu" +
        (conversation.id === state.ai.currentId ? " active" : "") +
        (conversation.is_pinned ? " pinned" : "");

      var main = document.createElement("button");
      main.type = "button";
      main.className = "conv-main";
      main.innerHTML =
        '<span class="conv-title">' + NX.esc(conversation.title || "Untitled") + "</span>" +
        '<small class="conv-preview">' + NX.esc(conversation.last_message || "No messages yet") + "</small>" +
        '<small class="conv-date">' + (conversation.is_pinned ? NX.icon("pin") + " " : "") +
        NX.formatDateTime(conversation.updated_at) +
        (conversation.model ? " · " + NX.esc(modelShortName(conversation.model)) : "") + "</small>";
      main.addEventListener("click", function () { openAdminChat(conversation.id); });
      item.appendChild(main);

      var dots = document.createElement("button");
      dots.type = "button";
      dots.className = "conv-menu-btn";
      dots.setAttribute("aria-label", "Chat options");
      dots.innerHTML = NX.icon("dots");
      dots.addEventListener("click", function (event) {
        event.stopPropagation();
        toggleConvMenu(conversation, item);
      });
      item.appendChild(dots);
      container.appendChild(item);
    });
  }

  function modelShortName(modelId) {
    var name = (state.models && state.models[modelId]) || modelId || "";
    return name.replace(" — God mode", "").replace(" · God mode", "");
  }

  function toggleConvMenu(conversation, item) {
    var existing = item.querySelector(".conv-menu");
    NX.$$(".conv-menu").forEach(function (menu) { if (menu !== existing) menu.remove(); });
    if (existing) { existing.remove(); return; }
    var menu = document.createElement("div");
    menu.className = "conv-menu";
    var options = [
      { label: "Rename", handler: function () { renameConversation(conversation); } },
      {
        label: conversation.is_pinned ? "Unpin" : "Pin",
        handler: function () { setConversationPin(conversation, !conversation.is_pinned); }
      },
      { label: "Archive", handler: function () { archiveConversation(conversation); } },
      {
        label: "Delete",
        danger: true,
        handler: function () { deleteConversation(conversation); }
      }
    ];
    options.forEach(function (option) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = option.label;
      if (option.danger) button.classList.add("danger");
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        menu.remove();
        option.handler();
      });
      menu.appendChild(button);
    });
    item.appendChild(menu);
  }

  function renameConversation(conversation) {
    var current = conversation.title || "";
    var modal = buildPromptModal("Rename chat", "Choose a clear name for this conversation.", current, "Rename");
    modal.submit(function (value) {
      return NX.api("/api/admin/ai/conversations/" + conversation.id + "/rename",
        { method: "POST", body: { title: value } })
        .then(function () {
          NX.toast("Chat renamed.");
          if (state.ai.currentId === conversation.id) state.ai.title = value;
          loadAdminChats();
        });
    });
  }

  function setConversationPin(conversation, pinned) {
    NX.api("/api/admin/ai/conversations/" + conversation.id + "/pin",
      { method: "POST", body: { pinned: pinned } })
      .then(function () {
        NX.toast(pinned ? "Chat pinned." : "Chat unpinned.");
        loadAdminChats();
      })
      .catch(fail);
  }

  function archiveConversation(conversation) {
    NX.api("/api/admin/ai/conversations/" + conversation.id + "/archive", { method: "POST", body: {} })
      .then(function () {
        NX.toast("Chat archived. Find it under Archived Chats.");
        if (state.ai.currentId === conversation.id) showWelcomeAdmin();
        loadAdminChats();
      })
      .catch(fail);
  }

  function deleteConversation(conversation) {
    NX.confirm("Delete this chat?", "“" + (conversation.title || "Untitled") +
      "” moves to Deleted Chats. You can restore or permanently delete it there.", "Delete chat")
      .then(function (ok) {
        if (!ok) return;
        NX.api("/api/admin/ai/conversations/" + conversation.id, { method: "DELETE" })
          .then(function () {
            NX.toast("Chat moved to Deleted Chats.");
            if (state.ai.currentId === conversation.id) showWelcomeAdmin();
            loadAdminChats();
          })
          .catch(fail);
      });
  }

  function showWelcomeAdmin() {
    state.ai.currentId = null;
    state.ai.title = "";
    state.ai.messages = [];
    document.getElementById("admin-ai-messages").innerHTML = "";
    document.getElementById("admin-ai-empty").classList.remove("hidden");
  }

  /* Archive / trash panels */
  function openPanel(name) {
    if (name !== "archived" && name !== "deleted") return;
    state.ai.panel = name;
    var panel = document.getElementById("admin-ai-panel");
    panel.classList.remove("hidden");
    document.getElementById("admin-ai-messages").classList.add("hidden");
    document.getElementById("admin-ai-empty").classList.add("hidden");
    document.getElementById("admin-chat-form").classList.add("hidden");
    document.getElementById("admin-ai-attachment-tray").classList.add("hidden");
    var restoreButton = document.getElementById("admin-ai-bulk-restore");
    var purgeButton = document.getElementById("admin-ai-bulk-purge");
    if (name === "archived") {
      document.getElementById("admin-ai-panel-title").textContent = "Archived chats";
      document.getElementById("admin-ai-panel-subtitle").textContent =
        "Archived chats stay out of the active list. Restoring returns them with all history intact.";
      restoreButton.textContent = "Unarchive selected";
      purgeButton.textContent = "Delete selected";
    } else {
      document.getElementById("admin-ai-panel-title").textContent = "Deleted chats";
      document.getElementById("admin-ai-panel-subtitle").textContent =
        "Chats stay recoverable here. Restoring returns the original conversation, ID and messages intact.";
      restoreButton.textContent = "Restore selected";
      purgeButton.textContent = "Delete selected forever";
    }
    NX.$$("[data-ai-panel]").forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-ai-panel") === name);
    });
    loadPanelItems();
  }

  function closePanel() {
    state.ai.panel = null;
    state.ai.selected = {};
    state.mainSelected = {};
    document.getElementById("admin-ai-panel").classList.add("hidden");
    document.getElementById("admin-ai-messages").classList.remove("hidden");
    document.getElementById("admin-chat-form").classList.remove("hidden");
    if (!state.ai.messages.length) {
      document.getElementById("admin-ai-empty").classList.remove("hidden");
    }
    NX.$$("[data-ai-panel]").forEach(function (button) {
      button.classList.remove("active");
    });
    var selectAll = document.getElementById("admin-ai-select-all");
    if (selectAll) selectAll.checked = false;
  }

  function loadPanelItems() {
    var name = state.ai.panel;
    if (!name) return;
    var searchInput = document.getElementById("admin-ai-search");
    var search = searchInput ? searchInput.value.trim() : "";
    var url = "/api/admin/ai/conversations?state=" + name + (search ? "&q=" + encodeURIComponent(search) : "");
    NX.api(url).then(function (data) {
      if (state.ai.panel !== name) return;
      state.ai.panelItems = data.conversations || [];
      state.ai.selected = {};
    state.mainSelected = {};
      state.aiCounts = data.counts || state.aiCounts;
      renderAiCounts(state.aiCounts);
      renderPanelItems();
    }).catch(fail);
  }

  function panelCardMeta(conversation) {
    var parts = [];
    if (state.ai.panel === "deleted") {
      parts.push("Deleted " + NX.formatDateTime(conversation.deleted_at));
    } else if (state.ai.panel === "archived") {
      parts.push("Archived " + NX.formatDateTime(conversation.archived_at));
    }
    parts.push("Created " + NX.formatDate(conversation.created_at));
    parts.push("Last activity " + NX.formatDateTime(conversation.updated_at));
    parts.push(conversation.message_count + " message" + (conversation.message_count === 1 ? "" : "s"));
    return parts.join(" · ");
  }

  function renderPanelItems() {
    var container = document.getElementById("admin-ai-panel-list");
    container.innerHTML = "";
    var name = state.ai.panel;
    if (!state.ai.panelItems.length) {
      container.innerHTML = '<div class="admin-empty panel-empty"><img src="/static/img/logo-mark.png" alt="" width="54" height="54">' +
        "<h2>" + (name === "archived" ? "Nothing archived" : "Trash is empty") + "</h2><p>" +
        (name === "archived"
          ? "Archive a chat from its menu and it will appear here."
          : "Deleted chats appear here until they are restored or purged forever.") +
        "</p></div>";
      document.getElementById("admin-ai-bulk-actions").classList.add("hidden");
      return;
    }
    document.getElementById("admin-ai-bulk-actions").classList.remove("hidden");
    state.ai.panelItems.forEach(function (conversation) {
      var card = document.createElement("article");
      card.className = "panel-card";

      var check = document.createElement("input");
      check.type = "checkbox";
      check.className = "panel-check";
      check.checked = !!state.ai.selected[conversation.id];
      check.setAttribute("aria-label", "Select " + (conversation.title || "chat"));
      check.addEventListener("change", function () {
        if (check.checked) state.ai.selected[conversation.id] = true;
        else delete state.ai.selected[conversation.id];
        syncSelectAll();
      });
      card.appendChild(check);

      var info = document.createElement("div");
      info.className = "panel-card-info";
      info.innerHTML =
        "<b>" + NX.esc(conversation.title || "Untitled") + "</b>" +
        "<small>" + NX.esc(conversation.last_message || "No messages yet") + "</small>" +
        "<span>" + NX.esc(panelCardMeta(conversation)) + "</span>";
      card.appendChild(info);

      var actions = document.createElement("div");
      actions.className = "panel-card-actions";
      var restore = document.createElement("button");
      restore.type = "button";
      restore.className = "secondary-btn compact";
      restore.textContent = name === "archived" ? "Unarchive" : "Restore";
      restore.addEventListener("click", function () { panelRestoreOne(conversation); });
      actions.appendChild(restore);

      var drop = document.createElement("button");
      drop.type = "button";
      drop.className = "danger-btn compact";
      drop.textContent = name === "archived" ? "Delete" : "Delete forever";
      drop.addEventListener("click", function () {
        if (name === "archived") {
          softDeletePanelItem(conversation);
        } else {
          purgePanelItem(conversation);
        }
      });
      actions.appendChild(drop);
      card.appendChild(actions);
      container.appendChild(card);
    });
    syncSelectAll();
  }

  function syncSelectAll() {
    var selectAll = document.getElementById("admin-ai-select-all");
    if (!selectAll) return;
    var total = state.ai.panelItems.length;
    var chosen = Object.keys(state.ai.selected).length;
    selectAll.checked = total > 0 && chosen === total;
    selectAll.indeterminate = chosen > 0 && chosen < total;
  }

  function toggleSelectAll(event) {
    var checked = event.target.checked;
    state.ai.selected = {};
    state.mainSelected = {};
    if (checked) {
      state.ai.panelItems.forEach(function (conversation) {
        state.ai.selected[conversation.id] = true;
      });
    }
    renderPanelItems();
  }

  function selectedIds() {
    return Object.keys(state.ai.selected);
  }

  function panelRestoreOne(conversation) {
    if (state.ai.panel === "archived") {
      NX.api("/api/admin/ai/conversations/" + conversation.id + "/unarchive", { method: "POST", body: {} })
        .then(function () {
          NX.toast("Chat returned to the active list.");
          loadPanelItems();
          loadAdminChats();
        })
        .catch(fail);
      return;
    }
    NX.api("/api/admin/ai/conversations/" + conversation.id + "/restore", { method: "POST", body: {} })
      .then(function () {
        NX.toast("Chat restored with its history intact.");
        loadPanelItems();
        loadAdminChats();
      })
      .catch(fail);
  }

  function softDeletePanelItem(conversation) {
    NX.api("/api/admin/ai/conversations/" + conversation.id, { method: "DELETE" })
      .then(function () {
        NX.toast("Chat moved to Deleted Chats.");
        loadPanelItems();
        loadAdminChats();
      })
      .catch(fail);
  }

  function purgePanelItem(conversation) {
    NX.confirm("Permanently delete this chat?",
      "“" + (conversation.title || "Untitled") + "” and all of its messages are removed for good. This cannot be undone.",
      "Delete forever")
      .then(function (ok) {
        if (!ok) return;
        NX.api("/api/admin/ai/conversations/" + conversation.id + "/purge", { method: "DELETE" })
          .then(function () {
            NX.toast("Chat permanently deleted.");
            if (state.ai.currentId === conversation.id) showWelcomeAdmin();
            loadPanelItems();
            loadAdminChats();
          })
          .catch(fail);
      });
  }

  function bulkRun(action, confirmTitle, confirmText, okLabel, doneMessage) {
    var ids = selectedIds();
    if (!ids.length) {
      NX.toast("Select at least one chat first.", "error");
      return;
    }
    var run = function () {
      NX.api("/api/admin/ai/conversations/bulk", { method: "POST", body: { action: action, ids: ids } })
        .then(function (data) {
          NX.toast(doneMessage + " (" + (data.restored || data.purged || data.archived || data.deleted || 0) + " chats)");
          state.ai.selected = {};
    state.mainSelected = {};
          var selectAll = document.getElementById("admin-ai-select-all");
          if (selectAll) selectAll.checked = false;
          loadPanelItems();
          loadAdminChats();
        })
        .catch(fail);
    };
    if (confirmTitle) {
      NX.confirm(confirmTitle, confirmText, okLabel).then(function (ok) {
        if (ok) run();
      });
    } else {
      run();
    }
  }

  function bulkRestore() {
    if (state.ai.panel === "archived") {
      bulkRun("restore", null, "", "", "Chats unarchived.");
    } else {
      bulkRun("restore", null, "", "", "Chats restored.");
    }
  }

  function bulkPurge() {
    if (state.ai.panel === "archived") {
      bulkRun("delete", "Delete selected chats?", "They move to Deleted Chats, where you can restore or purge them.", "Delete", "Chats moved to Deleted Chats.");
    } else {
      bulkRun("purge", "Permanently delete selected chats?",
        "Every selected chat and all of its messages are removed for good. This cannot be undone.",
        "Delete forever", "Chats permanently deleted.");
    }
  }

  function buildPromptModal(title, text, value, okLabel) {
    var overlay = document.createElement("div");
    overlay.className = "modal";
    var card = document.createElement("div");
    card.className = "modal-card prompt-card";
    var head = document.createElement("h2");
    head.textContent = title;
    var copy = document.createElement("p");
    copy.textContent = text;
    var input = document.createElement("input");
    input.type = "text";
    input.maxLength = 120;
    input.value = value || "";
    input.className = "prompt-input";
    var actions = document.createElement("div");
    actions.className = "confirm-actions";
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-btn";
    cancel.textContent = "Cancel";
    var ok = document.createElement("button");
    ok.type = "button";
    ok.className = "primary-btn";
    ok.textContent = okLabel || "Save";
    actions.appendChild(cancel);
    actions.appendChild(ok);
    card.appendChild(head);
    card.appendChild(copy);
    card.appendChild(input);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    setTimeout(function () { input.focus(); input.select(); }, 30);
    var close = function () { if (overlay.parentElement) overlay.parentElement.removeChild(overlay); };
    cancel.addEventListener("click", close);
    overlay.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
      if (event.key === "Enter") ok.click();
    });
    return {
      submit: function (handler) {
        ok.addEventListener("click", function () {
          var value = (input.value || "").trim();
          if (!value) { input.focus(); return; }
          ok.disabled = true;
          handler(value).then(close).catch(function (error) {
            ok.disabled = false;
            fail(error);
          });
        });
      }
    };
  }

  function openAdminChat(id) {
    if (state.ai.busy) return;
    if (state.ai.panel) closePanel();
    NX.api("/api/conversations/" + id).then(function (data) {
      state.ai.currentId = id;
      state.ai.title = data.title || "";
      state.ai.messages = data.messages || [];
      renderAdminMessages();
      loadAdminChats();
    }).catch(fail);
  }

  function newAdminChat() {
    if (state.ai.busy) return;
    if (state.ai.panel) closePanel();
    NX.api("/api/conversations", { method: "POST", body: {} }).then(function (conversation) {
      state.ai.currentId = conversation.id;
      state.ai.title = conversation.title || "";
      state.ai.messages = [];
      document.getElementById("admin-ai-messages").innerHTML = "";
      document.getElementById("admin-ai-empty").classList.remove("hidden");
      loadAdminChats();
      setView("ai");
      el.adminInput.focus();
    }).catch(fail);
  }

  function renderAdminMessages() {
    var container = document.getElementById("admin-ai-messages");
    container.innerHTML = "";
    if (!state.ai.messages.length) {
      document.getElementById("admin-ai-empty").classList.remove("hidden");
      return;
    }
    document.getElementById("admin-ai-empty").classList.add("hidden");
    var lastAssistant = -1;
    for (var i = 0; i < state.ai.messages.length; i++) {
      if (state.ai.messages[i].role === "assistant") lastAssistant = i;
    }
    for (var j = 0; j < state.ai.messages.length; j++) {
      var message = state.ai.messages[j];
      addAdminMessage(message.role, message.content, {
        id: message.id,
        created_at: message.created_at,
        regenerate: message.role === "assistant" && j === lastAssistant
      });
    }
    container.scrollTop = container.scrollHeight;
  }

  function addAdminMessage(role, content, options) {
    options = options || {};
    var container = document.getElementById("admin-ai-messages");
    var wrap = document.createElement("div");
    wrap.className = "message " + role;
    if (options.id) wrap.setAttribute("data-id", String(options.id));
    wrap._raw = content || "";

    var avatar = document.createElement("span");
    avatar.className = "avatar" + (role === "assistant" ? " assistant-avatar" : "");
    if (role === "assistant") {
      avatar.innerHTML = '<img src="/static/img/logo-mark.png" alt="">';
    } else {
      avatar.textContent = "A";
    }

    var body = document.createElement("div");
    body.className = "msg-body";
    var head = document.createElement("div");
    head.className = "msg-head";
    var name = document.createElement("b");
    name.textContent = role === "assistant" ? "Nexora" : "Administrator";
    var time = document.createElement("span");
    time.textContent = options.created_at ? NX.formatTime(options.created_at) : "now";
    head.appendChild(name);
    head.appendChild(time);

    var bubble = document.createElement("div");
    bubble.className = "bubble";
    if (options.streaming) bubble.innerHTML = '<span class="typing">Thinking…</span>';
    else if (role === "assistant") bubble.innerHTML = NX.markdown(content);
    else bubble.innerHTML = NX.esc(content).replace(/\n/g, "<br>");

    var actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.appendChild(actionButton("Copy", function () {
      NX.copyText(wrap._raw).then(function (ok) { NX.toast(ok ? "Message copied." : "Copy unavailable.", ok ? "" : "error"); });
    }));
    if (role === "user" && options.id) {
      actions.appendChild(actionButton("Edit", function () { startAdminEdit(wrap, bubble, body, options.id); }));
    }
    if (role === "assistant" && options.regenerate) {
      actions.appendChild(actionButton("Regenerate", function () { regenerateAdmin(wrap); }));
    }

    body.appendChild(head);
    body.appendChild(bubble);
    body.appendChild(actions);
    wrap.appendChild(avatar);
    wrap.appendChild(body);
    container.appendChild(wrap);
    document.getElementById("admin-ai-empty").classList.add("hidden");
    container.scrollTop = container.scrollHeight;
    return { el: wrap, bubble: bubble, body: body };
  }

  function actionButton(label, handler) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "msg-action";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function startAdminEdit(wrap, bubble, body, id) {
    if (state.ai.busy) return;
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

    cancel.addEventListener("click", function () { body.replaceChild(bubble, box); });
    save.addEventListener("click", function () {
      var text = (area.value || "").replace(/^\s+|\s+$/g, "");
      if (!text) return NX.toast("Message cannot be empty.", "error");
      while (wrap.nextSibling) document.getElementById("admin-ai-messages").removeChild(wrap.nextSibling);
      wrap._raw = text;
      bubble.innerHTML = NX.esc(text).replace(/\n/g, "<br>");
      body.replaceChild(bubble, box);
      runAdminChat({ edit_message_id: id, message: text });
    });
  }

  function regenerateAdmin(wrap) {
    if (state.ai.busy || !state.ai.currentId) return;
    var id = wrap.getAttribute("data-id");
    while (wrap.nextSibling) document.getElementById("admin-ai-messages").removeChild(wrap.nextSibling);
    document.getElementById("admin-ai-messages").removeChild(wrap);
    state.ai.messages = state.ai.messages.filter(function (message) { return Number(message.id) !== Number(id); });
    runAdminChat({ regenerate: true });
  }

  function sendAdminMessage(text) {
    if (state.ai.busy) return;
    text = (text || "").replace(/^\s+|\s+$/g, "");
    if (!text) return;
    var fileIds = state.ai.attachments.map(function (file) { return file.id; });
    var go = function () {
      var attachmentList = fileIds.length ? fileIds.map(function (id) {
        var att = state.ai.attachments.find(function (a) { return a.id === id; });
        return { name: att ? att.name : "file" };
      }) : [];
      addAdminMessage("user", text, { meta: attachmentList.length ? { attachments: attachmentList } : null });
      el.adminInput.value = "";
      NX.autoGrow(el.adminInput);
      var tray = document.getElementById("admin-ai-attachment-tray");
      if (tray) { tray.innerHTML = ""; tray.classList.add("hidden"); }
      state.ai.attachments = [];
      setAdminImageMode(false);
      runAdminChat({ message: text });
    };
    if (!state.ai.currentId) {
      NX.api("/api/conversations", { method: "POST", body: {} }).then(function (conversation) {
        state.ai.currentId = conversation.id;
        state.ai.title = conversation.title || "";
        return loadAdminChats();
      }).then(go).catch(fail);
    } else {
      go();
    }
  }

  function runAdminChat(payload) {
    if (!state.ai.currentId) return;
    var assistant = addAdminMessage("assistant", "", { streaming: true });
    var answer = "";
    var reasoning = "";
    state.ai.busy = true;
    updateAdminComposer();

    // Administrator model preferences (persisted server-side) are applied to
    // every message. No silent fallback: the selected model is sent as-is and
    // API failures surface as clear error messages.
    var prefs = state.ai.prefs || {};
    var request = Object.assign({
      conversation_id: state.ai.currentId,
      model: prefs.model || state.defaultModel,
      temperature: typeof prefs.temperature === "number" ? prefs.temperature : 0.7,
      max_tokens: prefs.max_tokens || 32768,
      think: !!prefs.think,
      file_ids: state.ai.attachments.map(function (f) { return f.id; }),
      web_search: state.ai.webSearch,
      image_mode: state.ai.imageMode,
      aspect_ratio: state.ai.aspectRatio || "1:1"
    }, payload);

    state.ai.stream = NX.streamChat(request, {
      onReasoning: function (text) {
        reasoning += text;
        if (!answer) {
          assistant.bubble.innerHTML = '<div class="thinking">' + NX.esc(reasoning) + "</div>";
          scrollAdmin();
        }
      },
      onToken: function (text) {
        answer += text;
        assistant.bubble.innerHTML = NX.markdown(answer);
        scrollAdmin();
      },
      onDone: function () { finishAdminChat(answer, reasoning, assistant, true); },
      onAbort: function () { finishAdminChat(answer, reasoning, assistant, true); },
      onError: function (error) {
        assistant.bubble.innerHTML = '<p class="error-text">' + NX.esc(error.message) + "</p>";
        state.ai.busy = false;
        state.ai.stream = null;
        updateAdminComposer();
        NX.toast(error.message, "error");
      },
      onAuthError: function () {
        el.app.classList.add("hidden");
        el.login.classList.remove("hidden");
      }
    });
  }

  function finishAdminChat(answer, reasoning, assistant, refresh) {
    state.ai.busy = false;
    state.ai.stream = null;
    updateAdminComposer();
    if (!answer && reasoning) {
      assistant.bubble.innerHTML = '<div class="thinking">' + NX.esc(reasoning) + "</div>" +
        '<p class="typing">The model stopped while thinking.</p>';
      return;
    }
    if (!answer) {
      assistant.bubble.innerHTML = '<p class="typing">No response received.</p>';
      return;
    }
    if (refresh) setTimeout(refreshAdminChat, 350);
  }

  function refreshAdminChat() {
    if (!state.ai.currentId) return;
    var id = state.ai.currentId;
    NX.api("/api/conversations/" + id).then(function (data) {
      if (state.ai.currentId !== id) return;
      state.ai.title = data.title || "";
      state.ai.messages = data.messages || [];
      renderAdminMessages();
      loadAdminChats();
    }).catch(function () {});
  }

  function scrollAdmin() {
    var container = document.getElementById("admin-ai-messages");
    if (container) container.scrollTop = container.scrollHeight;
  }

  function updateAdminComposer() {
    document.getElementById("admin-send").disabled = state.ai.busy;
    document.getElementById("admin-stop").classList.toggle("hidden", !state.ai.busy);
    var status = document.getElementById("admin-ai-model-status");
    if (status) {
      status.textContent = state.ai.busy ? "Generating…" : "Ready";
      status.classList.toggle("busy", state.ai.busy);
    }
    var dot = document.getElementById("admin-ai-status-dot");
    if (dot) dot.classList.toggle("busy", state.ai.busy);
  }

  /* ---------------- admin model preferences ---------------- */
  function fillModelSelect(select, models, selectedId) {
    if (!select) return;
    select.innerHTML = "";
    (models || []).forEach(function (model) {
      var option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.name + " · " + model.provider;
      if (model.id === selectedId) option.selected = true;
      select.appendChild(option);
    });
    if (selectedId && select.value !== selectedId) {
      var fallback = document.createElement("option");
      fallback.value = selectedId;
      fallback.textContent = selectedId;
      fallback.selected = true;
      select.appendChild(fallback);
    }
  }

  function updateModelLabel() {
    var prefs = state.ai.prefs;
    if (!prefs) return;
    var select = document.getElementById("admin-ai-model");
    if (select && select.value !== prefs.model) select.value = prefs.model;
    var prefsSelect = document.getElementById("prefs-model");
    if (prefsSelect && prefsSelect.value !== prefs.model) prefsSelect.value = prefs.model;
    var statusRow = document.getElementById("prefs-model-status");
    if (statusRow) {
      statusRow.textContent = (state.models && state.models[prefs.model] || prefs.model) +
        " · NVIDIA · Ready";
    }
  }

  function loadAiPrefs() {
    NX.api("/api/admin/ai/prefs").then(function (data) {
      state.ai.prefs = {
        model: data.model,
        temperature: data.temperature,
        max_tokens: data.max_tokens,
        think: data.think
      };
      fillModelSelect(document.getElementById("admin-ai-model"), data.models, data.model);
      fillModelSelect(document.getElementById("prefs-model"), data.models, data.model);
      updateModelLabel();
      syncPrefsModal();
    }).catch(fail);
  }

  function syncPrefsModal() {
    var prefs = state.ai.prefs;
    if (!prefs) return;
    var temperature = document.getElementById("prefs-temperature");
    var maxTokens = document.getElementById("prefs-max-tokens");
    var think = document.getElementById("prefs-think");
    if (temperature) temperature.value = prefs.temperature;
    if (maxTokens) maxTokens.value = prefs.max_tokens;
    if (think) think.checked = !!prefs.think;
  }

  function openModelSettings() {
    syncPrefsModal();
    updateModelLabel();
    NX.openModal("admin-ai-model-modal");
  }

  function savePrefs(patch) {
    return NX.api("/api/admin/ai/prefs", { method: "POST", body: patch }).then(function (data) {
      state.ai.prefs = Object.assign({}, state.ai.prefs, data.prefs);
      updateModelLabel();
      syncPrefsModal();
      return data;
    }).catch(function (error) {
      fail(error);
      loadAiPrefs();
      throw error;
    });
  }

  function savePrefsForm(event) {
    event.preventDefault();
    var model = document.getElementById("prefs-model").value;
    var temperature = parseFloat(document.getElementById("prefs-temperature").value);
    var maxTokens = parseInt(document.getElementById("prefs-max-tokens").value, 10);
    var think = document.getElementById("prefs-think").checked;
    if (isNaN(temperature) || temperature < 0 || temperature > 2) {
      return NX.toast("Temperature must be between 0 and 2.", "error");
    }
    if (isNaN(maxTokens) || maxTokens < 256 || maxTokens > 32768) {
      return NX.toast("Output limit must be between 256 and 32768.", "error");
    }
    savePrefs({ model: model, temperature: temperature, max_tokens: maxTokens, think: think })
      .then(function () {
        NX.toast("Model settings saved. New messages will use " + modelShortName(model) + ".");
        NX.closeModal("admin-ai-model-modal");
      })
      .catch(function () {});
  }

  /* ---------------- admin profile ---------------- */
  function loadAdminProfile() {
    NX.api("/api/admin/profile").then(function (data) {
      state.profile = data;
      NX.avatar(document.getElementById("admin-profile-avatar"), data.display_name, data.avatar);
      NX.avatar(document.getElementById("admin-dropdown-avatar"), data.display_name, data.avatar);
      document.getElementById("admin-dropdown-name").textContent = data.display_name;
      document.getElementById("profile-display-name").value = data.display_name || "";
      document.getElementById("profile-username").value = data.username || "admin";
      document.getElementById("profile-email").value = data.email || "";
      NX.avatar(document.getElementById("profile-avatar-preview"), data.display_name, data.avatar);
      var meta = [];
      meta.push("Account created " + NX.formatDate(data.created_at));
      if (data.updated_at) meta.push("Updated " + NX.formatDateTime(data.updated_at));
      meta.push(data.custom_password ? "Custom password in use" : "Using the .env administrator password");
      document.getElementById("profile-meta").textContent = meta.join(" · ");
      var perms = document.getElementById("profile-permissions");
      perms.innerHTML = "";
      (data.permissions || []).forEach(function (permission) {
        var li = document.createElement("li");
        li.textContent = permission;
        perms.appendChild(li);
      });
    }).catch(fail);
  }

  function handleProfileAction(action) {
    if (action === "profile") {
      switchProfileTab("profile");
      loadAdminProfile();
      NX.openModal("admin-profile-modal");
    } else if (action === "security") {
      switchProfileTab("security");
      loadAdminProfile();
      NX.openModal("admin-profile-modal");
    } else if (action === "settings") {
      NX.openModal("admin-settings-modal");
    } else if (action === "signout") {
      NX.confirm("Sign out of admin?", "You can sign back in with the administrator password.", "Sign out")
        .then(function (ok) {
          if (!ok) return;
          NX.api("/api/admin/logout", { method: "POST", body: {} }).then(function () {
            window.location.href = "/admin";
          }).catch(function () { window.location.href = "/admin"; });
        });
    }
  }

  function switchProfileTab(name) {
    NX.$$("[data-profile-tab]").forEach(function (tab) {
      tab.classList.toggle("active", tab.getAttribute("data-profile-tab") === name);
    });
    document.getElementById("profile-tab-profile").classList.toggle("hidden", name !== "profile");
    document.getElementById("profile-tab-security").classList.toggle("hidden", name !== "security");
  }

  function saveAdminProfile(event) {
    event.preventDefault();
    var displayName = document.getElementById("profile-display-name").value.trim();
    var email = document.getElementById("profile-email").value.trim();
    NX.api("/api/admin/profile", {
      method: "POST",
      body: { display_name: displayName, email: email }
    }).then(function () {
      NX.toast("Profile saved.");
      loadAdminProfile();
    }).catch(fail);
  }

  function uploadProfileAvatar(file) {
    if (!file) return;
    var form = new FormData();
    form.append("avatar", file);
    NX.api("/api/admin/profile/avatar", { method: "POST", body: form })
      .then(function () {
        NX.toast("Profile picture updated.");
        loadAdminProfile();
      })
      .catch(fail);
  }

  function changeAdminPassword(event) {
    event.preventDefault();
    var body = {
      current_password: document.getElementById("profile-current-password").value,
      new_password: document.getElementById("profile-new-password").value,
      confirm_password: document.getElementById("profile-confirm-password").value
    };
    if (body.new_password !== body.confirm_password) {
      NX.toast("New passwords do not match.", "error");
      return;
    }
    NX.api("/api/admin/profile/password", { method: "POST", body: body })
      .then(function () {
        NX.toast("Password changed. Use the new password next time you sign in.");
        document.getElementById("profile-current-password").value = "";
        document.getElementById("profile-new-password").value = "";
        document.getElementById("profile-confirm-password").value = "";
        loadAdminProfile();
      })
      .catch(fail);
  }

  function signOutOthers() {
    NX.confirm("Sign out other sessions?",
      "Every other administrator session is signed out. This device stays signed in.", "Sign out others")
      .then(function (ok) {
        if (!ok) return;
        NX.api("/api/admin/profile/signout-others", { method: "POST", body: {} })
          .then(function () {
            NX.toast("Other sessions signed out.");
          })
          .catch(fail);
      });
  }

  function openMenu() {
    document.getElementById("admin-sidebar").classList.add("open");
    document.getElementById("admin-scrim").classList.remove("hidden");
  }

  function closeMenu() {
    document.getElementById("admin-sidebar").classList.remove("open");
    document.getElementById("admin-scrim").classList.add("hidden");
  }
})();
