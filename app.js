/* =========================================================
   STUDYVAULT - COMPLETE APP UPDATE
   PART 1 OF 3
   Existing IndexedDB data is preserved.
========================================================= */

"use strict";

const DB_NAME = "studyvault-db";
const DB_VERSION = 4;
const EXTRA_DB = "studyvault-extras";

const DEFAULT_FOLDERS = [
  ["polity", "Polity", "#9a8cff"],
  ["economics", "Economics", "#6de0c2"],
  ["geography", "Geography", "#f4b86a"],
  ["history", "History", "#ef8fa8"],
  ["physics", "Physics", "#79b8ff"],
  ["chemistry", "Chemistry", "#b6df75"],
  ["biology", "Biology", "#61d6a7"]
];

const $ = id => document.getElementById(id);

let db = null;
let extraDB = null;

let currentVideoId = null;
let currentObjectUrl = null;
let currentPdfUrl = null;
let currentFolderId = null;

let toastTimer = null;
let quizQuestions = [];
let quizIndex = 0;
let quizScore = 0;
let quizCorrect = 0;
let quizWrong = 0;
let quizAnswered = false;
let quizTimerInterval = null;
let quizSeconds = 0;

let activeLibraryType = "videos";

const uid = () => {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "sv-" + Date.now() + "-" + Math.random().toString(36).slice(2);
};

const todayKey = () => {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function toast(message) {
  const t = $("toast");
  if (!t) {
    console.log(message);
    return;
  }

  t.textContent = message;
  t.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("show");
  }, 2800);
}

function fmtMin(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));

  if (n >= 60) {
    const h = Math.floor(n / 60);
    const m = n % 60;
    return `${h}h ${m ? m + "m" : ""}`;
  }

  return `${n}m`;
}

function bytes(value) {
  const n = Number(value) || 0;

  if (n < 1048576) {
    return (n / 1024).toFixed(0) + " KB";
  }

  return (n / 1048576).toFixed(1) + " MB";
}

function shuffle(array) {
  return array
    .map(item => [Math.random(), item])
    .sort((a, b) => a[0] - b[0])
    .map(item => item[1]);
}

/* =========================================================
   DATABASE
========================================================= */

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      const stores = [
        "videos",
        "tasks",
        "settings",
        "folders",
        "links"
      ];

      for (const name of stores) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, {
            keyPath: name === "settings" ? "key" : "id"
          });
        }
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

function openExtraDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(EXTRA_DB, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      const stores = [
        "pdfs",
        "notes",
        "bookmarks",
        "history",
        "settings"
      ];

      for (const name of stores) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, {
            keyPath: "id"
          });
        }
      }
    };

    request.onsuccess = () => {
      extraDB = request.result;
      resolve(extraDB);
    };

    request.onerror = () => reject(request.error);
  });
}

function store(name, mode = "readonly") {
  return db.transaction(name, mode).objectStore(name);
}

function extraStore(name, mode = "readonly") {
  return extraDB.transaction(name, mode).objectStore(name);
}

function reqP(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const all = name => reqP(store(name).getAll());
const put = (name, value) =>
  reqP(store(name, "readwrite").put(value));
const del = (name, id) =>
  reqP(store(name, "readwrite").delete(id));

const xall = name => reqP(extraStore(name).getAll());
const xput = (name, value) =>
  reqP(extraStore(name, "readwrite").put(value));
const xdel = (name, id) =>
  reqP(extraStore(name, "readwrite").delete(id));

/* =========================================================
   NAVIGATION
========================================================= */

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.tab === name
    );
  });

  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle("active", page.id === name);
  });

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

  if (name === "home") {
    currentFolderId = null;
    renderHome();
  }

  if (name === "videos") {
    renderFolderControls();
    renderVideos();
    renderLinks();
  }

  if (name === "pdfs") renderPdfs();
  if (name === "notes") renderNotes();
  if (name === "planner") renderTasks();
  if (name === "progress") renderProgress();
}

document.querySelectorAll(".tab").forEach(button => {
  button.onclick = () => switchTab(button.dataset.tab);
});

document.querySelectorAll("[data-go]").forEach(button => {
  button.onclick = () => switchTab(button.dataset.go);
});

if ($("todayLabel")) {
  $("todayLabel").textContent =
    new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(new Date()).toUpperCase();
}

/* =========================================================
   FOLDERS
========================================================= */

async function ensureSubjectLinks(folder) {
  const folders = await all("folders");

  let child = folders.find(item =>
    item.parentId === folder.id && item.isLinks
  );

  if (!child) {
    child = {
      id: "links-" + folder.id,
      parentId: folder.id,
      name: "Links",
      color: folder.color,
      isLinks: true,
      isDefault: true
    };

    await put("folders", child);
  }

  return child;
}

async function seedFolders() {
  let folders = await all("folders");

  for (const [id, name, color] of DEFAULT_FOLDERS) {
    if (!folders.some(folder => folder.id === id)) {
      await put("folders", {
        id,
        name,
        color,
        isDefault: true
      });
    }
  }

  folders = await all("folders");

  const roots = folders.filter(folder =>
    !folder.parentId && !folder.isLinks
  );

  for (const folder of roots) {
    const child = await ensureSubjectLinks(folder);

    for (const link of await all("links")) {
      if (
        link.folderId === folder.id &&
        !link.parentFolderId
      ) {
        link.parentFolderId = folder.id;
        link.folderId = child.id;
        await put("links", link);
      }
    }
  }
}

async function folderName(id) {
  if (!id) return "Unsorted";

  const folders = await all("folders");
  const folder = folders.find(item => item.id === id);

  return folder ? folder.name : "Unsorted";
}

function folderPath(id, folders) {
  let folder = folders.find(item => item.id === id);

  if (!folder) return "Unsorted";

  const names = [folder.name];

  while (folder.parentId) {
    folder = folders.find(item => item.id === folder.parentId);

    if (!folder) break;

    names.unshift(folder.name);
  }

  return names.join(" / ");
}

async function renderFolderControls() {
  const folders = await all("folders");

  const visibleFolders = folders
    .filter(folder => !folder.isLinks)
    .sort((a, b) => a.name.localeCompare(b.name));

  const filter = $("folderFilter");
  const upload = $("uploadFolder");
  const manage = $("manageFolder");

  const options = visibleFolders.map(folder => {
    return `<option value="${esc(folder.id)}">
      ${esc(folderPath(folder.id, folders))}
    </option>`;
  }).join("");

  if (filter) {
    const old = filter.value;

    filter.innerHTML =
      '<option value="all">All folders</option>' +
      '<option value="">Unsorted</option>' +
      options;

    if ([...filter.options].some(option => option.value === old)) {
      filter.value = old;
    }
  }

  if (upload) {
    const old = upload.value;

    upload.innerHTML =
      '<option value="">Unsorted</option>' + options;

    if ([...upload.options].some(option => option.value === old)) {
      upload.value = old;
    }
  }

  if (manage) {
    const old = manage.value;

    manage.innerHTML =
      '<option value="">Choose a folder to customise</option>' +
      options;

    if ([...manage.options].some(option => option.value === old)) {
      manage.value = old;
    }
  }

  if ($("newFolderParent")) {
    $("newFolderParent").innerHTML =
      '<option value="">Create in Home (top level)</option>' +
      options;
  }

  if ($("linkSubject")) {
    const roots = visibleFolders.filter(folder => !folder.parentId);

    $("linkSubject").innerHTML = roots.map(folder => {
      const child = folders.find(item =>
        item.parentId === folder.id && item.isLinks
      );

      return child
        ? `<option value="${esc(child.id)}">
             ${esc(folder.name)} / Links
           </option>`
        : "";
    }).join("");
  }

  if ($("pdfFolder")) {
    const old = $("pdfFolder").value;

    $("pdfFolder").innerHTML =
      '<option value="">Unsorted</option>' + options;

    if ([...$("pdfFolder").options].some(option => option.value === old)) {
      $("pdfFolder").value = old;
    }
  }

  if ($("noteFolder")) {
    const old = $("noteFolder").value;

    $("noteFolder").innerHTML =
      '<option value="">Unsorted</option>' + options;

    if ([...$("noteFolder").options].some(option => option.value === old)) {
      $("noteFolder").value = old;
    }
  }

  const chips = $("folderChips");

  if (chips) {
    chips.innerHTML =
      '<button class="folder-chip active" data-folder-chip="all">All</button>' +
      '<button class="folder-chip" data-folder-chip="">Unsorted</button>' +
      visibleFolders.map(folder => `
        <button
          class="folder-chip"
          data-folder-chip="${esc(folder.id)}"
          style="--folder-color:${esc(folder.color)}"
        >
          <i></i>${esc(folderPath(folder.id, folders))}
        </button>
      `).join("");

    chips.querySelectorAll("[data-folder-chip]").forEach(button => {
      button.onclick = () => {
        if (filter) filter.value = button.dataset.folderChip;

        chips.querySelectorAll("[data-folder-chip]").forEach(item => {
          item.classList.toggle("active", item === button);
        });

        renderVideos();
      };
    });
  }
}

if ($("folderFilter")) {
  $("folderFilter").onchange = () => {
    document.querySelectorAll("[data-folder-chip]").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.folderChip === $("folderFilter").value
      );
    });

    renderVideos();
  };
}

/* CREATE FOLDER */

if ($("addFolderBtn")) {
  $("addFolderBtn").onclick = async () => {
    const name = $("newFolderName")?.value.trim();

    if (!name) {
      toast("Enter a folder name");
      return;
    }

    const parentId = $("newFolderParent")?.value || null;
    const folders = await all("folders");

    const exists = folders.some(folder =>
      folder.parentId === parentId &&
      folder.name.toLowerCase() === name.toLowerCase() &&
      !folder.isLinks
    );

    if (exists) {
      toast("Folder already exists here");
      return;
    }

    const folder = {
      id: uid(),
      name,
      parentId,
      color: $("newFolderColor")?.value || "#9a8cff",
      isDefault: false
    };

    await put("folders", folder);

    if (!parentId) {
      await ensureSubjectLinks(folder);
    }

    if ($("newFolderName")) {
      $("newFolderName").value = "";
    }

    await renderFolderControls();
    await renderHome();

    toast("Folder created");
  };
}

/* EDIT FOLDER */

if ($("manageFolder")) {
  $("manageFolder").onchange = async () => {
    const id = $("manageFolder").value;
    const folders = await all("folders");
    const folder = folders.find(item => item.id === id);

    if ($("editFolderName")) {
      $("editFolderName").value = folder?.name || "";
    }

    if ($("editFolderColor")) {
      $("editFolderColor").value = folder?.color || "#9a8cff";
    }
  };
}

if ($("saveFolderBtn")) {
  $("saveFolderBtn").onclick = async () => {
    const id = $("manageFolder")?.value;
    const folders = await all("folders");
    const folder = folders.find(item => item.id === id);
    const name = $("editFolderName")?.value.trim();

    if (!folder || !name) {
      toast("Choose a folder and enter its name");
      return;
    }

    const duplicate = folders.some(item =>
      item.id !== id &&
      item.parentId === folder.parentId &&
      item.name.toLowerCase() === name.toLowerCase()
    );

    if (duplicate) {
      toast("That folder name is already used here");
      return;
    }

    folder.name = name;

    if ($("editFolderColor")) {
      folder.color = $("editFolderColor").value;
    }

    await put("folders", folder);
    await renderFolderControls();
    await renderHome();

    if ($("manageFolder")) {
      $("manageFolder").value = id;
    }

    toast("Folder updated");
  };
}

/* DELETE FOLDER */

if ($("deleteFolderBtn")) {
  $("deleteFolderBtn").onclick = async () => {
    const id = $("manageFolder")?.value;
    const folders = await all("folders");
    const folder = folders.find(item => item.id === id);

    if (!folder) {
      toast("Choose a folder first");
      return;
    }

    if (!confirm(
      `Delete "${folder.name}"? Its content will move to Unsorted.`
    )) return;

    const ids = [id];
    let changed = true;

    while (changed) {
      changed = false;

      for (const item of folders) {
        if (
          item.parentId &&
          ids.includes(item.parentId) &&
          !ids.includes(item.id)
        ) {
          ids.push(item.id);
          changed = true;
        }
      }
    }

    for (const video of await all("videos")) {
      if (ids.includes(video.folderId)) {
        video.folderId = null;
        await put("videos", video);
      }
    }

    for (const link of await all("links")) {
      if (
        ids.includes(link.folderId) ||
        ids.includes(link.parentFolderId)
      ) {
        link.folderId = null;
        link.parentFolderId = null;
        await put("links", link);
      }
    }

    for (const pdf of await xall("pdfs")) {
      if (ids.includes(pdf.folderId)) {
        pdf.folderId = null;
        await xput("pdfs", pdf);
      }
    }

    for (const note of await xall("notes")) {
      if (ids.includes(note.folderId)) {
        note.folderId = null;
        await xput("notes", note);
      }
    }

    for (const folderId of ids.reverse()) {
      await del("folders", folderId);
    }

    currentFolderId = null;

    await renderFolderControls();
    await renderVideos();
    await renderLinks();
    await renderPdfs();
    await renderNotes();
    await renderHome();

    toast("Folder deleted. Content kept.");
  };
}

/* =========================================================
   LOCAL VIDEO LIBRARY
========================================================= */

function videoHTML(video, move = false, folders = []) {
  const label = folderPath(video.folderId, folders);

  const options = move
    ? `<select class="move-select" data-move="${esc(video.id)}">
         <option value="">Unsorted</option>
         ${folders.filter(item => !item.isLinks).map(item => `
           <option
             value="${esc(item.id)}"
             ${item.id === video.folderId ? "selected" : ""}
           >
             ${esc(folderPath(item.id, folders))}
           </option>
         `).join("")}
       </select>`
    : "";

  return `
    <div class="video-item">
      <div class="video-thumb">▶</div>

      <div class="video-meta">
        <b>${esc(video.name)}</b>
        <small>
          <span class="folder-tag">${esc(label)}</span>
          · ${bytes(video.size || 0)}
          ${video.position ? " · Resume available" : ""}
        </small>
        ${options}
      </div>

      <div class="video-actions">
        <button class="small-btn"
          data-edit-video="${esc(video.id)}">
          Edit title
        </button>

        <button class="small-btn"
          data-play="${esc(video.id)}">
          Play
        </button>

        <button class="small-btn"
          data-video-bookmark="${esc(video.id)}">
          ☆
        </button>
      </div>
    </div>
  `;
}

async function bindVideoButtons() {
  document.querySelectorAll("[data-edit-video]").forEach(button => {
    button.onclick = async () => {
      const video = await reqP(
        store("videos").get(button.dataset.editVideo)
      );

      if (!video) return;

      const name = prompt("Edit video title", video.name);

      if (name && name.trim()) {
        video.name = name.trim();

        await put("videos", video);
        await renderVideos();
        await renderHome();

        toast("Video title updated");
      }
    };
  });

  document.querySelectorAll("[data-play]").forEach(button => {
    button.onclick = () => playVideo(button.dataset.play);
  });

  document.querySelectorAll("[data-move]").forEach(select => {
    select.onchange = async () => {
      const video = await reqP(
        store("videos").get(select.dataset.move)
      );

      if (!video) return;

      video.folderId = select.value || null;

      await put("videos", video);
      await renderVideos();
      await renderHome();

      toast("Video moved");
    };
  });

  document.querySelectorAll("[data-video-bookmark]").forEach(button => {
    button.onclick = async () => {
      const video = await reqP(
        store("videos").get(button.dataset.videoBookmark)
      );

      if (video) {
        await addBookmark("video", video.id, video.name);
      }
    };
  });
}

async function renderVideos() {
  if (!$("allVideos")) return;

  const videos = await all("videos");
  const folders = await all("folders");

  const query = ($("videoSearch")?.value || "").toLowerCase();

  const filter = $("folderFilter")
    ? $("folderFilter").value
    : "all";

  const filtered = videos.filter(video => {
    const matchesSearch =
      (video.name + " " + (video.subject || ""))
        .toLowerCase()
        .includes(query);

    const matchesFolder =
      filter === "all" ||
      (filter === "" ? !video.folderId : video.folderId === filter);

    const matchesCurrentFolder =
      !currentFolderId || video.folderId === currentFolderId;

    return matchesSearch && matchesFolder && matchesCurrentFolder;
  }).sort((a, b) => {
    return (b.added || 0) - (a.added || 0);
  });

  $("allVideos").innerHTML = filtered.length
    ? filtered.map(video => videoHTML(video, true, folders)).join("")
    : '<div class="empty">No videos in this view.</div>';

  await bindVideoButtons();
}

if ($("videoSearch")) {
  $("videoSearch").oninput = renderVideos;
}

/* UPLOAD LOCAL VIDEOS */

if ($("videoInput")) {
  $("videoInput").onchange = async event => {
    const files = [...event.target.files];
    const folderId = $("uploadFolder")?.value || null;

    const folders = await all("folders");
    const selectedFolder = folders.find(item => item.id === folderId);

    for (const file of files) {
      if (!file.type.startsWith("video/")) continue;

      try {
        await put("videos", {
          id: uid(),
          name: file.name,
          subject: selectedFolder?.name || "Unsorted",
          folderId,
          size: file.size,
          type: file.type,
          blob: file,
          added: Date.now(),
          position: 0,
          lastWatched: 0,
          completed: false
        });
      } catch (error) {
        console.error(error);
        toast("Storage may be full. Could not save video.");
        break;
      }
    }

    event.target.value = "";

    await renderVideos();
    await renderHome();

    toast("Video saved on this device");
  };
}

/* PLAY LOCAL VIDEO */

async function playVideo(id) {
  const video = await reqP(store("videos").get(id));

  if (!video || !video.blob) {
    toast("Video file not found");
    return;
  }

  video.lastWatched = Date.now();
  await put("videos", video);

  currentVideoId = id;

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }

  currentObjectUrl = URL.createObjectURL(video.blob);

  if ($("playerTitle")) {
    $("playerTitle").textContent = video.name;
  }

  if ($("playerSubject")) {
    $("playerSubject").textContent =
      await folderName(video.folderId);
  }

  if ($("videoPlayer")) {
    $("videoPlayer").src = currentObjectUrl;
  }

  if ($("playerDialog")) {
    $("playerDialog").showModal();
  }

  if ($("videoPlayer")) {
    $("videoPlayer").onloadedmetadata = () => {
      const player = $("videoPlayer");

      if (
        video.position > 0 &&
        video.position < player.duration - 2
      ) {
        player.currentTime = video.position;
      }
    };
  }

  await saveHistory("video", video.id, video.name);
  await renderHome();
}

/* SAVE VIDEO WATCH POSITION */

if ($("videoPlayer")) {
  $("videoPlayer").ontimeupdate = async () => {
    if (!currentVideoId) return;

    const player = $("videoPlayer");

    if (player.currentTime % 5 > 1) return;

    const video = await reqP(
      store("videos").get(currentVideoId)
    );

    if (!video) return;

    video.position = player.currentTime;
    video.durationSeconds =
      player.duration || video.durationSeconds || 0;

    video.completed = !!(
      video.durationSeconds &&
      video.position >= video.durationSeconds - 10
    );

    await put("videos", video);
  };

  $("videoPlayer").onended = async () => {
    if (!currentVideoId) return;

    const video = await reqP(
      store("videos").get(currentVideoId)
    );

    if (!video) return;

    video.durationSeconds =
      $("videoPlayer").duration ||
      video.durationSeconds ||
      0;

    video.position = video.durationSeconds;
    video.completed = true;

    await put("videos", video);

    await renderHome();
    await renderProgress();
  };
}

/* CLOSE VIDEO PLAYER */

if ($("closePlayer")) {
  $("closePlayer").onclick = () => {
    if ($("videoPlayer")) {
      $("videoPlayer").pause();
    }

    if ($("playerDialog")) {
      $("playerDialog").close();
    }
  };
}

if ($("playerDialog")) {
  $("playerDialog").onclose = () => {
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
    }

    currentObjectUrl = null;

    if ($("videoPlayer")) {
      $("videoPlayer").removeAttribute("src");
      $("videoPlayer").load();
    }

    currentVideoId = null;
    renderVideos();
  };
}

/* DELETE LOCAL VIDEO */

if ($("deleteVideoBtn")) {
  $("deleteVideoBtn").onclick = async () => {
    if (
      currentVideoId &&
      confirm("Delete saved copy from this device?")
    ) {
      await del("videos", currentVideoId);

      if ($("playerDialog")) {
        $("playerDialog").close();
      }

      await renderVideos();
      await renderHome();

      toast("Saved copy deleted");
    }
  };
}

/* =========================================================
   END OF PART 1
   PART 2 CONTINUES WITH YOUTUBE, PDF, NOTES,
   PLANNER AND HOME FOLDER CONTENTS.
========================================================= *//* =========================================================
   STUDYVAULT - COMPLETE APP UPDATE
   PART 2 OF 3
   YOUTUBE, PDF, NOTES, PLANNER AND HOME
========================================================= */

/* =========================================================
   YOUTUBE LINKS
   Unlisted videos, Shorts, Live and Premiere links
========================================================= */

function getYouTubeInfo(url) {
  try {
    url = String(url || "").trim();

    if (!url) return null;

    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url;
    }

    const parsed = new URL(url);
    const host = parsed.hostname
      .toLowerCase()
      .replace(/^www\./, "");

    const allowedHosts = [
      "youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtu.be",
      "youtube-nocookie.com"
    ];

    if (!allowedHosts.includes(host)) return null;

    const parts = parsed.pathname
      .split("/")
      .filter(Boolean);

    let videoId = null;
    let playlistId = parsed.searchParams.get("list") || null;

    if (host === "youtu.be") {
      videoId = parts[0] || null;
    } else if (parts[0] === "watch") {
      videoId = parsed.searchParams.get("v");
    } else if (
      ["embed", "shorts", "live", "v"].includes(parts[0])
    ) {
      videoId = parts[1] || null;
    }

    if (videoId && !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      videoId = null;
    }

    if (
      playlistId &&
      !/^[a-zA-Z0-9_-]+$/.test(playlistId)
    ) {
      playlistId = null;
    }

    if (!videoId && !playlistId) return null;

    return {
      videoId,
      playlistId,
      type: playlistId ? "playlist" : "video"
    };

  } catch (error) {
    return null;
  }
}


/* SAVE YOUTUBE LINK */

if ($("saveLinkBtn")) {
  $("saveLinkBtn").onclick = async () => {
    const url = $("youtubeUrl")?.value.trim() || "";
    const title = $("linkTitle")?.value.trim() || "";
    const folderId = $("linkSubject")?.value || "";

    const info = getYouTubeInfo(url);

    if (!info) {
      toast("Valid YouTube video or playlist link paste karein");
      return;
    }

    const folders = await all("folders");
    const child = folders.find(folder =>
      folder.id === folderId && folder.isLinks
    );

    const link = {
      id: uid(),
      youtubeId: info.videoId,
      playlistId: info.playlistId,
      type: info.type,
      url,
      title: title || (
        info.type === "playlist"
          ? "YouTube Playlist"
          : "YouTube Lecture"
      ),
      folderId: child ? child.id : null,
      parentFolderId: child ? child.parentId : null,
      added: Date.now(),
      lastWatched: 0
    };

    await put("links", link);

    if ($("youtubeUrl")) $("youtubeUrl").value = "";
    if ($("linkTitle")) $("linkTitle").value = "";

    await renderLinks();
    await renderHome();

    toast("YouTube link saved");
  };
}

/* YOUTUBE LINK CARD */


function youtubeCardHTML(link, folders) {
  const child = folders.find(folder =>
    folder.id === link.folderId && folder.isLinks
  );

  const parent = folders.find(folder =>
    folder.id === (link.parentFolderId || child?.parentId)
  );

  const parsedInfo = getYouTubeInfo(link.url || "");

  const playlistId =
    link.playlistId || parsedInfo?.playlistId || null;

  const isPlaylist =
    !!playlistId || link.type === "playlist";

  const videoId =
    link.youtubeId || parsedInfo?.videoId || null;

  const thumbnail = videoId
    ? `<img class="video-thumb youtube-thumb"
        src="${youtubeThumb(videoId)}"
        alt="YouTube thumbnail"
        loading="lazy"
        onerror="this.style.display='none'">`
    : `<div class="video-thumb">▶</div>`;

  return `
    <div class="video-item">
      ${thumbnail}

      <div class="video-meta">
        <b>${esc(link.title)}</b>
        <small>
          <span class="folder-tag">
            ${esc(parent?.name || "Aditya")} / Links
          </span>
          · ${isPlaylist ? "YouTube Playlist" : "YouTube Video"}
        </small>
      </div>

      <div class="video-actions">
        <button class="small-btn" data-yplay="${esc(link.id)}">
          Play
        </button>

        <button class="small-btn" data-ybookmark="${esc(link.id)}">
          ☆
        </button>

        <button class="small-btn" data-yopen="${esc(link.id)}">
          ${isPlaylist ? "Open Full Playlist" : "YouTube"}
        </button>

        <button class="small-btn danger-outline" data-ydel="${esc(link.id)}">
          ×
        </button>
      </div>
    </div>
  `;
     }

        

/* RENDER YOUTUBE LINKS */



async function renderLinks() {
  const linksList = $("linksList");

  if (!linksList) return;

  try {
    const links = (await all("links"))
      .sort((a, b) => (b.added || 0) - (a.added || 0));

    const folders = await all("folders");

    const visibleLinks = links.filter(link => {
      if (!currentFolderId) return true;

      return (
        link.parentFolderId === currentFolderId ||
        link.folderId === currentFolderId
      );
    });

    linksList.innerHTML = visibleLinks.length
      ? visibleLinks.map(link =>
          youtubeCardHTML(link, folders)
        ).join("")
      : '<div class="empty">No YouTube links saved yet.</div>';

    // PLAY YOUTUBE INSIDE STUDYVAULT
    document.querySelectorAll("[data-yplay]").forEach(button => {
      button.onclick = () => {
        playYoutube(button.dataset.yplay);
      };
    });

    // OPEN PLAYLIST INSIDE STUDYVAULT
    document.querySelectorAll("[data-yopen]").forEach(button => {
      button.onclick = () => {
        playYoutube(button.dataset.yopen);
      };
    });

    // DELETE YOUTUBE LINK
    document.querySelectorAll("[data-ydel]").forEach(button => {
      button.onclick = async () => {
        if (!confirm("Delete this YouTube link from StudyVault?")) {
          return;
        }

        await del("links", button.dataset.ydel);

        await renderLinks();
        await renderHome();

        toast("YouTube link deleted");
      };
    });

    // BOOKMARK YOUTUBE LINK
    document.querySelectorAll("[data-ybookmark]").forEach(button => {
      button.onclick = async () => {
        try {
          const link = await reqP(
            store("links").get(button.dataset.ybookmark)
          );

          if (link) {
            await addBookmark(
              "youtube",
              link.id,
              link.title,
              link.url
            );
          }
        } catch (error) {
          console.error("YouTube bookmark error:", error);
          toast("Could not bookmark YouTube link");
        }
      };
    });

  } catch (error) {
    console.error("Render YouTube links error:", error);
    linksList.innerHTML =
      '<div class="empty">Could not load YouTube links.</div>';
  }
}

/* PLAY YOUTUBE INSIDE STUDYVAULT */



/* PLAY YOUTUBE INSIDE STUDYVAULT */

function ensureYoutubePlaylistPanel() {
  let panel = document.getElementById("youtubePlaylistPanel");

  if (panel) return panel;

  const frameBox = document.querySelector(".youtube-frame");

  if (!frameBox) return null;

  panel = document.createElement("div");
  panel.id = "youtubePlaylistPanel";

  panel.innerHTML = `
    <div style="padding:12px 0">
      <h3 id="youtubePlaylistHeading"
          style="margin:0 0 8px">Playlist videos</h3>
      <div id="youtubePlaylistStatus"
           style="font-size:13px;opacity:.75;margin-bottom:10px">
        Loading playlist...
      </div>
      <div id="youtubePlaylistItems"></div>
    </div>
  `;

  panel.style.cssText = `
    padding:12px;
    margin-top:12px;
    border-radius:12px;
    background:var(--card, #202020);
    color:var(--text, #fff);
    max-height:420px;
    overflow-y:auto;
  `;

  frameBox.insertAdjacentElement("afterend", panel);

  return panel;
}

function formatYoutubeDuration(seconds) {
  seconds = Number(seconds) || 0;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

async function loadYoutubePlaylist(playlistId) {
  const panel = ensureYoutubePlaylistPanel();

  if (!panel) return;

  const status = document.getElementById("youtubePlaylistStatus");
  const itemsBox = document.getElementById("youtubePlaylistItems");
  const heading = document.getElementById("youtubePlaylistHeading");

  status.textContent = "Loading latest playlist videos...";
  itemsBox.innerHTML = "";

  try {
    const apiUrl =
      "https://inv.nadeko.net/api/v1/playlists/" +
      encodeURIComponent(playlistId);

    const response = await fetch(apiUrl, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Playlist server error: " + response.status);
    }

    const data = await response.json();

    const videos = Array.isArray(data.videos)
      ? data.videos
      : [];

    heading.textContent = data.title || "Playlist videos";

    if (!videos.length) {
      status.textContent = "No videos found in this playlist.";
      return;
    }

    status.textContent =
      videos.length + " videos available";

    videos.forEach((video, index) => {
      const videoId = video.videoId;

      if (!videoId) return;

      const title = video.title || "Untitled video";

      const thumbnail =
        "https://i.ytimg.com/vi/" +
        encodeURIComponent(videoId) +
        "/mqdefault.jpg";

      const duration = formatYoutubeDuration(
        video.lengthSeconds
      );

      const item = document.createElement("button");

      item.type = "button";

      item.style.cssText = `
        display:flex;
        align-items:center;
        gap:10px;
        width:100%;
        padding:9px;
        margin-bottom:8px;
        border:0;
        border-radius:10px;
        background:rgba(128,128,128,.12);
        color:inherit;
        text-align:left;
        cursor:pointer;
      `;

      const img = document.createElement("img");
      img.src = thumbnail;
      img.alt = "";
      img.loading = "lazy";
      img.style.cssText = `
        width:112px;
        height:63px;
        object-fit:cover;
        border-radius:7px;
        flex-shrink:0;
      `;

      const details = document.createElement("div");
      details.style.cssText = "min-width:0;flex:1";

      const name = document.createElement("div");
      name.textContent = (index + 1) + ". " + title;
      name.style.cssText = `
        font-size:13px;
        font-weight:600;
        line-height:1.4;
      `;

      const time = document.createElement("div");
      time.textContent = duration;
      time.style.cssText = `
        font-size:12px;
        opacity:.7;
        margin-top:5px;
      `;

      details.append(name, time);
      item.append(img, details);

      item.onclick = () => {
        const frame = document.getElementById("youtubeFrame");

        if (!frame) return;

        frame.src =
          "https://www.youtube-nocookie.com/embed/" +
          encodeURIComponent(videoId) +
          "?playsinline=1&rel=0&autoplay=1";

        const playerTitle =
          document.getElementById("youtubePlayerTitle");

        if (playerTitle) {
          playerTitle.textContent = title;
        }

        document.querySelector(".youtube-frame")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      };

      itemsBox.appendChild(item);
    });

  } catch (error) {
    console.error("Playlist loading error:", error);

    status.textContent =
      "Playlist list load nahi hui. Server unavailable ho sakta hai. Thodi der baad dobara kholiye.";
  }
}

async function playYoutube(id) {
  try {
    const link = await reqP(store("links").get(id));

    if (!link) {
      toast("YouTube link not found");
      return;
    }

    const parsedInfo = getYouTubeInfo(link.url || "");

    const playlistId =
      link.playlistId || parsedInfo?.playlistId || null;

    const videoId =
      link.youtubeId || parsedInfo?.videoId || null;

    let embedUrl = "";

    if (playlistId) {
      embedUrl =
        "https://www.youtube-nocookie.com/embed/videoseries?list=" +
        encodeURIComponent(playlistId) +
        "&rel=0&playsinline=1&autoplay=0";

      link.playlistId = playlistId;
      link.type = "playlist";

    } else if (videoId) {
      embedUrl =
        "https://www.youtube-nocookie.com/embed/" +
        encodeURIComponent(videoId) +
        "?rel=0&playsinline=1";

      link.youtubeId = videoId;
      link.type = "video";

    } else {
      toast("Invalid YouTube link");
      return;
    }

    link.lastWatched = Date.now();
    await put("links", link);

    const dialog = document.getElementById("youtubeDialog");
    const frame = document.getElementById("youtubeFrame");

    if (!dialog || !frame) {
      toast("YouTube player dialog is missing");
      return;
    }

    const playerTitle =
      document.getElementById("youtubePlayerTitle");

    if (playerTitle) {
      playerTitle.textContent =
        link.title || "YouTube Playlist";
    }

    frame.src = embedUrl;

    const panel = document.getElementById("youtubePlaylistPanel");

    if (panel) {
      panel.style.display = playlistId ? "block" : "none";
    }

    if (!dialog.open) {
      dialog.showModal();
    }

    if (playlistId) {
      await loadYoutubePlaylist(playlistId);
    } else if (panel) {
      panel.style.display = "none";
    }

    await saveHistory("youtube", link.id, link.title);
    await renderHome();
    await renderLinks();

  } catch (error) {
    console.error("YouTube playback error:", error);
    toast("Could not open YouTube player");
  }
}




/* CLOSE YOUTUBE PLAYER */

if ($("closeYoutube")) {
  $("closeYoutube").onclick = () => {
    if ($("youtubeDialog")) {
      $("youtubeDialog").close();
    }
  };
}

if ($("youtubeDialog")) {
  $("youtubeDialog").onclose = () => {
    if ($("youtubeFrame")) {
      $("youtubeFrame").src = "";
    }
  };
}

/* =========================================================
   PDF LIBRARY
========================================================= */

/* UPLOAD PDF */

if ($("pdfInput")) {
  $("pdfInput").onchange = async event => {
    const files = [...event.target.files];
    const folderId = $("pdfFolder")?.value || null;

    for (const file of files) {
      if (
        file.type !== "application/pdf" &&
        !file.name.toLowerCase().endsWith(".pdf")
      ) {
        continue;
      }

      try {
        await xput("pdfs", {
          id: uid(),
          name: file.name,
          folderId,
          size: file.size,
          blob: file,
          added: Date.now(),
          lastOpened: 0
        });
      } catch (error) {
        console.error(error);
        toast("Storage full. PDF could not be saved.");
        break;
      }
    }

    event.target.value = "";

    await renderPdfs();
    await renderHome();

    toast("PDF saved on this device");
  };
}

/* PDF CARD */

function pdfCardHTML(pdf, folders) {
  return `
    <div class="video-item">
      <div class="video-thumb">PDF</div>

      <div class="video-meta">
        <b>${esc(pdf.name)}</b>

        <small>
          <span class="folder-tag">
            ${esc(folderPath(pdf.folderId, folders))}
          </span>
          · ${bytes(pdf.size || 0)}
        </small>
      </div>

      <div class="video-actions">
        <button
          class="small-btn"
          data-pdf-open="${esc(pdf.id)}"
        >
          Open
        </button>

        <button
          class="small-btn"
          data-pdf-bookmark="${esc(pdf.id)}"
        >
          ☆
        </button>

        <button
          class="small-btn danger-outline"
          data-pdf-delete="${esc(pdf.id)}"
        >
          ×
        </button>
      </div>
    </div>
  `;
}

/* RENDER PDFS */

async function renderPdfs() {
  if (!$("pdfList")) return;

  const pdfs = (await xall("pdfs"))
    .sort((a, b) => (b.added || 0) - (a.added || 0));

  const folders = await all("folders");

  const visible = pdfs.filter(pdf => {
    return !currentFolderId || pdf.folderId === currentFolderId;
  });

  $("pdfList").innerHTML = visible.length
    ? visible.map(pdf => pdfCardHTML(pdf, folders)).join("")
    : '<div class="empty">No PDFs in this folder.</div>';

  document.querySelectorAll("[data-pdf-open]").forEach(button => {
    button.onclick = () => openPdf(button.dataset.pdfOpen);
  });

  document.querySelectorAll("[data-pdf-delete]").forEach(button => {
    button.onclick = async () => {
      if (!confirm("Delete this PDF from StudyVault?")) return;

      await xdel("pdfs", button.dataset.pdfDelete);

      await renderPdfs();
      await renderHome();

      toast("PDF deleted");
    };
  });

  document.querySelectorAll("[data-pdf-bookmark]").forEach(button => {
    button.onclick = async () => {
      const pdf = await reqP(
        extraStore("pdfs").get(button.dataset.pdfBookmark)
      );

      if (pdf) {
        await addBookmark("pdf", pdf.id, pdf.name);
      }
    };
  });
}

/* OPEN PDF */

async function openPdf(id) {
  const pdf = await reqP(extraStore("pdfs").get(id));

  if (!pdf || !pdf.blob) {
    toast("PDF file not found");
    return;
  }

  pdf.lastOpened = Date.now();
  await xput("pdfs", pdf);

  if (currentPdfUrl) {
    URL.revokeObjectURL(currentPdfUrl);
  }

  currentPdfUrl = URL.createObjectURL(pdf.blob);

  if ($("pdfTitle")) {
    $("pdfTitle").textContent = pdf.name;
  }

  if ($("pdfFrame")) {
    $("pdfFrame").src = currentPdfUrl;
  }

  if ($("pdfDialog")) {
    $("pdfDialog").showModal();
  } else {
    window.open(currentPdfUrl, "_blank");
  }

  await saveHistory("pdf", pdf.id, pdf.name);
}

if ($("closePdf")) {
  $("closePdf").onclick = () => {
    if ($("pdfDialog")) {
      $("pdfDialog").close();
    }
  };
}

if ($("pdfDialog")) {
  $("pdfDialog").onclose = () => {
    if ($("pdfFrame")) {
      $("pdfFrame").src = "";
    }

    if (currentPdfUrl) {
      URL.revokeObjectURL(currentPdfUrl);
    }

    currentPdfUrl = null;
  };
}

/* =========================================================
   NOTES
========================================================= */

/* SAVE NOTE */

if ($("saveNoteBtn")) {
  $("saveNoteBtn").onclick = async () => {
    const title = $("noteTitle")?.value.trim() || "";
    const content = $("noteContent")?.value.trim() || "";
    const folderId = $("noteFolder")?.value || null;

    if (!title || !content) {
      toast("Enter note title and content");
      return;
    }

    await xput("notes", {
      id: uid(),
      title,
      content,
      folderId,
      created: Date.now(),
      updated: Date.now()
    });

    $("noteTitle").value = "";
    $("noteContent").value = "";

    await renderNotes();
    await renderHome();

    toast("Note saved");
  };
}

/* RENDER NOTES */

async function renderNotes() {
  if (!$("notesList")) return;

  const notes = (await xall("notes"))
    .sort((a, b) => (b.updated || b.created || 0) -
                    (a.updated || a.created || 0));

  const folders = await all("folders");

  const visible = notes.filter(note => {
    return !currentFolderId || note.folderId === currentFolderId;
  });

  $("notesList").innerHTML = visible.length
    ? visible.map(note => `
      <div class="video-item">
        <div class="video-thumb">N</div>

        <div class="video-meta">
          <b>${esc(note.title)}</b>

          <small>
            ${esc(folderPath(note.folderId, folders))}
          </small>

          <p>${esc((note.content || "").slice(0, 130))}</p>
        </div>

        <div class="video-actions">
          <button
            class="small-btn"
            data-note-edit="${esc(note.id)}"
          >
            Edit
          </button>

          <button
            class="small-btn"
            data-note-bookmark="${esc(note.id)}"
          >
            ☆
          </button>

          <button
            class="small-btn danger-outline"
            data-note-delete="${esc(note.id)}"
          >
            ×
          </button>
        </div>
      </div>
    `).join("")
    : '<div class="empty">No notes in this folder.</div>';

  document.querySelectorAll("[data-note-edit]").forEach(button => {
    button.onclick = async () => {
      const note = await reqP(
        extraStore("notes").get(button.dataset.noteEdit)
      );

      if (!note) return;

      const title = prompt("Edit note title", note.title);
      if (title === null) return;

      const content = prompt("Edit note content", note.content);
      if (content === null) return;

      if (!title.trim() || !content.trim()) {
        toast("Title and content cannot be empty");
        return;
      }

      note.title = title.trim();
      note.content = content.trim();
      note.updated = Date.now();

      await xput("notes", note);
      await renderNotes();
      await renderHome();

      toast("Note updated");
    };
  });

  document.querySelectorAll("[data-note-delete]").forEach(button => {
    button.onclick = async () => {
      if (!confirm("Delete this note?")) return;

      await xdel("notes", button.dataset.noteDelete);

      await renderNotes();
      await renderHome();

      toast("Note deleted");
    };
  });

  document.querySelectorAll("[data-note-bookmark]").forEach(button => {
    button.onclick = async () => {
      const note = await reqP(
        extraStore("notes").get(button.dataset.noteBookmark)
      );

      if (note) {
        await addBookmark("note", note.id, note.title);
      }
    };
  });
}

/* =========================================================
   PLANNER
========================================================= */

/* ADD TASK */

if ($("addTaskBtn")) {
  $("addTaskBtn").onclick = async () => {
    const title = $("taskTitle")?.value.trim() || "";
    const subject = $("taskSubject")?.value.trim() || "General";
    const date = $("taskDate")?.value || todayKey();
    const time = $("taskTime")?.value || "";
    const duration = Math.max(
      1,
      Number($("taskDuration")?.value) || 30
    );

    if (!title) {
      toast("Enter a task name");
      return;
    }

    await put("tasks", {
      id: uid(),
      title,
      subject,
      date,
      time,
      duration,
      done: false,
      created: Date.now()
    });

    if ($("taskTitle")) $("taskTitle").value = "";

    await renderTasks();
    await renderHome();

    toast("Task added to planner");
  };
}

/* RENDER TASKS */

async function renderTasks() {
  if (!$("taskList")) return;

  const tasks = (await all("tasks"))
    .sort((a, b) => {
      const dateCompare = String(a.date || "").localeCompare(
        String(b.date || "")
      );

      if (dateCompare !== 0) return dateCompare;

      return String(a.time || "").localeCompare(
        String(b.time || "")
      );
    });

  const selectedDate = $("plannerDate")?.value || "";

  const visible = selectedDate
    ? tasks.filter(task => task.date === selectedDate)
    : tasks;

  $("taskList").innerHTML = visible.length
    ? visible.map(task => `
      <div class="task-item ${task.done ? "completed" : ""}">
        <div class="task-main">
          <b>${esc(task.title)}</b>

          <small>
            ${esc(task.subject || "General")}
            · ${esc(task.date || "")}
            ${task.time ? " · " + esc(task.time) : ""}
            · ${fmtMin(task.duration || 0)}
          </small>
        </div>

        <div class="task-actions">
          <button
            class="small-btn"
            data-task-done="${esc(task.id)}"
          >
            ${task.done ? "Undo" : "Done"}
          </button>

          <button
            class="small-btn danger-outline"
            data-task-delete="${esc(task.id)}"
          >
            ×
          </button>
        </div>
      </div>
    `).join("")
    : '<div class="empty">No study targets for this date.</div>';

  document.querySelectorAll("[data-task-done]").forEach(button => {
    button.onclick = async () => {
      const task = await reqP(
        store("tasks").get(button.dataset.taskDone)
      );

      if (!task) return;

      task.done = !task.done;

      await put("tasks", task);
      await renderTasks();
      await renderHome();
      await renderProgress();
    };
  });

  document.querySelectorAll("[data-task-delete]").forEach(button => {
    button.onclick = async () => {
      if (!confirm("Delete this planner task?")) return;

      await del("tasks", button.dataset.taskDelete);

      await renderTasks();
      await renderHome();
      await renderProgress();

      toast("Task deleted");
    };
  });
}

if ($("plannerDate")) {
  $("plannerDate").onchange = renderTasks;
}

/* GENERATE SIMPLE TIMETABLE */

if ($("generateTimetableBtn")) {
  $("generateTimetableBtn").onclick = async () => {
    const subjects = ($("timetableSubjects")?.value || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);

    const start = $("timetableStart")?.value || "08:00";
    const end = $("timetableEnd")?.value || "20:00";
    const minutes = Math.max(
      15,
      Number($("timetableDuration")?.value) || 60
    );

    if (!subjects.length) {
      toast("Enter subjects separated by commas");
      return;
    }

    const startParts = start.split(":").map(Number);
    const endParts = end.split(":").map(Number);

    let cursor = startParts[0] * 60 + startParts[1];
    const finish = endParts[0] * 60 + endParts[1];

    if (finish <= cursor) {
      toast("End time must be after start time");
      return;
    }

    const date = $("plannerDate")?.value || todayKey();

    let index = 0;
    let created = 0;

    while (cursor + minutes <= finish && created < 100) {
      const subject = subjects[index % subjects.length];

      const hours = Math.floor(cursor / 60);
      const mins = cursor % 60;

      await put("tasks", {
        id: uid(),
        title: subject + " Study Session",
        subject,
        date,
        time:
          String(hours).padStart(2, "0") +
          ":" +
          String(mins).padStart(2, "0"),
        duration: minutes,
        done: false,
        created: Date.now()
      });

      cursor += minutes + 10;
      index++;
      created++;
    }

    await renderTasks();
    await renderHome();

    toast("Timetable created");
  };
}

/* =========================================================
   HOME DASHBOARD
========================================================= */

async function renderHome() {
  const videos = await all("videos");
  const links = await all("links");
  const pdfs = await xall("pdfs");
  const notes = await xall("notes");
  const tasks = await all("tasks");
  const folders = await all("folders");

  const completedVideos = videos.filter(video => video.completed);
  const completedTasks = tasks.filter(task => task.done);

  const totalMinutes = videos.reduce((sum, video) => {
    return sum + (
      Number(video.durationSeconds || 0) / 60
    );
  }, 0);

  const setText = (id, value) => {
    if ($(id)) $(id).textContent = value;
  };

  setText("totalVideos", videos.length);
  setText("totalLinks", links.length);
  setText("totalPdfs", pdfs.length);
  setText("totalNotes", notes.length);
  setText("completedVideos", completedVideos.length);
  setText("completedTasks", completedTasks.length);
  setText("totalStudyHours", fmtMin(totalMinutes));

  /* HOME FOLDER CARDS */

  if ($("homeFolders")) {
    const rootFolders = folders
      .filter(folder => !folder.parentId && !folder.isLinks)
      .sort((a, b) => a.name.localeCompare(b.name));

    $("homeFolders").innerHTML = rootFolders.length
      ? rootFolders.map(folder => {
          const childIds = folders
            .filter(item => item.parentId === folder.id)
            .map(item => item.id);

          const ids = [folder.id, ...childIds];

          const videoCount = videos.filter(video =>
            ids.includes(video.folderId)
          ).length;

          const linkCount = links.filter(link =>
            link.parentFolderId === folder.id ||
            ids.includes(link.folderId)
          ).length;

          const pdfCount = pdfs.filter(pdf =>
            ids.includes(pdf.folderId)
          ).length;

          const noteCount = notes.filter(note =>
            ids.includes(note.folderId)
          ).length;

          return `
            <button
              class="folder-card"
              data-open-folder="${esc(folder.id)}"
              style="--folder-color:${esc(folder.color)}"
            >
              <span class="folder-icon">📁</span>
              <b>${esc(folder.name)}</b>
              <small>
                ${videoCount} Videos · ${linkCount} Links
              </small>
              <small>
                ${pdfCount} PDFs · ${noteCount} Notes
              </small>
            </button>
          `;
        }).join("")
      : '<div class="empty">Create your first subject folder.</div>';

    document.querySelectorAll("[data-open-folder]").forEach(button => {
      button.onclick = () => openFolder(button.dataset.openFolder);
    });
  }

  /* RECENTLY WATCHED */

  if ($("recentVideos")) {
    const recent = [
      ...videos.map(video => ({
        id: video.id,
        title: video.name,
        type: "video",
        date: video.lastWatched || video.added || 0
      })),
      ...links.map(link => ({
        id: link.id,
        title: link.title,
        type: "youtube",
        date: link.lastWatched || link.added || 0
      }))
    ]
      .sort((a, b) => b.date - a.date)
      .slice(0, 6);

    $("recentVideos").innerHTML = recent.length
      ? recent.map(item => `
          <div class="task-item">
            <div class="task-main">
              <b>${esc(item.title)}</b>
              <small>${esc(item.type)}</small>
            </div>

            <button
              class="small-btn"
              data-recent-type="${esc(item.type)}"
              data-recent-id="${esc(item.id)}"
            >
              Open
            </button>
          </div>
        `).join("")
      : '<div class="empty">Your recently watched lectures will appear here.</div>';

    document.querySelectorAll("[data-recent-id]").forEach(button => {
      button.onclick = () => {
        if (button.dataset.recentType === "video") {
          playVideo(button.dataset.recentId);
        } else {
          playYoutube(button.dataset.recentId);
        }
      };
    });
  }

  /* TODAY'S PLANNER */

  if ($("todayTasks")) {
    const todayTasks = tasks.filter(task =>
      task.date === todayKey()
    );

    $("todayTasks").innerHTML = todayTasks.length
      ? todayTasks.map(task => `
          <div class="task-item">
            <div class="task-main">
              <b>${esc(task.title)}</b>
              <small>
                ${esc(task.time || "")}
                · ${fmtMin(task.duration || 0)}
              </small>
            </div>
            <b>${task.done ? "✓" : "○"}</b>
          </div>
        `).join("")
      : '<div class="empty">No tasks planned for today.</div>';
  }

  await renderBookmarks();
}

/* OPEN FOLDER */

async function openFolder(folderId) {
  const folders = await all("folders");
  const folder = folders.find(item => item.id === folderId);

  if (!folder) {
    toast("Folder not found");
    return;
  }

  currentFolderId = folderId;

  if ($("folderFilter")) {
    $("folderFilter").value = folderId;
  }

  if ($("folderViewTitle")) {
    $("folderViewTitle").textContent = folder.name;
  }

  if ($("folderBackBtn")) {
    $("folderBackBtn").hidden = false;
  }

  if ($("folderContents")) {
    $("folderContents").hidden = false;
  }

  if ($("homeFolders")) {
    $("homeFolders").hidden = true;
  }

  const show = id => {
    const element = $(id);
    if (element) element.hidden = false;
  };

  show("folderContents");
  switchTab("videos");

  await renderVideos();
  await renderLinks();
  await renderPdfs();
  await renderNotes();
}

/* BACK TO HOME FOLDERS */

function closeFolderView() {
  currentFolderId = null;

  if ($("folderFilter")) {
    $("folderFilter").value = "all";
  }

  if ($("folderBackBtn")) {
    $("folderBackBtn").hidden = true;
  }

  if ($("folderContents")) {
    $("folderContents").hidden = true;
  }

  if ($("homeFolders")) {
    $("homeFolders").hidden = false;
  }

  renderHome();
}

if ($("folderBackBtn")) {
  $("folderBackBtn").onclick = closeFolderView;
}

/* =========================================================
   END OF PART 2
   PART 3 CONTINUES WITH ANALYTICS, BOOKMARKS,
   MOCK, REMINDERS, BACKUP AND STARTUP.
========================================================= */
/* =========================================================
   STUDYVAULT - COMPLETE APP UPDATE
   PART 3 OF 3
   ANALYTICS, BOOKMARKS, MOCK, SEARCH, BACKUP, STARTUP
========================================================= */


/* =========================================================
   HISTORY
========================================================= */

async function saveHistory(type, id, title) {
  try {
    const history = await xall("history");
    const old = history.find(item =>
      item.type === type && String(item.itemId) === String(id)
    );

    const record = {
      id: old ? old.id : uid(),
      type,
      itemId: id,
      title: title || "Untitled",
      date: todayKey(),
      timestamp: Date.now()
    };

    await xput("history", record);
  } catch (error) {
    console.error("History error:", error);
  }
}


/* =========================================================
   BOOKMARKS
========================================================= */

async function addBookmark(type, id, title, url = "") {
  try {
    const bookmarks = await xall("bookmarks");
    const existing = bookmarks.find(item =>
      item.type === type && String(item.itemId) === String(id)
    );

    if (existing) {
      await xdel("bookmarks", existing.id);
      toast("Bookmark removed");
    } else {
      await xput("bookmarks", {
        id: uid(),
        type,
        itemId: id,
        title: title || "Untitled",
        url,
        createdAt: Date.now()
      });
      toast("Added to bookmarks");
    }

    await renderBookmarks();
  } catch (error) {
    console.error(error);
    toast("Bookmark update failed");
  }
}

async function renderBookmarks() {
  const container = $("bookmarkList");
  if (!container) return;

  try {
    const bookmarks = await xall("bookmarks");

    if (!bookmarks.length) {
      container.innerHTML = '<p class="empty-state">No bookmarks yet.</p>';
      return;
    }

    container.innerHTML = bookmarks
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map(item => `
        <div class="bookmark-item">
          <div>
            <strong>${esc(item.title || "Untitled")}</strong>
            <small>${esc(item.type || "")}</small>
          </div>
          <button data-open-bookmark="${esc(item.id)}">Open</button>
          <button data-remove-bookmark="${esc(item.id)}">Remove</button>
        </div>
      `).join("");

    container.querySelectorAll("[data-open-bookmark]").forEach(button => {
      button.addEventListener("click", () => {
        openBookmark(button.dataset.openBookmark);
      });
    });

    container.querySelectorAll("[data-remove-bookmark]").forEach(button => {
      button.addEventListener("click", async () => {
        await xdel("bookmarks", button.dataset.removeBookmark);
        renderBookmarks();
      });
    });
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p>Could not load bookmarks.</p>';
  }
}

async function openBookmark(bookmarkId) {
  const bookmarks = await xall("bookmarks");
  const item = bookmarks.find(b => String(b.id) === String(bookmarkId));
  if (!item) return toast("Bookmark not found");

  if (item.type === "video") {
    await playVideo(item.itemId);
  } else if (item.type === "youtube") {
    await playYoutube(item.itemId);
  } else if (item.type === "pdf") {
    await openPdf(item.itemId);
  } else if (item.type === "note") {
    switchTab("notes");
    toast("Find this note in Notes");
  }
}


/* =========================================================
   STUDY ANALYTICS
========================================================= */

async function renderProgress() {
  try {
    const videos = await all("videos");
    const folders = await all("folders");
    const tasks = await all("tasks");
    const history = await xall("history");

    const completedVideos = videos.filter(video =>
      video.completed === true ||
      video.isCompleted === true ||
      video.status === "completed"
    ).length;

    const totalVideos = videos.length;
    const completedTasks = tasks.filter(task =>
      task.completed === true || task.done === true
    ).length;

    const totalTasks = tasks.length;

    const watchedSeconds = videos.reduce((sum, video) => {
      return sum + Number(
        video.watchedSeconds ||
        video.watchTime ||
        video.progressSeconds ||
        0
      );
    }, 0);

    const hours = Math.floor(watchedSeconds / 3600);
    const minutes = Math.floor((watchedSeconds % 3600) / 60);

    const setText = (id, value) => {
      const element = $(id);
      if (element) element.textContent = value;
    };

    setText("progressVideos", totalVideos);
    setText("progressCompleted", completedVideos);
    setText("progressTasks", `${completedTasks}/${totalTasks}`);
    setText("progressWatchTime", `${hours}h ${minutes}m`);
    setText("totalVideos", totalVideos);

    const percentage = totalVideos
      ? Math.round(completedVideos / totalVideos * 100)
      : 0;

    setText("progressPercentage", `${percentage}%`);

    const bar = $("progressBar");
    if (bar) bar.style.width = `${percentage}%`;

    const subjectContainer = $("subjectProgress");

    if (subjectContainer) {
      const subjectMap = {};

      for (const folder of folders) {
        const name = folder.name || "Other";
        subjectMap[name] = {
          total: 0,
          completed: 0
        };
      }

      for (const video of videos) {
        const folder = folders.find(f =>
          String(f.id) === String(video.folderId)
        );
        const name = folder ? folder.name : "Other";

        if (!subjectMap[name]) {
          subjectMap[name] = { total: 0, completed: 0 };
        }

        subjectMap[name].total++;

        if (
          video.completed === true ||
          video.isCompleted === true ||
          video.status === "completed"
        ) {
          subjectMap[name].completed++;
        }
      }

      subjectContainer.innerHTML = Object.entries(subjectMap)
        .map(([name, data]) => {
          const percent = data.total
            ? Math.round(data.completed / data.total * 100)
            : 0;

          return `
            <div class="subject-progress-item">
              <div class="progress-heading">
                <strong>${esc(name)}</strong>
                <span>${data.completed}/${data.total}</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" style="width:${percent}%"></div>
              </div>
            </div>
          `;
        }).join("");
    }

    const dates = new Set(
      history.map(item => item.date).filter(Boolean)
    );

    let streak = 0;
    const cursor = new Date();

    while (true) {
      const key = [
        cursor.getFullYear(),
        String(cursor.getMonth() + 1).padStart(2, "0"),
        String(cursor.getDate()).padStart(2, "0")
      ].join("-");

      if (!dates.has(key)) break;

      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    setText("studyStreak", `${streak} days`);

  } catch (error) {
    console.error("Progress error:", error);
  }
}


/* =========================================================
   MOCK QUESTION BANK
   Offline sample questions. No AI generation is claimed.
========================================================= */

const studyVaultGK = [
  {
    subject: "Polity",
    difficulty: "easy",
    question: "भारतीय संविधान कब लागू हुआ? / When did the Indian Constitution come into force?",
    options: ["15 August 1947", "26 January 1950", "26 November 1949", "2 October 1950"],
    answer: 1,
    explanation: "भारतीय संविधान 26 जनवरी 1950 को लागू हुआ।",
    tip: "26 January = Republic Day."
  },
  {
    subject: "Polity",
    difficulty: "medium",
    question: "अनुच्छेद 21 किससे संबंधित है? / Article 21 deals with:",
    options: ["Equality", "Freedom of religion", "Life and personal liberty", "Education"],
    answer: 2,
    explanation: "अनुच्छेद 21 जीवन और व्यक्तिगत स्वतंत्रता की सुरक्षा देता है।",
    tip: "Article 21 = Right to Life."
  },
  {
    subject: "History",
    difficulty: "easy",
    question: "भारत छोड़ो आंदोलन कब शुरू हुआ? / When did the Quit India Movement begin?",
    options: ["1930", "1942", "1919", "1947"],
    answer: 1,
    explanation: "भारत छोड़ो आंदोलन अगस्त 1942 में शुरू हुआ।",
    tip: "Quit India = 1942."
  },
  {
    subject: "Geography",
    difficulty: "easy",
    question: "भारत की सबसे लंबी नदी कौन-सी है? / Which is the longest river in India?",
    options: ["Yamuna", "Godavari", "Ganga", "Narmada"],
    answer: 2,
    explanation: "भारत में बहने वाली सबसे लंबी नदी गंगा है।",
    tip: "Ganga is the longest river flowing within India."
  },
  {
    subject: "Economics",
    difficulty: "medium",
    question: "भारत का केंद्रीय बैंक कौन-सा है? / What is India's central bank?",
    options: ["SBI", "RBI", "NABARD", "SEBI"],
    answer: 1,
    explanation: "भारतीय रिजर्व बैंक भारत का केंद्रीय बैंक है।",
    tip: "RBI = Reserve Bank of India."
  },
  {
    subject: "Science",
    difficulty: "easy",
    question: "बल की SI इकाई क्या है? / What is the SI unit of force?",
    options: ["Joule", "Watt", "Newton", "Pascal"],
    answer: 2,
    explanation: "बल की SI इकाई न्यूटन है।",
    tip: "F = ma, unit = kg m/s² = Newton."
  },
  {
    subject: "Science",
    difficulty: "medium",
    question: "प्रकाश की चाल लगभग कितनी है? / Approximate speed of light?",
    options: ["3 × 10⁶ m/s", "3 × 10⁸ m/s", "3 × 10⁵ m/s", "3 × 10¹⁰ m/s"],
    answer: 1,
    explanation: "निर्वात में प्रकाश की चाल लगभग 3 × 10⁸ m/s है।",
    tip: "Remember 3 lakh km per second."
  },
  {
    subject: "Biology",
    difficulty: "easy",
    question: "मानव शरीर की सबसे बड़ी ग्रंथि कौन-सी है? / Largest gland in the human body?",
    options: ["Pancreas", "Thyroid", "Liver", "Pituitary"],
    answer: 2,
    explanation: "यकृत (Liver) मानव शरीर की सबसे बड़ी ग्रंथि है।",
    tip: "Liver is also a major metabolic organ."
  },
  {
    subject: "Chemistry",
    difficulty: "easy",
    question: "पानी का रासायनिक सूत्र क्या है? / Chemical formula of water?",
    options: ["CO2", "H2O", "O2", "NaCl"],
    answer: 1,
    explanation: "पानी में दो हाइड्रोजन और एक ऑक्सीजन परमाणु होता है।",
    tip: "H2O = 2 Hydrogen + 1 Oxygen."
  },
  {
    subject: "Physics",
    difficulty: "medium",
    question: "विद्युत धारा की SI इकाई क्या है? / SI unit of electric current?",
    options: ["Volt", "Ohm", "Ampere", "Coulomb"],
    answer: 2,
    explanation: "विद्युत धारा की SI इकाई एम्पियर है।",
    tip: "Current = Ampere."
  }
];


/* =========================================================
   MOCK PDF TEXT EXTRACTION
========================================================= */

async function extractPdfText(pdfRecord) {
  if (!pdfRecord || !pdfRecord.blob) return "";

  if (!window.pdfjsLib) {
    throw new Error("PDF text reader is not available in this app.");
  }

  const data = await pdfRecord.blob.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({
    data: new Uint8Array(data)
  }).promise;

  let text = "";

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    text += content.items
      .map(item => item.str || "")
      .join(" ") + "\n";
  }

  return text;
}

function makeQuestionsFromText(textContent, subject) {
  const sentences = textContent
    .replace(/\s+/g, " ")
    .split(/[।.!?]\s+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 35 && sentence.length < 300);

  return sentences.slice(0, 30).map((sentence, index) => ({
    subject: subject || "Notes",
    difficulty: "medium",
    question: `इस कथन को पढ़ें / Read the following statement:\n\n${sentence}\n\nयह प्रश्न आपके नोट्स से बनाया गया है। / This is a practice question from your notes.`,
    options: [
      "True / सही",
      "False / गलत"
    ],
    answer: 0,
    explanation: "यह कथन आपके PDF/Notes के टेक्स्ट से लिया गया है। उत्तर की पुष्टि अपने मूल नोट्स से करें।",
    tip: "अपने नोट्स के मुख्य तथ्य दोहराएँ।"
  }));
}


/* =========================================================
   MOCK ENGINE
========================================================= */

async function prepareMockQuestions() {
  const source = $("quizSource")?.value || "mixed";
  const subject = $("quizSubject")?.value || "mixed";
  const difficulty = $("quizDifficulty")?.value || "all";
  const count = Math.max(
    1,
    Math.min(100, Number($("quizCount")?.value || 10))
  );

  let questions = [];

  // General knowledge question bank
  if (source === "gk" || source === "mixed") {
    questions = questions.concat(studyVaultGK);
  }

  // Saved notes and pasted notes
  if (source === "notes" || source === "mixed") {
    const notes = await xall("notes");

    for (const note of notes) {
      const content =
        `${note.title || ""}. ${note.content || note.text || ""}`;

      questions = questions.concat(
        makeQuestionsFromText(content, note.subject)
      );
    }

    const pastedNotes = $("quizNotes")?.value?.trim() || "";

    if (pastedNotes) {
      questions = questions.concat(
        makeQuestionsFromText(pastedNotes, "Notes")
      );
    }
  }

  // Selected PDF
  if (source === "pdf") {
    const pdfId = $("quizPdf")?.value || "";

    if (!pdfId) {
      throw new Error("Please select a saved PDF first.");
    }

    const pdfs = await xall("pdfs");

    const selectedPdf = pdfs.find(
      pdf => String(pdf.id) === String(pdfId)
    );

    if (!selectedPdf) {
      throw new Error("Selected PDF not found.");
    }

    const extractedText = await extractPdfText(selectedPdf);

    questions = makeQuestionsFromText(
      extractedText,
      selectedPdf.subject || "PDF"
    );
  }

  // Subject filter: Mixed means all subjects
  if (
    subject &&
    subject !== "all" &&
    subject !== "mixed"
  ) {
    questions = questions.filter(question =>
      String(question.subject || "").toLowerCase() ===
      subject.toLowerCase()
    );
  }

  // Difficulty filter
  if (difficulty && difficulty !== "all") {
    questions = questions.filter(question =>
      question.difficulty === difficulty
    );
  }

  if (!questions.length) {
    throw new Error(
      "No questions found. Try Mixed subject or another question source."
    );
  }

  return shuffle(questions).slice(0, count);
}



function getSelectedQuizAnswer() {
  const selected = document.querySelectorAll(
    "#quizOptions input:checked"
  );

  return Array.from(selected).map(input => Number(input.value));
}

function renderMockQuestion() {
  const question = quizQuestions[quizIndex];

  if (!question) return finishMock();

  const questionContainer = $("quizQuestion");
  const optionsContainer = $("quizOptions");
  const feedbackContainer = $("quizFeedback");

  if (questionContainer) {
    questionContainer.textContent =
      `${quizIndex + 1}. ${question.question}`;
  }

  if (feedbackContainer) feedbackContainer.innerHTML = "";

  if (optionsContainer) {
    const language = $("quizLanguage");
    const languageValue = language ? language.value : "both";

    optionsContainer.innerHTML = question.options.map((option, index) => {
      return `
        <label class="mock-option">
          <input
            type="${question.type === "multiple" ? "checkbox" : "radio"}"
            name="mockAnswer"
            value="${index}"
          >
          <span>${esc(option)}</span>
        </label>
      `;
    }).join("");
  }

  const scoreElement = $("quizScore");
  if (scoreElement) {
    scoreElement.textContent =
      `Question ${quizIndex + 1}/${quizQuestions.length} | Score: ${quizScore}`;
  }

  const nextButton = $("nextQuestionBtn");
  if (nextButton) nextButton.textContent = "Submit Answer";
}

function submitMockAnswer() {
  if (quizAnswered) {
    quizIndex++;
    quizAnswered = false;

    if (quizIndex >= quizQuestions.length) {
      finishMock();
    } else {
      renderMockQuestion();
    }

    return;
  }

  const question = quizQuestions[quizIndex];
  if (!question) return;

  const selected = getSelectedQuizAnswer();

  if (!selected.length) {
    toast("Please select an answer");
    return;
  }

  const correctAnswers = Array.isArray(question.answers)
    ? question.answers.map(Number).sort()
    : [Number(question.answer)];

  const givenAnswers = selected.slice().sort();

  const correct =
    correctAnswers.length === givenAnswers.length &&
    correctAnswers.every((value, index) =>
      value === givenAnswers[index]
    );

  if (correct) {
    quizScore++;
    quizCorrect++;
  } else {
    quizWrong++;
  }

  quizAnswered = true;

  const negativeElement = $("negativeMarking");
  const negative = negativeElement
    ? Number(negativeElement.value || 0)
    : 0;

  if (!correct && negative > 0) {
    quizScore -= negative;
  }

  const optionsContainer = $("quizOptions");
  if (optionsContainer) {
    optionsContainer.querySelectorAll("input").forEach(input => {
      input.disabled = true;
    });
  }

  const feedback = $("quizFeedback");

  if (feedback) {
    feedback.innerHTML = `
      <div class="mock-feedback">
        <strong>${correct ? "Correct!" : "Incorrect"}</strong>
        <p>${esc(question.explanation || "Review the correct answer.")}</p>
        <p><strong>Tip:</strong> ${esc(question.tip || "Revise this topic.")}</p>
      </div>
    `;
  }

  const scoreElement = $("quizScore");
  if (scoreElement) {
    scoreElement.textContent =
      `Score: ${quizScore} | Correct: ${quizCorrect} | Wrong: ${quizWrong}`;
  }

  const nextButton = $("nextQuestionBtn");
  if (nextButton) nextButton.textContent = "Next Question";
}

function finishMock() {
  if (quizTimerInterval) {
    clearInterval(quizTimerInterval);
    quizTimerInterval = null;
  }

  const area = $("quizArea");

  if (area) {
    area.innerHTML = `
      <div class="mock-result">
        <h3>Mock Completed</h3>
        <h2>${quizScore}</h2>
        <p>Correct: ${quizCorrect}</p>
        <p>Wrong: ${quizWrong}</p>
        <p>Total Questions: ${quizQuestions.length}</p>
        <button onclick="location.reload()">Refresh App</button>
      </div>
    `;
  }

  toast("Mock completed");
}




/* =========================================================
   GLOBAL SEARCH
========================================================= */

async function searchStudyVault(query) {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return [];

  const [videos, links, pdfs, notes, folders] = await Promise.all([
    all("videos"),
    all("links"),
    xall("pdfs"),
    xall("notes"),
    all("folders")
  ]);

  const results = [];

  const addMatches = (items, type) => {
    for (const item of items) {
      const title = String(
        item.title || item.name || item.filename || ""
      );

      if (title.toLowerCase().includes(term)) {
        results.push({
          id: item.id,
          title,
          type
        });
      }
    }
  };

  addMatches(videos, "video");
  addMatches(links, "youtube");
  addMatches(pdfs, "pdf");
  addMatches(notes, "note");
  addMatches(folders, "folder");

  return results;
}

async function renderSearchResults(query) {
  const container = $("searchResults");
  if (!container) return;

  const results = await searchStudyVault(query);

  if (!results.length) {
    container.innerHTML = "<p>No results found.</p>";
    return;
  }

  container.innerHTML = results.map(item => `
    <div class="search-result">
      <strong>${esc(item.title)}</strong>
      <small>${esc(item.type)}</small>
      <button data-search-type="${esc(item.type)}"
              data-search-id="${esc(item.id)}">Open</button>
    </div>
  `).join("");

  container.querySelectorAll("[data-search-type]").forEach(button => {
    button.addEventListener("click", async () => {
      const type = button.dataset.searchType;
      const id = button.dataset.searchId;

      if (type === "video") await playVideo(id);
      if (type === "youtube") await playYoutube(id);
      if (type === "pdf") await openPdf(id);
      if (type === "note") switchTab("notes");
      if (type === "folder") await openFolder(id);
    });
  });
}

async function startStudyMock() {
  try {
    quizQuestions = await prepareMockQuestions();

    quizIndex = 0;
    quizScore = 0;
    quizCorrect = 0;
    quizWrong = 0;
    quizAnswered = false;
    quizSeconds = 0;

    const area = $("quizArea");

    if (!area) {
      throw new Error("Mock question area is missing.");
    }

    // Create question display elements
    area.style.display = "block";

    area.innerHTML = `
      <div class="panel mock-question-panel">
        <div id="quizTimerDisplay">Time: --:--</div>

        <div id="quizScore"></div>

        <h3 id="quizQuestion"></h3>

        <div id="quizOptions"></div>

        <div id="quizFeedback"></div>

        <button id="nextQuestionBtn" class="primary full">
          Submit Answer
        </button>
      </div>
    `;

    $("nextQuestionBtn").onclick = submitMockAnswer;

    renderMockQuestion();

    // Timer
    const seconds = Number($("quizTimer")?.value || 0);

    if (quizTimerInterval) {
      clearInterval(quizTimerInterval);
      quizTimerInterval = null;
    }

    if (seconds > 0) {
      let remaining = seconds * 60;

      const updateTimer = () => {
        const display = $("quizTimerDisplay");

        if (display) {
          display.textContent =
            `Time: ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
        }

        if (remaining <= 0) {
          finishMock();
          return;
        }

        remaining--;
      };

      updateTimer();
      quizTimerInterval = setInterval(updateTimer, 1000);
    }

    toast("Mock started");

  } catch (error) {
    console.error("Mock error:", error);
    toast(error.message || "Could not start Mock");
  }
}


/* =========================================================
   BACKUP AND RESTORE
   Metadata backup only. Video/PDF file contents are not
   included in this JSON backup.
========================================================= */

async function exportStudyVaultBackup() {
  try {
    const backup = {
      app: "StudyVault",
      version: 1,
      exportedAt: new Date().toISOString(),
      videos: await all("videos"),
      folders: await all("folders"),
      links: await all("links"),
      tasks: await all("tasks"),
      pdfs: (await xall("pdfs")).map(pdf => ({
        id: pdf.id,
        title: pdf.title,
        name: pdf.name,
        folderId: pdf.folderId
      })),
      notes: await xall("notes"),
      bookmarks: await xall("bookmarks"),
      history: await xall("history")
    };

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = "studyvault-backup.json";
    anchor.click();

    URL.revokeObjectURL(url);

    toast("Metadata backup downloaded. Video/PDF files are not included.");
  } catch (error) {
    console.error(error);
    toast("Backup failed");
  }
}

async function restoreStudyVaultBackup(file) {
  if (!file) return;

  try {
    const backup = JSON.parse(await file.text());

    if (backup.app !== "StudyVault") {
      throw new Error("This is not a StudyVault backup.");
    }

    const confirmRestore = confirm(
      "Restore this backup? Existing records with matching IDs may be replaced."
    );

    if (!confirmRestore) return;

    for (const item of backup.folders || []) {
      await put("folders", item);
    }

    for (const item of backup.videos || []) {
      await put("videos", item);
    }

    for (const item of backup.links || []) {
      await put("links", item);
    }

    for (const item of backup.tasks || []) {
      await put("tasks", item);
    }

    for (const item of backup.notes || []) {
      await xput("notes", item);
    }

    for (const item of backup.bookmarks || []) {
      await xput("bookmarks", item);
    }

    for (const item of backup.history || []) {
      await xput("history", item);
    }

    await refreshStudyVault();
    toast("Backup restored");
  } catch (error) {
    console.error(error);
    toast(error.message || "Restore failed");
  }
}


/* =========================================================
   REFRESH ALL APP CONTENT
========================================================= */

async function refreshStudyVault() {
  try {
    await renderFolderControls();
    await renderVideos();
    await renderLinks();
    await renderPdfs();
    await renderNotes();
    await renderTasks();
    await renderHome();
    await renderBookmarks();
    await renderProgress();
  } catch (error) {
    console.error("Refresh error:", error);
  }
}


/* =========================================================
   BUTTON AND INPUT CONNECTIONS
========================================================= */

function connectStudyVaultControls() {
  const connect = (id, eventName, callback) => {
    const element = $(id);
    if (!element || element.dataset.svConnected === "yes") return;

    element.addEventListener(eventName, callback);
    element.dataset.svConnected = "yes";
  };

  connect("startQuizBtn", "click", startStudyMock);
  connect("nextQuestionBtn", "click", submitMockAnswer);

  connect("globalSearch", "input", event => {
    renderSearchResults(event.target.value);
  });

  connect("backupBtn", "click", exportStudyVaultBackup);

  connect("restoreInput", "change", event => {
    const file = event.target.files && event.target.files[0];
    if (file) restoreStudyVaultBackup(file);
  });

  connect("refreshAppBtn", "click", refreshStudyVault);
}


/* =========================================================
   APP INITIALIZATION
========================================================= */

async function initializeStudyVault() {
  try {
    await openDB();
    await openExtraDB();
    await seedFolders();

    connectStudyVaultControls();

    await refreshStudyVault();

    console.log("StudyVault initialized successfully");
  } catch (error) {
    console.error("StudyVault initialization error:", error);
    toast("App initialization failed. Please reload.");
  }
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeStudyVault,
    { once: true }
  );
} else {
  initializeStudyVault();
}


/* =========================================================
   END OF STUDYVAULT APP.JS
========================================================= */
