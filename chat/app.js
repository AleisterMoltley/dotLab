(function () {
  var log = document.getElementById("log");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  var projectEl = document.getElementById("project");
  var history = [];

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "msg " + role;
    el.innerHTML =
      '<div class="role">' + (role === "user" ? "You" : "Gamemaster") + "</div>" +
      '<div class="body"></div>';
    el.querySelector(".body").textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el.querySelector(".body");
  }

  window.GM.send = function () {
    var text = (input && input.value || "").replace(/^\s+|\s+$/g, "");
    if (!text || (sendBtn && sendBtn.disabled)) return false;
    document.body.classList.add("has-chat");
    input.value = "";
    addMsg("user", text);
    var extra = projectEl && projectEl.value ? "\n\nExisting project: " + projectEl.value : "";
    history.push({ role: "user", content: text + extra });
    var body = addMsg("bot", "Writing the game…");
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "Working…"; }

    fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{
          role: "system",
          content: "You are Gamemaster. Write a playable Three.js game. Complete files. Short intro, then code. CONFIG feel numbers. fog = background.",
        }].concat(history.slice(-8)),
      }),
    })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || r.status); return d; }); })
      .then(function (d) {
        var t = d.text || d.error || "No reply";
        body.textContent = t;
        history.push({ role: "assistant", content: t });
      })
      .catch(function (e) {
        body.textContent = "Could not reach the model. Keep the Gamemaster terminal open and check Ollama.app.\n\n" + e.message;
      })
      .then(function () {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "Make this game"; }
        if (input) input.focus();
        log.scrollTop = log.scrollHeight;
      });
    return false;
  };

  document.querySelectorAll("[data-fill]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!input) return;
      input.value = btn.getAttribute("data-fill") || "";
      input.focus();
    });
  });

  if (input) {
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        window.GM.send();
      }
    });
  }

  var more = document.getElementById("more");
  var btnMore = document.getElementById("btnMore");
  var moreClose = document.getElementById("moreClose");
  if (btnMore && more) btnMore.onclick = function () { more.classList.add("show"); };
  if (moreClose && more) moreClose.onclick = function () { more.classList.remove("show"); };

  if (projectEl) {
    try {
      projectEl.value = localStorage.getItem("gm.project") || "";
      projectEl.addEventListener("change", function () {
        localStorage.setItem("gm.project", projectEl.value);
      });
    } catch (e) {}
  }

  var ghModal = document.getElementById("ghModal");
  var ghBtn = document.getElementById("btnGh");
  if (ghBtn && ghModal) {
    ghBtn.onclick = function () {
      if (more) more.classList.remove("show");
      ghModal.classList.add("show");
    };
  }
  var ghClose = document.getElementById("ghClose");
  if (ghClose && ghModal) ghClose.onclick = function () { ghModal.classList.remove("show"); };

  var ghLogin = document.getElementById("ghLogin");
  if (ghLogin) {
    ghLogin.onclick = function () {
      fetch("/api/github/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var lead = document.getElementById("ghLead");
          if (!lead) return;
          if (d.user_code) lead.textContent = "Enter " + d.user_code + " at github.com/login/device";
          else if (d.logged_in) lead.textContent = "Signed in as @" + d.user;
          else lead.textContent = d.error || "Could not start login";
        });
    };
  }
  var ghShip = document.getElementById("ghShip");
  if (ghShip) {
    ghShip.onclick = function () {
      var project = (document.getElementById("ghProject").value || (projectEl && projectEl.value) || "").trim();
      var err = document.getElementById("ghErr");
      if (!project) { err.textContent = "Need a folder path."; return; }
      fetch("/api/github/ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: project,
          message: document.getElementById("ghMsg").value || "vertical slice",
          private: true,
        }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        err.textContent = d.ok ? (d.html_url || "Shipped") : (d.error || "failed");
      });
    };
  }

  if (input) input.focus();
})();
