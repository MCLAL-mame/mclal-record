(function () {
  "use strict";

  // ====== 管理密码（部署前建议改掉这一行）======
  var ADMIN_PASS = "200106";

  var STORE_KEY = "recsite-data-v3";
  var THEME_KEY = "recsite-theme";

  // ====== 默认示例数据 ======
  var SEED = {
    boards: [
      { key: "games", name: "游戏", emoji: "🎮", statuses: ["玩过", "在玩", "想玩"], years: ["2026", "2025"], categories: ["PS", "NS", "PC"] },
      { key: "film",  name: "影视", emoji: "🎬", statuses: ["待看", "看了", "在看"], years: ["2026", "2025"], categories: ["番剧", "电视剧", "电影"] },
      { key: "books", name: "书籍", emoji: "📚", statuses: ["待看", "看了", "在看"], years: ["2026", "2025"], categories: ["小说", "漫画", "其他"] }
    ],
    records: {
      "games::2026": [
        { id: "g1", title: "塞尔达传说：王国之泪", rating: 9.5, status: "玩过", date: "2026-08-20", category: "NS",
          review: "开放世界天花板，究极手+余料建造把物理引擎玩出花。肝了200小时依然意犹未尽，海拉鲁的每个角落都有惊喜。", cover: "" },
        { id: "g2", title: "艾尔登法环", rating: 8.5, status: "在玩", date: "2026-09-01", category: "PC",
          review: "受苦但上头，地图设计教科书级别。", cover: "" }
      ],
      "film::2026": [
        { id: "f1", title: "奥本海默", rating: 9, status: "看了", date: "2026-08-30",
          review: "视听震撼，IMAX 必看。诺兰把复杂历史拍出了压迫感与史诗感。", cover: "" }
      ],
      "books::2026": [
        { id: "b1", title: "人类简史", rating: 8.5, status: "看了", date: "2026-07-15",
          review: "认知革命讲得真清楚，一口气读完。", cover: "" },
        { id: "b2", title: "万历十五年", rating: 0, status: "在看", date: "2026-09-02",
          review: "", cover: "" }
      ]
    }
  };

  // ====== 云端同步（GitHub，令牌仅存本机浏览器）======
  var CONFIG = window.CONFIG || null;
  var remoteSha = null;
  function ghToken() { try { return localStorage.getItem("recsite-gh-token") || ""; } catch (e) { return ""; } }
  function b64encode(s) { return btoa(unescape(encodeURIComponent(s))); }
  function b64decode(s) { return decodeURIComponent(escape(atob(s))); }
  function apiUrl() {
    return CONFIG ? "https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo + "/contents/" + CONFIG.file : null;
  }
  function ghHeaders(extra) {
    var h = { "Accept": "application/vnd.github+json" };
    var tk = ghToken();
    if (tk) h["Authorization"] = "Bearer " + tk;
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }
  function loadRemote() {
    var u = apiUrl(); if (!u) return;
    fetch(u, { headers: ghHeaders() }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.content) return;
      try {
        var obj = JSON.parse(b64decode(j.content));
        ensureIds(obj);
        data = obj; remoteSha = j.sha; save(); render();
      } catch (e) {}
    }).catch(function () {});
  }
  function pushRemote() {
    var u = apiUrl(), tk = ghToken();
    if (!u) return;
    if (!tk) { alert("请先在管理模式点「设置令牌」填入 GitHub 个人访问令牌（PAT，需 repo 权限）。"); return; }
    // 取当前 SHA 时必须带令牌：未认证 GET 限额仅 60 次/小时，超限会 403，
    // 导致 sha 缺失、PUT 变成“更新却无 sha”而被 GitHub 拒收（HTTP 422）。
    fetch(u, { headers: ghHeaders() }).then(function (r) {
      if (!r.ok) throw new Error("读取远端失败 HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      var sha = j && j.sha ? j.sha : undefined;
      return fetch(u, {
        method: "PUT",
        headers: ghHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message: "update via site", content: b64encode(JSON.stringify(data, null, 2)), sha: sha })
      });
    }).then(function (r) {
      if (!r || !r.ok) {
        return r.json().then(function (err) {
          throw new Error("HTTP " + r.status + " " + (err && err.message ? err.message : ""));
        }, function () { throw new Error("HTTP " + (r && r.status)); });
      }
      return r.json();
    }).then(function (j) { remoteSha = j.sha; })
      .catch(function (e) { alert("同步到 GitHub 失败，已保存到本机。错误：" + e.message); });
  }

  // ====== 状态 ======
  var data = load();
  var state = { board: data.boards[0].key, year: "全部", query: "", status: "", sort: "date_desc", admin: false };
  var editing = { entryId: null };
  var detailId = null;
  var currentCoverPos = "50% 50%";

  var $ = function (id) { return document.getElementById(id); };
  var grid = $("grid"), empty = $("empty"), tabs = $("tabs"), yearTabs = $("yearTabs");
  var search = $("search"), filter = $("filter"), adminBar = $("adminBar");

  // ====== 工具 ======
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    ensureIds(SEED);
    return JSON.parse(JSON.stringify(SEED));
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {} }
  function ensureIds(obj) {
    Object.keys(obj.records).forEach(function (k) {
      obj.records[k].forEach(function (it, i) { if (!it.id) it.id = k + "-" + i + "-" + Date.now(); });
    });
  }
  function boardOf(key) { return data.boards.filter(function (b) { return b.key === key; })[0]; }
  function rkey(boardKey, year) { return boardKey + "::" + year; }
  function recList(boardKey, year) {
    if (year === "全部") {
      var out = [];
      Object.keys(data.records).forEach(function (k) {
        if (k.indexOf(boardKey + "::") === 0) out = out.concat(data.records[k]);
      });
      return out;
    }
    return data.records[rkey(boardKey, year)] || [];
  }
  function findRecord(id) {
    var keys = Object.keys(data.records);
    for (var i = 0; i < keys.length; i++) {
      var arr = data.records[keys[i]];
      for (var j = 0; j < arr.length; j++) if (arr[j].id === id) {
        var parts = keys[i].split("::");
        return { rec: arr[j], boardKey: parts[0], year: parts[1] };
      }
    }
    return null;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function stars10(rating) {
    var v = (Number(rating) || 0) / 2;           // 1-10 -> 0-5
    var full = Math.floor(v), half = v - full >= 0.5;
    return "★".repeat(full) + (half ? "⯪" : "") + "☆".repeat(5 - full - (half ? 1 : 0));
  }
  function brief(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n) + "…" : s;
  }
  var CAT_COLORS = {
    "PS": "#3f72b0", "NS": "#c0504d", "PC": "#4f8f63",
    "番剧": "#d98324", "电视剧": "#8a5cc4", "电影": "#2a9d8f",
    "小说": "#6b7c2a", "漫画": "#c46a2b", "其他": "#7a7a72"
  };
  function catBadge(c) {
    if (!c) return "";
    var col = CAT_COLORS[c] || "#7a7a72";
    return '<span class="cat" style="background:' + col + '1f;color:' + col + ';border:1px solid ' + col + '55">' + escapeHtml(c) + "</span>";
  }
  function sortList(list) {
    var s = state.sort;
    if (s === "rating_desc") list.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
    else if (s === "rating_asc") list.sort(function (a, b) { return (a.rating || 0) - (b.rating || 0); });
    else if (s === "date_asc") list.sort(function (a, b) { return (a.date || "").localeCompare(b.date || ""); });
    else if (s === "title") list.sort(function (a, b) { return (a.title || "").localeCompare(b.title || "", "zh"); });
    else list.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
  }

  // ====== 渲染 ======
  function renderTabs() {
    tabs.innerHTML = data.boards.map(function (b) {
      var cnt = recList(b.key, "全部").length;
      var active = b.key === state.board ? " active" : "";
      return '<button class="tab' + active + '" data-key="' + b.key + '">' +
        escapeHtml(b.emoji) + " " + escapeHtml(b.name) +
        ' <span class="count">' + cnt + "</span></button>";
    }).join("");
  }
  function renderYearTabs() {
    var b = boardOf(state.board);
    var yrs = (b.years || []).slice();
    var items = ["全部"].concat(yrs);
    yearTabs.innerHTML = items.map(function (y) {
      var active = y === state.year ? " active" : "";
      return '<button class="year-tab' + active + '" data-year="' + escapeHtml(y) + '">' + escapeHtml(y) + "</button>";
    }).join("");
  }
  function refreshFilter() {
    var b = boardOf(state.board);
    filter.innerHTML = '<option value="">全部状态</option>' +
      (b.statuses || []).map(function (s) {
        return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + "</option>";
      }).join("");
    state.status = "";
  }
  function renderGrid() {
    var b = boardOf(state.board);
    var list = recList(state.board, state.year).slice();
    var q = state.query.trim().toLowerCase();
    if (q) list = list.filter(function (it) {
      return (it.title + " " + (it.review || "")).toLowerCase().indexOf(q) !== -1;
    });
    if (state.status) list = list.filter(function (it) { return it.status === state.status; });
    sortList(list);

    grid.innerHTML = list.map(function (it) {
      var cover = it.cover
        ? '<div class="cover"><img src="' + escapeHtml(it.cover) + '" alt="" style="width:100%;height:100%;object-fit:cover;object-position:' + escapeHtml(it.coverPos || "50% 50%") + '"></div>'
        : '<div class="cover">' + escapeHtml(b.emoji) + "</div>";
      var score = it.rating > 0
        ? '<span class="stars">' + stars10(it.rating) + '</span><span class="score">' + Number(it.rating) + "/10</span>" : "";
      var note = it.review ? '<p class="note">' + escapeHtml(brief(it.review, 40)) + "</p>" : "";
      var date = it.date ? '<span class="date">' + escapeHtml(it.date) + "</span>" : "";
      var actions = state.admin
        ? '<div class="card-actions">' +
            '<button class="mini" data-edit="' + it.id + '">✏️</button>' +
            '<button class="mini" data-del="' + it.id + '">🗑</button>' +
          "</div>" : "";
      return '<article class="card" data-detail="' + it.id + '">' + cover +
        '<div class="card-body">' +
          '<div class="card-head"><h3 class="card-title">' + escapeHtml(it.title || "（无标题）") + "</h3>" + actions + "</div>" +
          '<div class="card-meta">' + catBadge(it.category) + '<span class="badge">' + escapeHtml(it.status || "") + "</span>" + score + "</div>" +
          note + date +
        "</div></article>";
    }).join("");
    empty.hidden = list.length !== 0;
  }
  function render() { renderTabs(); renderYearTabs(); refreshFilter(); renderGrid(); }

  // ====== 详情弹窗 ======
  function openDetail(id) {
    var f = findRecord(id); if (!f) return;
    var b = boardOf(f.boardKey), it = f.rec;
    detailId = id;
    $("detailCover").innerHTML = it.cover
      ? '<img src="' + escapeHtml(it.cover) + '" alt="" style="width:100%;height:100%;object-fit:cover;object-position:' + escapeHtml(it.coverPos || "50% 50%") + ';border-radius:12px">'
      : escapeHtml(b.emoji);
    $("detailTitle").textContent = it.title || "（无标题）";
    var score = it.rating > 0
      ? '<span class="stars">' + stars10(it.rating) + '</span><span class="score">' + Number(it.rating) + "/10</span>" : "";
    var date = it.date ? '<span class="date">' + escapeHtml(it.date) + " · " + escapeHtml(f.year) + "年</span>" : "";
    $("detailMeta").innerHTML = catBadge(it.category) + '<span class="badge">' + escapeHtml(it.status || "") + "</span>" + score + date;
    $("detailReview").textContent = it.review || "（暂无评价）";
    $("detailActions").hidden = !state.admin;
    $("detailModal").hidden = false;
  }
  function closeDetail() { $("detailModal").hidden = true; detailId = null; }

  // ====== 记录弹窗 ======
  function openEntryModal(entryId) {
    editing.entryId = entryId || null;
    var b = boardOf(state.board);
    $("entryModalTitle").textContent = entryId ? "编辑记录" : "添加记录 · " + b.name;
    $("f-year").innerHTML = (b.years || []).map(function (y) {
      return '<option value="' + escapeHtml(y) + '">' + escapeHtml(y) + " 年</option>";
    }).join("");
    $("f-status").innerHTML = (b.statuses || []).map(function (s) {
      return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + "</option>";
    }).join("");
    var catLabelEl = document.getElementById("catLabel");
    if (catLabelEl) catLabelEl.textContent = b.key === "games" ? "平台" : b.key === "film" ? "类型" : "分类";
    $("f-category").innerHTML = '<option value="">无</option>' + (b.categories || []).map(function (c) {
      return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + "</option>";
    }).join("");
    var it = entryId ? findRecord(entryId).rec : null;
    $("f-title").value = it ? it.title : "";
    if (it) $("f-year").value = findRecord(entryId).year;
    $("f-status").value = it ? it.status : (b.statuses[0] || "");
    $("f-category").value = it ? (it.category || "") : "";
    $("f-rating").value = it ? it.rating : "";
    $("f-date").value = it ? it.date : new Date().toISOString().slice(0, 10);
    $("f-cover").value = it ? it.cover : "";
    currentCoverPos = (it && it.coverPos) ? it.coverPos : "50% 50%";
    updateCoverPreview();
    $("f-review").value = it ? it.review : "";
    $("f-year-new").value = "";
    $("entryModal").hidden = false;
  }
  function saveEntry() {
    var title = $("f-title").value.trim();
    if (!title) { alert("标题不能为空"); return; }
    var newYear = $("f-year-new").value.trim();
    var year = newYear || $("f-year").value;
    if (!year) { alert("请选择或输入年份"); return; }
    var b = boardOf(state.board);
    if (b.years.indexOf(year) === -1) { b.years.push(year); b.years.sort(function (a, c) { return c - a; }); }

    var rec = {
      id: editing.entryId || (state.board + "-" + Date.now()),
      title: title,
      rating: Number($("f-rating").value) || 0,
      status: $("f-status").value,
      category: $("f-category").value,
      date: $("f-date").value,
      review: $("f-review").value.trim(),
      cover: $("f-cover").value.trim(),
      coverPos: currentCoverPos
    };
    var key = rkey(state.board, year);
    if (!data.records[key]) data.records[key] = [];
    if (editing.entryId) {
      var old = findRecord(editing.entryId);
      // 若年份被改，先从旧位置移除
      if (old && (old.boardKey !== state.board || old.year !== year)) {
        data.records[rkey(old.boardKey, old.year)] = data.records[rkey(old.boardKey, old.year)]
          .filter(function (x) { return x.id !== editing.entryId; });
      }
      var arr = data.records[key];
      var placed = false;
      for (var i = 0; i < arr.length; i++) if (arr[i].id === editing.entryId) { arr[i] = rec; placed = true; break; }
      if (!placed) arr.unshift(rec);
    } else {
      data.records[key].unshift(rec);
    }
    save(); closeModals(); render(); pushRemote();
  }
  function deleteEntry(id) {
    if (!confirm("确定删除这条记录？")) return;
    var f = findRecord(id); if (!f) return;
    data.records[rkey(f.boardKey, f.year)] = data.records[rkey(f.boardKey, f.year)]
      .filter(function (x) { return x.id !== id; });
    save(); closeDetail(); render(); pushRemote();
  }

  // ====== 板块管理 ======
  function renderBoardList() {
    $("boardList").innerHTML = data.boards.map(function (b) {
      var chips = (b.statuses || []).map(function (s) {
        return '<span class="chip">' + escapeHtml(s) + "</span>";
      }).join("");
      var yr = (b.years || []).map(function (y) { return '<span class="chip">' + escapeHtml(y) + "</span>"; }).join("");
      return '<div class="board-row">' +
        '<div><span class="board-emoji">' + escapeHtml(b.emoji) + "</span> <b>" + escapeHtml(b.name) + "</b>" +
          '<div class="chips">' + chips + yr + "</div></div>" +
        '<div class="board-row-actions">' +
          '<button class="mini" data-bedit="' + b.key + '">编辑</button>' +
          '<button class="mini" data-bdel="' + b.key + '">删除</button>' +
        "</div></div>";
    }).join("");
  }
  var editingBoard = null;
  function openBoardModal() {
    editingBoard = null;
    $("boardFormTitle").textContent = "新增板块";
    $("b-name").value = ""; $("b-emoji").value = ""; $("b-statuses").value = ""; $("b-years").value = "";
    renderBoardList();
    $("boardModal").hidden = false;
  }
  function saveBoard() {
    var name = $("b-name").value.trim();
    if (!name) { alert("板块名称不能为空"); return; }
    var statuses = $("b-statuses").value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!statuses.length) statuses = ["待看", "看了", "在看"];
    var years = $("b-years").value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    years.sort(function (a, c) { return c - a; });
    var emoji = $("b-emoji").value.trim() || "📁";
    if (editingBoard) {
      var b = boardOf(editingBoard);
      b.name = name; b.emoji = emoji; b.statuses = statuses; b.years = years;
    } else {
      var key = "b" + Date.now();
      data.boards.push({ key: key, name: name, emoji: emoji, statuses: statuses, years: years });
    }
    save(); closeModals(); state.board = editingBoard || data.boards[data.boards.length - 1].key; state.year = "全部"; render(); pushRemote();
  }
  function deleteBoard(key) {
    var b = boardOf(key);
    if (!confirm("删除板块「" + b.name + "」会连同其中所有记录一起删掉，确定？")) return;
    data.boards = data.boards.filter(function (x) { return x.key !== key; });
    Object.keys(data.records).forEach(function (k) { if (k.indexOf(key + "::") === 0) delete data.records[k]; });
    if (state.board === key) state.board = data.boards[0] ? data.boards[0].key : "";
    save(); render(); pushRemote();
  }

  function closeModals() { $("entryModal").hidden = true; $("boardModal").hidden = true; }

  // ====== 管理开关 ======
  function enterAdmin() {
    var p = prompt("请输入管理密码：", "");
    if (p === ADMIN_PASS) { state.admin = true; adminBar.hidden = false; renderGrid(); }
    else if (p !== null) alert("密码错误");
  }
  function exitAdmin() { state.admin = false; adminBar.hidden = true; renderGrid(); }
  function exportData() {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "MCLAL书影游记录-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        if (!obj || !obj.boards || !obj.records) throw new Error("文件格式不对（需含 boards 与 records）");
        ensureIds(obj);
        data = obj; save(); render();
        if (state.admin) pushRemote();
        alert("导入成功：已写入本机" + (state.admin ? "并同步到云端分享链接。" : "（非管理模式，未同步云端；进入管理模式可再同步）。"));
      } catch (e) { alert("导入失败：" + e.message); }
    };
    reader.readAsText(file);
  }
  function updateCoverPreview() {
    var v = $("f-cover").value.trim(), prev = $("coverPreview");
    if (v) { prev.src = v; prev.hidden = false; prev.style.objectPosition = currentCoverPos; $("coverClearBtn").hidden = false; $("coverHint").hidden = false; }
    else { prev.hidden = true; prev.removeAttribute("src"); $("coverClearBtn").hidden = true; $("coverHint").hidden = true; }
  }
  function uploadCoverToRepo(dataUrl, name) {
    return new Promise(function (resolve, reject) {
      var b64 = String(dataUrl).split(",")[1];
      if (!b64) return reject(new Error("图片数据异常"));
      if (!CONFIG) return reject(new Error("未配置仓库"));
      var u = "https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo + "/contents/images/" + name;
      fetch(u, {
        method: "PUT",
        headers: ghHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message: "add cover " + name, content: b64, branch: CONFIG.branch })
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (e) { reject(new Error("HTTP " + r.status + " " + (e && e.message ? e.message : ""))); },
          function () { reject(new Error("HTTP " + r.status)); });
        return r.json();
      }).then(function () {
        resolve("https://raw.githubusercontent.com/" + CONFIG.owner + "/" + CONFIG.repo + "/" + CONFIG.branch + "/images/" + name);
      }).catch(reject);
    });
  }
  function handleCoverFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert("请选择图片文件。"); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1000, w = img.width, h = img.height;
        if (w > max || h > max) {
          if (w >= h) { h = Math.round(h * max / w); w = max; }
          else { w = Math.round(w * max / h); h = max; }
        }
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        var dataUrl;
        try { dataUrl = canvas.toDataURL("image/jpeg", 0.82); } catch (e) { dataUrl = reader.result; }
        if (dataUrl.length > 950 * 1024) dataUrl = canvas.toDataURL("image/jpeg", 0.6); // 仍过大再压
        var name = "cover-" + Date.now() + "-" + Math.floor(Math.random() * 1e4) + ".jpg";
        if (ghToken()) {
          uploadCoverToRepo(dataUrl, name).then(function (u) {
            $("f-cover").value = u; updateCoverPreview();
          }).catch(function (e) {
            $("f-cover").value = dataUrl; updateCoverPreview();
            alert("图片存到仓库失败（" + e.message + "），已改为内嵌方式；内嵌会占用数据体积，建议检查令牌权限。");
          });
        } else {
          $("f-cover").value = dataUrl; updateCoverPreview();
        }
      };
      img.onerror = function () { alert("图片读取失败，换一张试试。"); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ====== 主题 ======
  var savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme) {
    document.documentElement.setAttribute("data-theme", savedTheme);
    $("themeToggle").textContent = savedTheme === "dark" ? "☀️" : "🌙";
  }
  $("themeToggle").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "" : "dark";
    if (cur) document.documentElement.setAttribute("data-theme", cur);
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem(THEME_KEY, cur);
    this.textContent = cur === "dark" ? "☀️" : "🌙";
  });

  // ====== 事件 ======
  tabs.addEventListener("click", function (e) {
    var btn = e.target.closest(".tab"); if (!btn) return;
    state.board = btn.getAttribute("data-key"); state.year = "全部"; render();
  });
  yearTabs.addEventListener("click", function (e) {
    var btn = e.target.closest(".year-tab"); if (!btn) return;
    state.year = btn.getAttribute("data-year"); renderGrid();
  });
  search.addEventListener("input", function () { state.query = this.value; renderGrid(); });
  filter.addEventListener("change", function () { state.status = this.value; renderGrid(); });
  $("sort").addEventListener("change", function () { state.sort = this.value; renderGrid(); });

  $("adminBtn").addEventListener("click", enterAdmin);
  $("exitAdmin").addEventListener("click", exitAdmin);
  $("addEntryBtn").addEventListener("click", function () { openEntryModal(null); });
  $("boardBtn").addEventListener("click", openBoardModal);
  $("exportBtn").addEventListener("click", exportData);
  $("importBtn").addEventListener("click", function () { $("importFile").click(); });
  $("importFile").addEventListener("change", function () {
    if (this.files && this.files[0]) importData(this.files[0]);
    this.value = "";
  });
  $("coverPickBtn").addEventListener("click", function () { $("coverFile").click(); });
  $("coverFile").addEventListener("change", function () {
    if (this.files && this.files[0]) handleCoverFile(this.files[0]);
    this.value = "";
  });
  $("coverClearBtn").addEventListener("click", function () { $("f-cover").value = ""; updateCoverPreview(); });
  $("coverPreview").addEventListener("click", function (e) {
    var rect = this.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var x = Math.round((e.clientX - rect.left) / rect.width * 100);
    var y = Math.round((e.clientY - rect.top) / rect.height * 100);
    x = Math.max(0, Math.min(100, x)); y = Math.max(0, Math.min(100, y));
    currentCoverPos = x + "% " + y + "%";
    this.style.objectPosition = currentCoverPos;
  });
  $("tokenBtn").addEventListener("click", function () {
    var t = prompt("粘贴你的 GitHub 个人访问令牌（PAT，需 repo 权限）。\n它只保存在你这台浏览器的本机，不会写进代码。", "");
    if (t) { localStorage.setItem("recsite-gh-token", t.trim()); alert("令牌已保存（仅本机浏览器）。之后在管理模式里的增删改会自动同步到分享链接。"); }
  });

  $("entryCancel").addEventListener("click", closeModals);
  $("entrySave").addEventListener("click", saveEntry);
  $("boardCancel").addEventListener("click", closeModals);
  $("boardSave").addEventListener("click", saveBoard);

  grid.addEventListener("click", function (e) {
    var ed = e.target.getAttribute("data-edit");
    var dl = e.target.getAttribute("data-del");
    if (ed) { openEntryModal(ed); return; }
    if (dl) { deleteEntry(dl); return; }
    var dt = e.target.closest(".card"); if (dt) openDetail(dt.getAttribute("data-detail"));
  });
  $("boardList").addEventListener("click", function (e) {
    var ed = e.target.getAttribute("data-bedit");
    var dl = e.target.getAttribute("data-bdel");
    if (ed) {
      var b = boardOf(ed); editingBoard = ed;
      $("boardFormTitle").textContent = "修改板块 · " + b.name;
      $("b-name").value = b.name; $("b-emoji").value = b.emoji;
      $("b-statuses").value = b.statuses.join(","); $("b-years").value = b.years.join(",");
      renderBoardList();
    }
    if (dl) deleteBoard(dl);
  });

  $("detailClose").addEventListener("click", closeDetail);
  $("detailEdit").addEventListener("click", function () { if (detailId) { closeDetail(); openEntryModal(detailId); } });
  $("detailDelete").addEventListener("click", function () { if (detailId) deleteEntry(detailId); });

  // ====== 启动 ======
  render();
  loadRemote();
})();
