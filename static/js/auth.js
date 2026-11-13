/* Nexora AI — login and registration page. */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    var config = window.NEXORA_AUTH || { mode: "login" };
    var form = document.getElementById("auth-form");
    if (!form) return;

    var username = document.getElementById("username");
    var password = document.getElementById("password");
    var displayName = document.getElementById("display-name");
    var confirmPassword = document.getElementById("confirm-password");
    var errorBox = document.getElementById("auth-error");
    var submit = document.getElementById("auth-submit");

    if (config.mode === "register") {
      var displayField = document.getElementById("display-name-field");
      var confirmField = document.getElementById("confirm-field");
      if (displayField) displayField.classList.add("wanted");
      if (confirmField) confirmField.classList.add("wanted");
    }

    function showError(message) {
      if (errorBox) errorBox.textContent = message || "";
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      showError("");

      var user = (username.value || "").replace(/^\s+|\s+$/g, "");
      var pass = password.value || "";
      if (!user) return showError("Please enter your username.");
      if (!pass) return showError("Please enter your password.");

      var body = { username: user, password: pass };
      if (config.mode === "register") {
        if (pass.length < 8) return showError("Password must be at least 8 characters.");
        if (confirmPassword.value !== pass) return showError("Passwords do not match.");
        body.display_name = (displayName.value || "").replace(/^\s+|\s+$/g, "");
      }

      submit.disabled = true;
      submit.textContent = config.mode === "register" ? "Creating account…" : "Signing in…";

      NX.api(config.mode === "register" ? "/api/register" : "/api/login", {
        method: "POST",
        body: body
      }).then(function () {
        window.location.href = "/";
      }).catch(function (error) {
        showError(error.message || "Something went wrong. Try again.");
        submit.disabled = false;
        submit.textContent = config.mode === "register" ? "Create account" : "Sign in";
      });
    });

    if (username) username.addEventListener("input", function () { showError(""); });
    if (password) password.addEventListener("input", function () { showError(""); });
  });
})();
