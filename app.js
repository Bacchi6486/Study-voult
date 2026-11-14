
/* STUDYVAULT MASTER UPDATE
   Existing video/task/folder database is preserved.
   Extra features use a separate database.
*/

const DB_NAME = "studyvault-db";
const DB_VERSION = 4;
const EXTRA_DB = "studyvault-extras";

const DEFAULT_FOLDERS = [
  ["polity","Polity","#9a8cff"],
  ["economics","Economics","#6de0c2"],
  ["geography","Geography","#f4b86a"],
  ["history","History","#ef8fa8"],
  ["physics","Physics","#79b8ff"],
  ["chemistry","Chemistry","#b6df75"],
  ["biology","Biology","#61d6a7"]
];

const $ = id => document.getElementById(id);
let db, extraDB;
let currentVideoId = null, currentObjectUrl = null;
let currentPdfUrl = null, toastTimer;
let quizQuestions = [], quizIndex = 0, quizScore = 0;
let quizAnswered = false, quizTimerInterval = null;
let quizSeconds = 0, quizCorrect = 0, quizWrong = 0;
let activeLibraryType = "videos";

const uid = () => crypto.randomUUID
  ? crypto.randomUUID()
  : String(Date.now()) + Math.random();

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

function toast(message) {
  const t = $("toast");
  if (!t) return;
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

function fmtMin(n) {
  n = Math.max(0, Math.round(Number(n) || 0));
  return n >= 60
    ? `${Math.floor(n/60)}h ${n%60 ? n%60+"m" : ""}`
    : `${n}m`;
}

function shuffle(arr) {
  return arr.map(x => [Math.random(),x])
    .sort((a,b) => a[0]-b[0]).map(x => x[1]);
}

function openDB() {
  return new Promise((resolve,reject) => {
    const r = indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const n of ["videos","tasks","settings","folders","links"]) {
        if (!d.objectStoreNames.contains(n)) {
          d.createObjectStore(n,{keyPath:n==="settings"?"key":"id"});
        }
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openExtraDB() {
  return new Promise((resolve,reject) => {
    const r = indexedDB.open(EXTRA_DB,1);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const n of ["pdfs","notes","bookmarks","history","settings"]) {
        if (!d.objectStoreNames.contains(n)) {
          d.createObjectStore(n,{keyPath:"id"});
        }
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function store(n,mode="readonly") {
  return db.transaction(n,mode).objectStore(n);
}

function extraStore(n,mode="readonly") {
  return extraDB.transaction(n,mode).objectStore(n);
}

const reqP = r => new Promise((resolve,reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

const all = n => reqP(store(n).getAll());
const put = (n,v) => reqP(store(n,"readwrite").put(v));
const del = (n,id) => reqP(store(n,"readwrite").delete(id));
const xall = n => reqP(extraStore(n).getAll());
const xput = (n,v) => reqP(extraStore(n,"readwrite").put(v));
const xdel = (n,id) => reqP(extraStore(n,"readwrite").delete(id));

/* NAVIGATION */

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(b =>
    b.classList.toggle("active",b.dataset.tab===name)
  );
  document.querySelectorAll(".page").forEach(p =>
    p.classList.toggle("active",p.id===name)
  );

  window.scrollTo({top:0,behavior:"smooth"});

  if (name==="videos") {
    renderFolderControls();
    renderVideos();
    renderLinks();
  }
  if (name==="pdfs") renderPdfs();
  if (name==="notes") renderNotes();
  if (name==="planner") renderTasks();
  if (name==="progress") renderProgress();
  if (name==="home") renderHome();
}

document.querySelectorAll(".tab").forEach(b =>
  b.onclick = () => switchTab(b.dataset.tab)
);

document.querySelectorAll("[data-go]").forEach(b =>
  b.onclick = () => switchTab(b.dataset.go)
);

if ($("todayLabel")) {
  $("todayLabel").textContent =
    new Intl.DateTimeFormat(undefined,{
      weekday:"long",day:"numeric",month:"long"
    }).format(new Date()).toUpperCase();
}

/* FOLDERS */

async function ensureSubjectLinks(folder) {
  const fs = await all("folders");
  let child = fs.find(x => x.parentId===folder.id && x.isLinks);

  if (!child) {
    child = {
      id:"links-"+folder.id,
      parentId:folder.id,
      name:"Links",
      color:folder.color,
      isLinks:true,
      isDefault:true
    };
    await put("folders",child);
  }
  return child;
}

async function seedFolders() {
  let fs = await all("folders");

  for (const [id,name,color] of DEFAULT_FOLDERS) {
    if (!fs.some(f=>f.id===id)) {
      await put("folders",{id,name,color,isDefault:true});
    }
  }

  fs = await all("folders");
  const roots = fs.filter(x=>!x.parentId && !x.isLinks);

  for (const f of roots) {
    const child = await ensureSubjectLinks(f);

    for (const link of await all("links")) {
      if (link.folderId===f.id && !link.parentFolderId) {
        link.parentFolderId = f.id;
        link.folderId = child.id;
        await put("links",link);
      }
    }
  }
}

async function folderName(id) {
  if (!id) return "Unsorted";
  const f = (await all("folders")).find(x=>x.id===id);
  return f ? f.name : "Unsorted";
}

function folderPath(id,folders) {
  let f = folders.find(x=>x.id===id);
  if (!f) return "Unsorted";
  const names = [f.name];

  while (f.parentId) {
    f = folders.find(x=>x.id===f.parentId);
    if (!f) break;
    names.unshift(f.name);
  }
  return names.join(" / ");
}

async function renderFolderControls() {
  const folders = await all("folders");
  const fs = folders.filter(f=>!f.isLinks)
    .sort((a,b)=>a.name.localeCompare(b.name));

  const filter = $("folderFilter");
  const upload = $("uploadFolder");
  const manage = $("manageFolder");

  if (!filter || !upload || !manage) return;

  const old = filter.value;
  const oldU = upload.value;
  const oldM = manage.value;

  const options = fs.map(f =>
    `<option value="${esc(f.id)}">${esc(folderPath(f.id,folders))}</option>`
  ).join("");

  filter.innerHTML =
    '<option value="all">All folders</option><option value="">Unsorted</option>'+options;

  upload.innerHTML =
    '<option value="">Unsorted</option>'+options;

  manage.innerHTML =
    '<option value="">Choose a folder to customise</option>'+options;

  if ([...filter.options].some(x=>x.value===old)) filter.value=old;
  if ([...upload.options].some(x=>x.value===oldU)) upload.value=oldU;
  if ([...manage.options].some(x=>x.value===oldM)) manage.value=oldM;

  if ($("newFolderParent")) {
    $("newFolderParent").innerHTML =
      '<option value="">Create in Home (top level)</option>'+options;
  }

  if ($("linkSubject")) {
    const roots = fs.filter(f=>!f.parentId);
    $("linkSubject").innerHTML = roots.map(f => {
      const child = folders.find(x=>x.parentId===f.id&&x.isLinks);
      return child
        ? `<option value="${esc(child.id)}">${esc(f.name)} / Links</option>`
        : "";
    }).join("");
  }

  if ($("pdfFolder")) {
    const oldPdf = $("pdfFolder").value;
    $("pdfFolder").innerHTML =
      '<option value="">Unsorted</option>'+options;
    if ([...$("pdfFolder").options].some(x=>x.value===oldPdf)) {
      $("pdfFolder").value=oldPdf;
    }
  }

  if ($("noteFolder")) {
    const oldNote = $("noteFolder").value;
    $("noteFolder").innerHTML =
      '<option value="">Unsorted</option>'+options;
    if ([...$("noteFolder").options].some(x=>x.value===oldNote)) {
      $("noteFolder").value=oldNote;
    }
  }

  $("folderChips").innerHTML =
    '<button class="folder-chip active" data-folder-chip="all">All</button>'+
    '<button class="folder-chip" data-folder-chip="">Unsorted</button>'+
    fs.map(f =>
      `<button class="folder-chip" data-folder-chip="${esc(f.id)}" style="--folder-color:${esc(f.color)}"><i></i>${esc(folderPath(f.id,folders))}</button>`
    ).join("");

  document.querySelectorAll("[data-folder-chip]").forEach(b => {
    b.onclick = () => {
      filter.value=b.dataset.folderChip;
      document.querySelectorAll("[data-folder-chip]").forEach(x =>
        x.classList.toggle("active",x===b)
      );
      renderVideos();
    };
  });
}

if ($("folderFilter")) {
  $("folderFilter").onchange = () => {
    document.querySelectorAll("[data-folder-chip]").forEach(b =>
      b.classList.toggle("active",b.dataset.folderChip===$("folderFilter").value)
    );
    renderVideos();
  };
}

if ($("addFolderBtn")) {
  $("addFolderBtn").onclick = async () => {
    const name=$("newFolderName").value.trim();
    if (!name) return toast("Enter a folder name");

    const parentId=$("newFolderParent").value||null;
    const fs=await all("folders");

    if (fs.some(f=>f.parentId===parentId &&
      f.name.toLowerCase()===name.toLowerCase() && !f.isLinks)) {
      return toast("Folder already exists here");
    }

    const f={
      id:uid(),name,parentId,
      color:$("newFolderColor").value,
      isDefault:false
    };

    await put("folders",f);
    if (!parentId) await ensureSubjectLinks(f);

    $("newFolderName").value="";
    await renderFolderControls();
    await renderHome();
    toast("Folder created");
  };
}

if ($("manageFolder")) {
  $("manageFolder").onchange = async () => {
    const f=(await all("folders")).find(x=>x.id===$("manageFolder").value);
    $("editFolderName").value=f?.name||"";
    $("editFolderColor").value=f?.color||"#9a8cff";
  };
}

if ($("saveFolderBtn")) {
  $("saveFolderBtn").onclick = async () => {
    const id=$("manageFolder").value;
    const f=(await all("folders")).find(x=>x.id===id);
    const name=$("editFolderName").value.trim();

    if (!f||!name) return toast("Choose a folder and enter its name");

    const fs=await all("folders");
    if (fs.some(x=>x.id!==id && x.parentId===f.parentId &&
      x.name.toLowerCase()===name.toLowerCase())) {
      return toast("That folder name is already used here");
    }

    f.name=name;
    f.color=$("editFolderColor").value;
    await put("folders",f);

    await renderFolderControls();
    $("manageFolder").value=id;
    await renderHome();
    toast("Folder updated");
  };
}

if ($("deleteFolderBtn")) {
  $("deleteFolderBtn").onclick = async () => {
    const id=$("manageFolder").value;
    const f=(await all("folders")).find(x=>x.id===id);

    if (!f) return toast("Choose a folder first");
    if (!confirm(`Delete "${f.name}"? Its content will move to Unsorted.`)) return;

    const fs=await all("folders");
    const ids=[id];
    let changed=true;

    while(changed) {
      changed=false;
      for(const x of fs) {
        if(x.parentId&&ids.includes(x.parentId)&&!ids.includes(x.id)) {
          ids.push(x.id);
          changed=true;
        }
      }
    }

    for(const v of await all("videos")) {
      if(ids.includes(v.folderId)) {
        v.folderId=null;
        await put("videos",v);
      }
    }

    for(const l of await all("links")) {
      if(ids.includes(l.folderId)||ids.includes(l.parentFolderId)) {
        l.folderId=null;
        l.parentFolderId=null;
        await put("links",l);
      }
    }

    for(const p of await xall("pdfs")) {
      if(ids.includes(p.folderId)) {
        p.folderId=null;
        await xput("pdfs",p);
      }
    }

    for(const n of await xall("notes")) {
      if(ids.includes(n.folderId)) {
        n.folderId=null;
        await xput("notes",n);
      }
    }

    for(const x of ids.reverse()) await del("folders",x);

    await renderFolderControls();
    await renderVideos();
    await renderLinks();
    await renderPdfs();
    await renderNotes();
    await renderHome();
    toast("Folder deleted. Content kept.");
  };
}

/* LOCAL VIDEO LIBRARY */

function bytes(n) {
  return n<1048576
    ? (n/1024).toFixed(0)+" KB"
    : (n/1048576).toFixed(1)+" MB";
}

function videoHTML(v,move=false,fs=[]) {
  const label=folderPath(v.folderId,fs);
  const opts=move
    ? `<select class="move-select" data-move="${esc(v.id)}"><option value="">Unsorted</option>${fs.filter(x=>!x.isLinks).map(x=>`<option value="${esc(x.id)}" ${x.id===v.folderId?"selected":""}>${esc(folderPath(x.id,fs))}</option>`).join("")}</select>`
    : "";

  return `<div class="video-item">
    <div class="video-thumb">▶</div>
    <div class="video-meta">
      <b>${esc(v.name)}</b>
      <small><span class="folder-tag">${esc(label)}</span> · ${bytes(v.size||0)}${v.position?" · Resume available":""}</small>
      ${opts}
    </div>
    <div class="video-actions">
      <button class="small-btn" data-edit-video="${esc(v.id)}">Edit title</button>
      <button class="small-btn" data-play="${esc(v.id)}">Play</button>
    </div>
  </div>`;
}

async function bindVideoButtons() {
  document.querySelectorAll("[data-edit-video]").forEach(b => {
    b.onclick=async()=>{
      const v=await reqP(store("videos").get(b.dataset.editVideo));
      if(!v)return;
      const name=prompt("Edit video title",v.name);
      if(name&&name.trim()) {
        v.name=name.trim();
        await put("videos",v);
        await renderVideos();
        await renderHome();
        toast("Video title updated");
      }
    };
  });

  document.querySelectorAll("[data-play]").forEach(b =>
    b.onclick=()=>playVideo(b.dataset.play)
  );

  document.querySelectorAll("[data-move]").forEach(s => {
    s.onchange=async()=>{
      const v=await reqP(store("videos").get(s.dataset.move));
      if(v) {
        v.folderId=s.value||null;
        await put("videos",v);
        await renderVideos();
        await renderHome();
        toast("Video moved");
      }
    };
  });
}

async function renderVideos() {
  if(!$("allVideos"))return;

  const list=await all("videos");
  const fs=await all("folders");
  const q=($("videoSearch")?.value||"").toLowerCase();
  const filter=$("folderFilter")?.value||"all";

  const arr=list.filter(v =>
    (v.name+" "+(v.subject||"")).toLowerCase().includes(q) &&
    (filter==="all"||(filter===""?!v.folderId:v.folderId===filter))
  ).sort((a,b)=>(b.added||0)-(a.added||0));

  $("allVideos").innerHTML=arr.length
    ? arr.map(v=>videoHTML(v,true,fs)).join("")
    : '<div class="empty">No videos in this view.</div>';

  await bindVideoButtons();
}

if ($("videoSearch")) $("videoSearch").oninput=renderVideos;

if ($("videoInput")) {
  $("videoInput").onchange=async e=>{
    const files=[...e.target.files];
    const folderId=$("uploadFolder").value||null;

    for(const file of files) {
      if(!file.type.startsWith("video/"))continue;

      try {
        await put("videos",{
          id:uid(),name:file.name,subject:"Unsorted",
          folderId,size:file.size,type:file.type,
          blob:file,added:Date.now(),position:0,lastWatched:0
        });
      } catch(err) {
        toast("Storage may be full. Could not save video.");
        break;
      }
    }

    e.target.value="";
    await renderVideos();
    await renderHome();
    toast("Video saved on this device");
  };
}

async function playVideo(id) {
  const v=await reqP(store("videos").get(id));
  if(!v)return;

  v.lastWatched=Date.now();
  await put("videos",v);

  currentVideoId=id;
  if(currentObjectUrl)URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl=URL.createObjectURL(v.blob);

  if($("playerTitle"))$("playerTitle").textContent=v.name;
  if($("playerSubject"))$("playerSubject").textContent=await folderName(v.folderId);

  $("videoPlayer").src=currentObjectUrl;
  $("playerDialog").showModal();

  $("videoPlayer").onloadedmetadata=()=>{
    if(v.position>0 && v.position<$("videoPlayer").duration-2) {
      $("videoPlayer").currentTime=v.position;
    }
  };

  await saveHistory("video",v.id,v.name);
  await renderHome();
}

if($("videoPlayer")) {
  $("videoPlayer").ontimeupdate=async()=>{
    if(!currentVideoId||$("videoPlayer").currentTime%5>1)return;
    const v=await reqP(store("videos").get(currentVideoId));
    if(v) {
      v.position=$("videoPlayer").currentTime;
      v.durationSeconds=$("videoPlayer").duration||v.durationSeconds||0;
      v.completed=!!(v.durationSeconds&&v.position>=v.durationSeconds-10);
      await put("videos",v);
    }
  };

  $("videoPlayer").onended=async()=>{
    if(!currentVideoId)return;
    const v=await reqP(store("videos").get(currentVideoId));
    if(v) {
      v.durationSeconds=$("videoPlayer").duration||v.durationSeconds||0;
      v.position=v.durationSeconds;
      v.completed=true;
      await put("videos",v);
      await renderHome();
      await renderProgress();
    }
  };
}

if($("closePlayer")) {
  $("closePlayer").onclick=()=>{
    $("videoPlayer").pause();
    $("playerDialog").close();
  };
}

if($("playerDialog")) {
  $("playerDialog").onclose=()=>{
    if(currentObjectUrl)URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl=null;
    $("videoPlayer").removeAttribute("src");
    $("videoPlayer").load();
    currentVideoId=null;
    renderVideos();
  };
}

if($("deleteVideoBtn")) {
  $("deleteVideoBtn").onclick=async()=>{
    if(currentVideoId&&confirm("Delete saved copy from this device?")) {
      await del("videos",currentVideoId);
      $("playerDialog").close();
      await renderVideos();
      await renderHome();
      toast("Saved copy deleted");
    }
  };
}

/* YOUTUBE LINKS */

function youtubeId(url) {
  try {
    const u=new URL(url);
    const h=u.hostname.replace(/^www\./,"");

    if(h==="youtu.be")return u.pathname.slice(1).split("/")[0];

    if(h.endsWith("youtube.com")) {
      if(u.pathname==="/watch")return u.searchParams.get("v");
      if(
        u.pathname.startsWith("/embed/")||
        u.pathname.startsWith("/shorts/")||
        u.pathname.startsWith("/live/")
      ) return u.pathname.split("/")[2];
    }
  } catch(e) {}
  return null;
}

function youtubeThumb(id) {
  return `https://img.youtube.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
}

if($("saveLinkBtn")) {
  $("saveLinkBtn").onclick=async()=>{
    const url=$("youtubeUrl").value.trim();
    const id=youtubeId(url);
    const folderId=$("linkSubject").value;
    const title=$("linkTitle").value.trim();

    if(!id)return toast("Please enter a valid YouTube link");

    const child=(await all("folders")).find(f=>f.id===folderId&&f.isLinks);

    const link={
      id:uid(),
      youtubeId:id,
      url,
      title:title||"YouTube lecture",
      folderId:child?child.id:null,
      parentFolderId:child?child.parentId:null,
      added:Date.now(),
      lastWatched:0
    };

    await put("links",link);
    $("youtubeUrl").value="";
    $("linkTitle").value="";
    await renderLinks();
    await renderHome();
    toast("YouTube link saved");
  };
}

async function renderLinks() {
  if(!$("linksList"))return;

  const links=(await all("links")).sort((a,b)=>(b.added||0)-(a.added||0));
  const fs=await all("folders");

  $("linksList").innerHTML=links.length
    ? links.map(l=>{
      const child=fs.find(x=>x.id===l.folderId&&x.isLinks);
      const parent=fs.find(x=>x.id===(l.parentFolderId||child?.parentId||l.folderId));
      return `<div class="video-item">
        <img class="video-thumb youtube-thumb" src="${youtubeThumb(l.youtubeId)}"
          alt="YouTube thumbnail" onerror="this.style.display='none'">
        <div class="video-meta">
          <b>${esc(l.title)}</b>
          <small><span class="folder-tag">${esc(parent?.name||"Unsorted")} / Links</span></small>
        </div>
        <div class="video-actions">
          <button class="small-btn" data-yplay="${esc(l.id)}">Play</button>
          <button class="small-btn danger-outline" data-ydel="${esc(l.id)}">×</button>
        </div>
      </div>`;
    }).join("")
    : '<div class="empty">No YouTube links saved yet.</div>';

  document.querySelectorAll("[data-yplay]").forEach(b =>
    b.onclick=()=>playYoutube(b.dataset.yplay)
  );

  document.querySelectorAll("[data-ydel]").forEach(b => {
    b.onclick=async()=>{
      if(confirm("Remove this saved link?")) {
        await del("links",b.dataset.ydel);
        await renderLinks();
        await renderHome();
      }
    };
  });
}

async function playYoutube(id) {
  const l=await reqP(store("links").get(id));
  if(!l)return;

  l.lastWatched=Date.now();
  await put("links",l);

  $("youtubePlayerTitle").textContent=l.title;
  $("youtubeThumbnailBox").innerHTML=
    `<img src="${youtubeThumb(l.youtubeId)}" alt="YouTube thumbnail">`;

  $("youtubeFrame").src=
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(l.youtubeId)}?autoplay=1&rel=0`;

  $("youtubeDialog").showModal();
  await saveHistory("youtube",l.id,l.title);
  await renderHome();
}

function closeYoutube() {
  if($("youtubeFrame"))$("youtubeFrame").src="";
  if($("youtubeDialog"))$("youtubeDialog").close();
}

if($("closeYoutube"))$("closeYoutube").onclick=closeYoutube;
if($("youtubeDialog"))$("youtubeDialog").onclose=()=>{
  $("youtubeFrame").src="";
};

if($("openYoutubeBtn")) {
  $("openYoutubeBtn").onclick=async()=>{
    const id=youtubeId($("youtubeFrame").src);
    if(id)window.open(`https://www.youtube.com/watch?v=${id}`,"_blank");
  };
}

/* LIBRARY TYPE FILTER */

document.querySelectorAll("[data-library-type]").forEach(b=>{
  b.onclick=()=>{
    activeLibraryType=b.dataset.libraryType;
    document.querySelectorAll("[data-library-type]").forEach(x=>
      x.classList.toggle("active",x===b)
    );

    if(activeLibraryType==="videos") {
      if($("allVideos"))$("allVideos").style.display="";
      if($("linksList"))$("linksList").style.display="none";
      renderVideos();
    } else if(activeLibraryType==="links") {
      if($("allVideos"))$("allVideos").style.display="none";
      if($("linksList"))$("linksList").style.display="";
      renderLinks();
    } else {
      switchTab("pdfs");
    }
  };
});

/* PDF LIBRARY */

if($("pdfInput")) {
  $("pdfInput").onchange=async e=>{
    const files=[...e.target.files];
    const folderId=$("pdfFolder").value||null;

    for(const file of files) {
      if(file.type!=="application/pdf"&&!file.name.toLowerCase().endsWith(".pdf"))continue;

      try {
        await xput("pdfs",{
          id:uid(),
          name:file.name,
          size:file.size,
          folderId,
          blob:file,
          added:Date.now()
        });
      } catch(err) {
        toast("PDF storage is full or unavailable");
        break;
      }
    }

    e.target.value="";
    await renderPdfs();
    await renderHome();
    toast("PDF saved on this device");
  };
}

async function renderPdfs() {
  if(!$("pdfList"))return;

  const files=await xall("pdfs");
  const folders=await all("folders");
  const q=($("pdfSearch")?.value||"").toLowerCase();

  const list=files.filter(p=>p.name.toLowerCase().includes(q))
    .sort((a,b)=>(b.added||0)-(a.added||0));

  $("pdfList").innerHTML=list.length
    ? list.map(p=>`
      <div class="video-item">
        <div class="video-thumb">PDF</div>
        <div class="video-meta">
          <b>${esc(p.name)}</b>
          <small>${esc(folderPath(p.folderId,folders))} · ${bytes(p.size||0)}</small>
        </div>
        <div class="video-actions">
          <button class="small-btn" data-pdf-open="${esc(p.id)}">Open</button>
          <button class="small-btn danger-outline" data-pdf-delete="${esc(p.id)}">×</button>
        </div>
      </div>`).join("")
    : '<div class="empty">No PDF files added yet.</div>';

  document.querySelectorAll("[data-pdf-open]").forEach(b=>
    b.onclick=()=>openPdf(b.dataset.pdfOpen)
  );

  document.querySelectorAll("[data-pdf-delete]").forEach(b=>{
    b.onclick=async()=>{
      if(confirm("Delete this PDF from StudyVault?")) {
        await xdel("pdfs",b.dataset.pdfDelete);
        await renderPdfs();
        await renderHome();
        toast("PDF deleted");
      }
    };
  });
}

if($("pdfSearch"))$("pdfSearch").oninput=renderPdfs;

async function openPdf(id) {
  const p=await reqP(extraStore("pdfs").get(id));
  if(!p)return;

  if(currentPdfUrl)URL.revokeObjectURL(currentPdfUrl);
  currentPdfUrl=URL.createObjectURL(p.blob);

  $("pdfViewerTitle").textContent=p.name;
  $("pdfViewer").src=currentPdfUrl;
  $("pdfDialog").showModal();

  await saveHistory("pdf",p.id,p.name);
}

if($("closePdf"))$("closePdf").onclick=()=>$("pdfDialog").close();

if($("pdfDialog")) {
  $("pdfDialog").onclose=()=>{
    if(currentPdfUrl)URL.revokeObjectURL(currentPdfUrl);
    currentPdfUrl=null;
    $("pdfViewer").removeAttribute("src");
  };
}

/* NOTES */

if($("saveNoteBtn")) {
  $("saveNoteBtn").onclick=async()=>{
    const title=$("noteTitle").value.trim();
    const body=$("noteBody").value.trim();

    if(!title||!body)return toast("Enter note title and content");

    await xput("notes",{
      id:uid(),
      title,
      body,
      folderId:$("noteFolder").value||null,
      updated:Date.now()
    });

    $("noteTitle").value="";
    $("noteBody").value="";
    await renderNotes();
    toast("Note saved");
  };
}

async function renderNotes() {
  if(!$("notesList"))return;

  const notes=(await xall("notes")).sort((a,b)=>b.updated-a.updated);
  const folders=await all("folders");

  $("notesList").innerHTML=notes.length
    ? notes.map(n=>`
      <div class="video-item note-item">
        <div class="video-meta">
          <b>${esc(n.title)}</b>
          <small>${esc(folderPath(n.folderId,folders))}</small>
          <p>${esc(n.body.slice(0,180))}${n.body.length>180?"…":""}</p>
        </div>
        <div class="video-actions">
          <button class="small-btn" data-note-edit="${esc(n.id)}">Edit</button>
          <button class="small-btn danger-outline" data-note-delete="${esc(n.id)}">×</button>
        </div>
      </div>`).join("")
    : '<div class="empty">Your notes will appear here.</div>';

  document.querySelectorAll("[data-note-edit]").forEach(b=>{
    b.onclick=async()=>{
      const n=await reqP(extraStore("notes").get(b.dataset.noteEdit));
      if(!n)return;
      $("noteTitle").value=n.title;
      $("noteBody").value=n.body;
      $("noteFolder").value=n.folderId||"";
      await xdel("notes",n.id);
      window.scrollTo({top:0,behavior:"smooth"});
      toast("Note loaded for editing. Save it after changes.");
    };
  });

  document.querySelectorAll("[data-note-delete]").forEach(b=>{
    b.onclick=async()=>{
      if(confirm("Delete this note?")) {
        await xdel("notes",b.dataset.noteDelete);
        renderNotes();
      }
    };
  });
}

if($("exportNotePdfBtn")) {
  $("exportNotePdfBtn").onclick=()=>{
    const title=$("noteTitle").value.trim()||"StudyVault Notes";
    const body=$("noteBody").value.trim();
    if(!body)return toast("Write or open a note first");

    const w=window.open("","_blank");
    if(!w)return toast("Allow pop-ups to export notes");

    w.document.write(`
      <!DOCTYPE html><html><head><title>${esc(title)}</title>
      <style>
      body{font-family:Arial,sans-serif;padding:35px;line-height:1.7;color:#222}
      h1{border-bottom:1px solid #ccc;padding-bottom:12px}
      pre{white-space:pre-wrap;font-family:Arial,sans-serif}
      </style></head><body>
      <h1>${esc(title)}</h1><pre>${esc(body)}</pre>
      </body></html>
    `);
    w.document.close();
    w.focus();
    setTimeout(()=>w.print(),500);
  };
}

/* PLANNER */

function taskHTML(t) {
  return `<div class="task-item">
    <button class="check ${t.done?"done":""}" data-task-check="${esc(t.id)}">${t.done?"✓":""}</button>
    <div class="task-main">
      <b>${esc(t.subject)} · ${esc(t.topic)}</b>
      <small>${fmtMin(t.duration)} · ${t.done?"Completed":"Pending"}</small>
    </div>
    ${t.time?`<span class="task-time">${esc(t.time)}</span>`:""}
    <button class="small-btn danger-outline task-delete" data-task-delete="${esc(t.id)}">Delete</button>
  </div>`;
}

async function taskActions() {
  document.querySelectorAll("[data-task-check]").forEach(b=>{
    b.onclick=async()=>{
      const t=await reqP(store("tasks").get(b.dataset.taskCheck));
      if(!t)return;
      t.done=!t.done;
      t.completedAt=t.done?Date.now():null;
      await put("tasks",t);
      await renderTasks();
      await renderHome();
      await renderProgress();
    };
  });

  document.querySelectorAll("[data-task-delete]").forEach(b=>{
    b.onclick=async()=>{
      if(!confirm("Delete this study task?"))return;
      await del("tasks",b.dataset.taskDelete);
      await renderTasks();
      await renderHome();
      await renderProgress();
      toast("Study task deleted");
    };
  });
}

async function renderTasks() {
  if(!$("plannerTasks"))return;
  const ts=(await all("tasks")).sort((a,b)=>
    (a.done-b.done)||(b.priority-a.priority)
  );

  $("plannerTasks").innerHTML=ts.length
    ? ts.map(taskHTML).join("")
    : '<div class="empty">No study targets yet. Add one above.</div>';

  await taskActions();
}

if($("taskForm")) {
  $("taskForm").onsubmit=async e=>{
    e.preventDefault();

    await put("tasks",{
      id:uid(),
      subject:$("subjectInput").value.trim(),
      topic:$("topicInput").value.trim(),
      duration:Math.max(5,+$("durationInput").value||60),
      priority:+$("priorityInput").value,
      done:false,
      date:todayKey(),
      time:""
    });

    e.target.reset();
    $("durationInput").value=60;

    await renderTasks();
    await renderHome();
    await renderProgress();
    toast("Study target added");
  };
}

async function generatePlan() {
  const hours=Math.max(1,Math.min(16,+$("availableHours").value||4));
  let [h,m]=($("startTime").value||"07:00").split(":").map(Number);
  let remaining=hours*60;

  const tasks=(await all("tasks"))
    .filter(t=>!t.done)
    .sort((a,b)=>(b.priority-a.priority)||(a.duration-b.duration));

  for(const t of tasks) {
    if(remaining<=0) t.time="Later";
    else if(t.duration<=remaining) {
      t.time=new Date(2000,0,1,h,m)
        .toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
      const end=h*60+m+t.duration;
      h=Math.floor(end/60)%24;
      m=end%60;
      remaining-=t.duration;
    } else t.time="Later";

    await put("tasks",t);
  }

  await renderTasks();
  await renderHome();
  toast("Timetable generated");
}

if($("generateBtn"))$("generateBtn").onclick=generatePlan;

/* HOME DASHBOARD */

function renderFolderNode(f,fs,vids) {
  const ids=[f.id];
  let changed=true;

  while(changed) {
    changed=false;
    for(const x of fs) {
      if(x.parentId&&ids.includes(x.parentId)&&!ids.includes(x.id)) {
        ids.push(x.id);
        changed=true;
      }
    }
  }

  const vv=vids.filter(v=>ids.includes(v.folderId));
  const total=vv.reduce((s,v)=>s+(v.durationSeconds||0),0);
  const watched=vv.reduce((s,v)=>s+Math.min(v.position||0,v.durationSeconds||v.position||0),0);
  const complete=vv.filter(v=>v.completed).length;
  const children=fs.filter(x=>x.parentId===f.id&&!x.isLinks)
    .sort((a,b)=>a.name.localeCompare(b.name));

  return `<div class="home-folder-card">
    <button class="home-folder" data-home-folder="${esc(f.id)}">
      <span class="folder-dot" style="background:${esc(f.color)}"></span>
      <b>${esc(f.name)}</b>
      <small>${vv.length} lectures · ${fmtMin(total/60)} total · ${fmtMin(watched/60)} watched · ${complete} complete</small>
    </button>
    ${children.map(c=>`<div class="nested-folder-wrap">${renderFolderNode(c,fs,vids)}</div>`).join("")}
  </div>`;
}

async function renderHome() {
  const tasks=(await all("tasks")).sort((a,b)=>(a.done-b.done));
  const vids=await all("videos");
  const today=tasks.filter(t=>t.date===todayKey());

  if($("doneCount"))$("doneCount").textContent=today.filter(t=>t.done).length;
  if($("videoCount"))$("videoCount").textContent=vids.length;
  if($("hoursCount"))$("hoursCount").textContent=fmtMin(today.reduce((s,t)=>s+t.duration,0));

  if($("todayTasks")) {
    $("todayTasks").innerHTML=today.length
      ? today.slice(0,5).map(taskHTML).join("")
      : '<div class="empty">Your day is open. Add study targets in Planner.</div>';
  }

  const fs=await all("folders");
  const roots=fs.filter(f=>!f.parentId&&!f.isLinks)
    .sort((a,b)=>a.name.localeCompare(b.name));

  if($("homeFolders")) {
    $("homeFolders").innerHTML=roots.map(f=>renderFolderNode(f,fs,vids)).join("")
      || '<div class="empty">Create your first subject folder in Videos.</div>';
  }

  document.querySelectorAll("[data-home-folder]").forEach(b=>{
    b.onclick=()=>{
      switchTab("videos");
      $("folderFilter").value=b.dataset.homeFolder;
      renderVideos();
    };
  });

  const recent=vids.filter(v=>v.lastWatched)
    .sort((a,b)=>b.lastWatched-a.lastWatched).slice(0,4);

  if($("recentlyWatched")) {
    $("recentlyWatched").innerHTML=recent.length
      ? recent.map(v=>videoHTML(v,false,fs)).join("")
      : '<div class="empty">Videos you play will appear here.</div>';
  }

  const added=[...vids].sort((a,b)=>(b.added||0)-(a.added||0)).slice(0,3);

  if($("recentVideos")) {
    $("recentVideos").innerHTML=added.length
      ? added.map(v=>videoHTML(v,false,fs)).join("")
      : '<div class="empty">Your lecture library is waiting for its first video.</div>';
  }

  document.querySelectorAll("[data-edit-video]").forEach(b=>{
    b.onclick=async()=>{
      const v=await reqP(store("videos").get(b.dataset.editVideo));
      if(!v)return;
      const name=prompt("Edit video title",v.name);
      if(name&&name.trim()) {
        v.name=name.trim();
        await put("videos",v);
        await renderVideos();
        await renderHome();
      }
    };
  });

  document.querySelectorAll("[data-play]").forEach(b=>
    b.onclick=()=>playVideo(b.dataset.play)
  );

  await taskActions();

  const pdfs=await xall("pdfs");
  const mocks=await xall("history");

  if($("homePdfCount"))$("homePdfCount").textContent=pdfs.length;
  if($("homeMockCount"))$("homeMockCount").textContent=
    mocks.filter(x=>x.type==="mock").length;

  const streak=await calculateStreak();
  if($("homeStreak"))$("homeStreak").textContent=streak;
}

/* ANALYTICS AND STUDY STREAK */

async function calculateStreak() {
  const tasks=await all("tasks");
  const dates=new Set(tasks.filter(t=>t.done).map(t=>t.date).filter(Boolean));

  let streak=0;
  const d=new Date();

  if(!dates.has(todayKey()))d.setDate(d.getDate()-1);

  while(dates.has(
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
  )) {
    streak++;
    d.setDate(d.getDate()-1);
  }

  return streak;
}

async function renderProgress() {
  const ts=await all("tasks");
  const vids=await all("videos");
  const done=ts.filter(t=>t.done).length;
  const total=ts.length;
  const pct=total?Math.round(done/total*100):0;

  if($("progressPercent"))$("progressPercent").textContent=pct+"%";

  if($("progressRing")) {
    $("progressRing").style.background=
      `conic-gradient(var(--accent2) ${pct*3.6}deg,#343d5c 0deg)`;
  }

  if($("progressTitle")) {
    $("progressTitle").textContent=
      pct===100&&total?"Excellent consistency!":total?"Keep building momentum":"A fresh start";
  }

  if($("progressText")) {
    $("progressText").textContent=total
      ? `${done} of ${total} study targets completed.`
      : "Add a study target to begin tracking progress.";
  }

  if($("totalTasks"))$("totalTasks").textContent=total;
  if($("completedTasks"))$("completedTasks").textContent=done;
  if($("totalMinutes"))$("totalMinutes").textContent=
    ts.reduce((s,t)=>s+t.duration,0);

  const watched=vids.reduce((s,v)=>s+(v.position||0),0);

  if($("analyticsStudyHours")) {
    $("analyticsStudyHours").textContent=
      (watched/3600).toFixed(1)+" h";
  }

  if($("analyticsStreak")) {
    $("analyticsStreak").textContent=await calculateStreak();
  }

  const history=await xall("history");
  const mocks=history.filter(x=>x.type==="mock");
  const avg=mocks.length
    ? Math.round(mocks.reduce((s,x)=>s+(x.percent||0),0)/mocks.length)
    : 0;

  if($("analyticsMockAverage")) {
    $("analyticsMockAverage").textContent=avg+"%";
  }

  const subjects={};
  for(const t of ts) {
    const key=t.subject||"Other";
    if(!subjects[key])subjects[key]={total:0,done:0,minutes:0};
    subjects[key].total++;
    if(t.done)subjects[key].done++;
    subjects[key].minutes+=t.duration||0;
  }

  if($("subjectAnalytics")) {
    $("subjectAnalytics").innerHTML=Object.keys(subjects).length
      ? Object.entries(subjects).map(([name,s])=>`
        <div class="task-item">
          <div class="task-main">
            <b>${esc(name)}</b>
            <small>${s.done}/${s.total} targets · ${fmtMin(s.minutes)}</small>
          </div>
          <b>${Math.round(s.done/s.total*100)}%</b>
        </div>`).join("")
      : '<div class="empty">Subject analytics will appear after you add study targets.</div>';
  }

  const weak=Object.entries(subjects)
    .filter(([,s])=>s.total>0)
    .sort((a,b)=>(a[1].done/a[1].total)-(b[1].done/b[1].total))
    .slice(0,3);

  if($("weakTopics")) {
    $("weakTopics").innerHTML=weak.length
      ? weak.map(([name,s])=>`
        <div class="task-item">
          <div class="task-main"><b>${esc(name)}</b>
          <small>${s.done} of ${s.total} completed</small></div>
        </div>`).join("")
      : '<div class="empty">No weak subjects detected yet.</div>';
  }

  await renderBookmarks();
}

/* BOOKMARKS */

async function addBookmark(type,id,title,url="") {
  const existing=(await xall("bookmarks"))
    .find(b=>b.type===type&&b.itemId===id);

  if(existing) {
    await xdel("bookmarks",existing.id);
    toast("Bookmark removed");
  } else {
    await xput("bookmarks",{
      id:uid(),type,itemId:id,title,url,added:Date.now()
    });
    toast("Added to bookmarks");
  }
  await renderBookmarks();
}

async function renderBookmarks() {
  if(!$("bookmarkList"))return;

  const items=await xall("bookmarks");

  $("bookmarkList").innerHTML=items.length
    ? items.map(b=>`
      <div class="task-item">
        <div class="task-main"><b>${esc(b.title)}</b>
        <small>${esc(b.type)}</small></div>
        <button class="small-btn danger-outline" data-bookmark-remove="${esc(b.id)}">Remove</button>
      </div>`).join("")
    : '<div class="empty">Save useful lectures and notes as bookmarks.</div>';

  document.querySelectorAll("[data-bookmark-remove]").forEach(b=>{
    b.onclick=async()=>{
      await xdel("bookmarks",b.dataset.bookmarkRemove);
      renderBookmarks();
    };
  });
}

/* HISTORY */

async function saveHistory(type,id,title) {
  await xput("history",{
    id:uid(),type,itemId:id,title,at:Date.now()
  });
}

/* MOCK QUESTION BANK */

const GK = [
["Polity","Which part of the Constitution contains Fundamental Rights?","Part III",["Part II","Part IV","Part IVA"],"Fundamental Rights are listed in Part III."],
["Polity","Who is the constitutional head of the Union?","President",["Prime Minister","Chief Justice","Lok Sabha Speaker"],"The President is the constitutional head of the Union."],
["Polity","The Anti-Defection Law is in which Schedule?","Tenth Schedule",["Ninth Schedule","Eleventh Schedule","Twelfth Schedule"],"The Tenth Schedule deals with disqualification on grounds of defection."],
["Geography","Which is the longest river in India by length within the country?","Ganga",["Godavari","Narmada","Krishna"],"The Ganga is generally identified as India's longest river."],
["Geography","Black soil is especially suitable for which crop?","Cotton",["Tea","Jute","Coffee"],"Black soil retains moisture and is well suited to cotton."],
["History","Who founded the Mughal Empire in India?","Babur",["Akbar","Humayun","Sher Shah Suri"],"Babur established Mughal rule after the First Battle of Panipat in 1526."],
["History","The Qutub Minar was begun by whom?","Qutb-ud-din Aibak",["Iltutmish","Alauddin Khilji","Balban"],"Qutb-ud-din Aibak began its construction."],
["Economics","What does GDP measure?","Value of final goods and services produced within a country",["Only exports","Government tax revenue","Total money supply"],"GDP measures the value of final goods and services produced within a country's borders."],
["Physics","What is the SI unit of force?","Newton",["Joule","Watt","Pascal"],"Force is measured in newtons."],
["Physics","Which instrument measures electric current?","Ammeter",["Voltmeter","Barometer","Ohmmeter"],"An ammeter measures electric current."],
["Chemistry","What is the chemical symbol of sodium?","Na",["So","S","N"],"Sodium's symbol is Na."],
["Chemistry","A solution with pH below 7 is generally what?","Acidic",["Basic","Neutral","Saline"],"At standard conditions, pH below 7 indicates an acidic solution."],
["Biology","Which cell organelle is called the powerhouse of the cell?","Mitochondrion",["Ribosome","Nucleus","Golgi body"],"Mitochondria generate most cellular ATP."],
["Biology","Which pigment helps plants absorb light for photosynthesis?","Chlorophyll",["Haemoglobin","Melanin","Keratin"],"Chlorophyll absorbs light energy for photosynthesis."]
];

function noteQuestions(textValue) {
  const sentences=textValue.split(/[.!?\n]+/)
    .map(s=>s.trim()).filter(s=>s.split(/\s+/).length>=5);

  const out=[];

  for(const sentence of shuffle(sentences)) {
    const words=sentence.match(/[A-Za-z][A-Za-z-]{3,}/g)||[];
    const candidates=words.filter(w=>
      !["which","their","there","these","those","about","between","because","where","after","before"].includes(w.toLowerCase())
    );

    if(!candidates.length)continue;

    const answer=candidates[Math.floor(Math.random()*candidates.length)];
    const masked=sentence.replace(answer,"_____");
    const distract=shuffle([...new Set(words.filter(w=>w.toLowerCase()!==answer.toLowerCase()))]).slice(0,3);

    while(distract.length<3)distract.push("Option "+(distract.length+1));

    out.push({
      q:`Complete the statement: ${masked}`,
      a:answer,
      o:shuffle([answer,...distract]),
      why:`Answer taken from your notes: ${sentence}`,
      type:"single"
    });

    if(out.length>=20)break;
  }

  return out;
}

function makeGKQuestions(subject,language) {
  let bank=GK.filter(q=>subject==="mixed"||q[0].toLowerCase()===subject.toLowerCase());

  if(language==="hi") {
    const translations={
      "Which part of the Constitution contains Fundamental Rights?":"मौलिक अधिकार संविधान के किस भाग में हैं?",
      "Who is the constitutional head of the Union?":"संघ का संवैधानिक प्रमुख कौन है?",
      "The Anti-Defection Law is in which Schedule?":"दल-बदल विरोधी कानून किस अनुसूची में है?",
      "Which is the longest river in India by length within the country?":"भारत में देश के भीतर सबसे लंबी नदी कौन सी है?",
      "Black soil is especially suitable for which crop?":"काली मिट्टी किस फसल के लिए विशेष रूप से उपयुक्त है?",
      "Who founded the Mughal Empire in India?":"भारत में मुगल साम्राज्य की स्थापना किसने की?",
      "The Qutub Minar was begun by whom?":"कुतुब मीनार का निर्माण किसने शुरू करवाया?",
      "What does GDP measure?":"GDP क्या मापता है?",
      "What is the SI unit of force?":"बल की SI इकाई क्या है?",
      "Which instrument measures electric current?":"विद्युत धारा मापने का यंत्र कौन सा है?",
      "What is the chemical symbol of sodium?":"सोडियम का रासायनिक संकेत क्या है?",
      "A solution with pH below 7 is generally what?":"pH 7 से कम वाला विलयन सामान्यतः कैसा होता है?",
      "Which cell organelle is called the powerhouse of the cell?":"कोशिका का पावरहाउस किस अंगक को कहा जाता है?",
      "Which pigment helps plants absorb light for photosynthesis?":"प्रकाश संश्लेषण के लिए पौधे किस वर्णक से प्रकाश अवशोषित करते हैं?"
    };
    bank=bank.map(q=>[q[0],translations[q[1]]||q[1],q[2],q[3],q[4]]);
  }

  return bank.map(q=>({
    q:q[1],a:q[2],o:shuffle([q[2],...q[3]]),why:q[4],type:"single"
  }));
}

/* PDF TEXT EXTRACTION FOR MOCK */

async function extractPdfText(file) {
  if(!window.pdfjsLib) {
    await new Promise((resolve,reject)=>{
      const s=document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload=resolve;
      s.onerror=reject;
      document.head.appendChild(s);
    });
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc=
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const data=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data}).promise;
  let text="";

  for(let i=1;i<=pdf.numPages;i++) {
    const page=await pdf.getPage(i);
    const content=await page.getTextContent();
    text+=content.items.map(x=>x.str).join(" ")+"\n";
  }

  return text;
}

/* MOCK ENGINE */

function prepareQuestion(q,index) {
  return {
    id:uid(),
    q:q.q,
    a:q.a,
    o:q.o||[],
    why:q.why||"",
    type:q.type||"single",
    index
  };
}

if($("startQuizBtn")) {
  $("startQuizBtn").onclick=async()=>{
    try {
      const source=$("quizSource").value;
      const subject=$("quizSubject").value;
      const language=$("quizLanguage").value;
      const notes=$("quizNotes").value.trim();
      const difficulty=$("quizDifficulty").value;
      const count=Math.max(1,Math.min(100,+$("quizCount").value||10));

      let bank=[];

      if(source==="notes"||source==="both") {
        bank.push(...noteQuestions(notes));
      }

      if(source==="gk"||source==="both") {
        bank.push(...makeGKQuestions(subject,language));
      }

      if(source==="pdf") {
        const file=$("quizPdf").files[0];
        if(!file) {
          $("quizArea").innerHTML='<div class="empty">Choose a PDF file first.</div>';
          return;
        }
        toast("Reading PDF. Please wait...");
        const extracted=await extractPdfText(file);
        bank.push(...noteQuestions(extracted));
      }

      if(!bank.length) {
        $("quizArea").innerHTML=
          '<div class="empty">No questions found. Paste clear notes or select GK mode.</div>';
        return;
      }

      quizQuestions=shuffle(bank).slice(0,count).map(prepareQuestion);
      quizIndex=0;
      quizScore=0;
      quizCorrect=0;
      quizWrong=0;
      quizAnswered=false;

      const minutes=+$("quizTimer").value||0;
      quizSeconds=minutes*60;

      clearInterval(quizTimerInterval);
      if(minutes>0) {
        quizTimerInterval=setInterval(()=>{
          quizSeconds--;
          const timer=$("mockTimer");
          if(timer)timer.textContent=
            `${Math.floor(quizSeconds/60)}:${String(quizSeconds%60).padStart(2,"0")}`;
          if(quizSeconds<=0)finishMock();
        },1000);
      }

      showQuestion();
    } catch(err) {
      console.error(err);
      $("quizArea").innerHTML=
        '<div class="empty">Could not create the Mock. Check the PDF or notes and try again.</div>';
    }
  };
}

function showQuestion() {
  if(quizIndex>=quizQuestions.length)return finishMock();

  const q=quizQuestions[quizIndex];
  const multiple=$("questionType")?.value==="multiple";

  $("quizArea").innerHTML=`
    <div class="panel quiz-card">
      <div class="quiz-progress">
        Question ${quizIndex+1} of ${quizQuestions.length}
        · Correct ${quizCorrect} · Wrong ${quizWrong}
        <span id="mockTimer"></span>
      </div>
      <h3>${esc(q.q)}</h3>
      <div class="quiz-options">
        ${q.o.map((o,i)=>`
          <button class="quiz-option" data-answer="${i}">
            ${String.fromCharCode(65+i)}. ${esc(o)}
          </button>`).join("")}
      </div>
      <div id="quizFeedback"></div>
      <button id="quizNext" class="primary full" disabled>
        ${quizIndex===quizQuestions.length-1?"Finish Mock":"Next question"}
      </button>
    </div>`;

  document.querySelectorAll("[data-answer]").forEach(b=>
    b.onclick=()=>answerQuestion(+b.dataset.answer)
  );

  $("quizNext").onclick=nextQuestion;
}

function answerQuestion(index) {
  if(quizAnswered)return;
  quizAnswered=true;

  const q=quizQuestions[quizIndex];
  const chosen=q.o[index];
  const correct=chosen===q.a;

  const positive=+$("positiveMarks")?.value||1;
  const negative=+$("negativeMarks")?.value||0;

  if(correct) {
    quizCorrect++;
    quizScore+=positive;
  } else {
    quizWrong++;
    quizScore-=negative;
  }

  document.querySelectorAll("[data-answer]").forEach((b,j)=>{
    b.disabled=true;
    if(q.o[j]===q.a)b.classList.add("correct");
    else if(j===index)b.classList.add("incorrect");
  });

  $("quizFeedback").innerHTML=`
    <p class="${correct?"correct-text":"wrong-text"}">
      ${correct?"Correct!":"Incorrect. Correct answer: "+esc(q.a)}
    </p>
    <p class="muted small">${esc(q.why)}</p>`;

  $("quizNext").disabled=false;
}

function nextQuestion() {
  if(!quizAnswered)return;
  quizIndex++;
  quizAnswered=false;
  if(quizIndex<quizQuestions.length)showQuestion();
  else finishMock();
}

async function finishMock() {
  clearInterval(quizTimerInterval);

  const total=quizQuestions.length;
  const percent=total?Math.round(quizCorrect/total*100):0;

  await xput("history",{
    id:uid(),
    type:"mock",
    title:"StudyVault Mock",
    score:quizScore,
    correct:quizCorrect,
    wrong:quizWrong,
    total,
    percent,
    date:Date.now()
  });

  $("quizArea").innerHTML=`
    <div class="panel quiz-card">
      <p class="eyebrow">MOCK COMPLETE</p>
      <h2>${quizScore} Marks</h2>
      <p class="muted">Accuracy: ${percent}%</p>
      <p>Correct: ${quizCorrect} · Wrong: ${quizWrong} · Total: ${total}</p>
      <button id="retryQuiz" class="primary full">Try another Mock</button>
    </div>`;

  $("retryQuiz").onclick=()=>$("startQuizBtn").click();

  await renderMockHistory();
  await renderProgress();
  toast("Mock result saved");
}

async function renderMockHistory() {
  if(!$("mockHistory"))return;

  const history=(await xall("history"))
    .filter(x=>x.type==="mock")
    .sort((a,b)=>b.date-a.date)
    .slice(0,10);

  $("mockHistory").innerHTML=history.length
    ? history.map(x=>`
      <div class="task-item">
        <div class="task-main">
          <b>${esc(x.title)}</b>
          <small>${x.correct}/${x.total} correct · ${x.percent}%</small>
        </div>
        <b>${x.score} marks</b>
      </div>`).join("")
    : '<div class="empty">Your Mock results will appear here.</div>';
}

/* REMINDERS */

if($("saveReminderBtn")) {
  $("saveReminderBtn").onclick=async()=>{
    const enabled=$("reminderEnabled").checked;
    const time=$("reminderTime").value;

    if(enabled&&!time)return toast("Choose a reminder time");

    if(enabled&&"Notification" in window&&Notification.permission==="default") {
      const permission=await Notification.requestPermission();
      if(permission!=="granted") {
        toast("Notification permission not granted");
      }
    }

    await xput("settings",{
      id:"reminder",
      enabled,
      time
    });

    toast("Reminder settings saved");
  };
}

async function checkReminder() {
  const setting=await reqP(extraStore("settings").get("reminder"));
  if(!setting?.enabled||!setting.time)return;

  const now=new Date();
  const current=
    `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  const key="studyvault-reminder-"+todayKey();
  if(current===setting.time&&!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key,"1");

    if("Notification" in window&&Notification.permission==="granted") {
      new Notification("StudyVault",{body:"Your study reminder is here. Time to study!"});
    } else {
      toast("StudyVault reminder: Time to study!");
    }
  }
}

/* BACKUP AND RESTORE */

function downloadFile(blob,name) {
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

async function exportBackup() {
  const payload={
    app:"StudyVault",
    version:4,
    exportedAt:new Date().toISOString(),
    tasks:await all("tasks"),
    folders:await all("folders"),
    links:await all("links"),
    settings:await reqP(store("settings").getAll()),
    pdfs:await xall("pdfs"),
    notes:await xall("notes"),
    bookmarks:await xall("bookmarks"),
    history:await xall("history"),
    extraSettings:await xall("settings")
  };

  const serializable=JSON.parse(JSON.stringify(payload, (key,value)=>{
    if(value instanceof Blob)return undefined;
    return value;
  }));

  downloadFile(
    new Blob([JSON.stringify(serializable,null,2)],{type:"application/json"}),
    "studyvault-backup.json"
  );

  toast("Backup exported. Video and PDF file contents are not included.");
}

async function restoreBackup(file) {
  try {
    const data=JSON.parse(await file.text());

    if(data.app!=="StudyVault") {
      return toast("This is not a StudyVault backup");
    }

    if(!confirm("Restore this backup? Existing videos will remain untouched."))return;

    for(const t of data.tasks||[])await put("tasks",t);
    for(const f of data.folders||[])await put("folders",f);
    for(const l of data.links||[])await put("links",l);

    for(const p of data.pdfs||[]) {
      if(p.blob)await xput("pdfs",p);
    }
    for(const n of data.notes||[])await xput("notes",n);
    for(const b of data.bookmarks||[])await xput("bookmarks",b);
    for(const h of data.history||[])await xput("history",h);
    for(const s of data.extraSettings||[])await xput("settings",s);

    await seedFolders();
    await renderFolderControls();
    await renderHome();
    await renderTasks();
    await renderPdfs();
    await renderNotes();
    await renderProgress();

    toast("Backup restored. Existing videos were preserved.");
  } catch(err) {
    console.error(err);
    toast("Could not restore this backup file");
  }
}

if($("exportBtn"))$("exportBtn").onclick=exportBackup;
if($("settingsBtn"))$("settingsBtn").onclick=()=>$("settingsDialog").showModal();
if($("closeSettings"))$("closeSettings").onclick=()=>$("settingsDialog").close();
if($("exportSettingsBtn"))$("exportSettingsBtn").onclick=exportBackup;

if($("restoreInput")) {
  $("restoreInput").onchange=async e=>{
    const file=e.target.files[0];
    if(file)await restoreBackup(file);
    e.target.value="";
  };
}

/* STARTUP */

(async()=>{
  try {
    db=await openDB();
    extraDB=await openExtraDB();

    await seedFolders();
    await renderFolderControls();
    await renderHome();
    await renderTasks();
    await renderProgress();
    await renderVideos();
    await renderLinks();
    await renderPdfs();
    await renderNotes();
    await renderMockHistory();

    if($("reminderEnabled")) {
      const setting=await reqP(extraStore("settings").get("reminder"));
      if(setting) {
        $("reminderEnabled").checked=!!setting.enabled;
        $("reminderTime").value=setting.time||"";
      }
    }

    await checkReminder();
    setInterval(checkReminder,30000);

    if("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./sw.js").catch(()=>{});
    }

  } catch(err) {
    console.error("StudyVault startup error:",err);
    toast("Storage could not be initialized. Reload the app.");
  }
})();
