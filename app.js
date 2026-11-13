const DB_NAME="studyvault-db", DB_VERSION=2;
const DEFAULT_FOLDERS=[
  {id:"polity",name:"Polity",color:"#9a8cff",isDefault:true},
  {id:"economics",name:"Economics",color:"#6de0c2",isDefault:true},
  {id:"geography",name:"Geography",color:"#f4b86a",isDefault:true},
  {id:"history",name:"History",color:"#ef8fa8",isDefault:true},
  {id:"physics",name:"Physics",color:"#79b8ff",isDefault:true},
  {id:"chemistry",name:"Chemistry",color:"#b6df75",isDefault:true},
  {id:"biology",name:"Biology",color:"#61d6a7",isDefault:true}
];
let db,currentVideoId=null,currentObjectUrl=null,toastTimer;
const $=id=>document.getElementById(id);
const todayKey=()=>new Date().toISOString().slice(0,10);
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains("videos"))d.createObjectStore("videos",{keyPath:"id"});if(!d.objectStoreNames.contains("tasks"))d.createObjectStore("tasks",{keyPath:"id"});if(!d.objectStoreNames.contains("settings"))d.createObjectStore("settings",{keyPath:"key"});if(!d.objectStoreNames.contains("folders"))d.createObjectStore("folders",{keyPath:"id"});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function store(name,mode="readonly"){return db.transaction(name,mode).objectStore(name)}
function reqPromise(req){return new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error)})}
async function all(name){return reqPromise(store(name).getAll())}
async function put(name,value){return reqPromise(store(name,"readwrite").put(value))}
async function del(name,id){return reqPromise(store(name,"readwrite").delete(id))}
function uid(){return crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random()}
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("show"),2600)}
function fmtMin(n){return n>=60?`${Math.floor(n/60)}h ${n%60?n%60+"m":""}`:`${n}m`}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function switchTab(name){document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===name));window.scrollTo({top:0,behavior:"smooth"});if(name==="videos"){renderFolderControls();renderVideos()}if(name==="planner")renderTasks();if(name==="progress")renderProgress()}
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.go)));
$("todayLabel").textContent=new Intl.DateTimeFormat(undefined,{weekday:"long",day:"numeric",month:"long"}).format(new Date()).toUpperCase();

async function seedFolders(){const existing=await all("folders");if(!existing.length){for(const f of DEFAULT_FOLDERS)await put("folders",f);}}
async function folderName(id){if(!id)return "Unsorted";const f=(await all("folders")).find(x=>x.id===id);return f?f.name:"Unsorted";}
async function renderFolderControls(){
  const folders=(await all("folders")).sort((a,b)=>a.name.localeCompare(b.name));
  const filter=$("folderFilter"),upload=$("uploadFolder"),manage=$("manageFolder");
  const oldFilter=filter.value,oldUpload=upload.value,oldManage=manage.value;
  filter.innerHTML='<option value="all">All folders</option><option value="">Unsorted</option>'+folders.map(f=>`<option value="${escapeHTML(f.id)}">${escapeHTML(f.name)}</option>`).join("");
  upload.innerHTML='<option value="">Unsorted</option>'+folders.map(f=>`<option value="${escapeHTML(f.id)}">${escapeHTML(f.name)}</option>`).join("");
  manage.innerHTML='<option value="">Choose a folder to customise</option>'+folders.map(f=>`<option value="${escapeHTML(f.id)}">${escapeHTML(f.name)}</option>`).join("");
  if([...filter.options].some(o=>o.value===oldFilter))filter.value=oldFilter;
  if([...upload.options].some(o=>o.value===oldUpload))upload.value=oldUpload;
  if([...manage.options].some(o=>o.value===oldManage))manage.value=oldManage;
  $("folderChips").innerHTML='<button class="folder-chip active" data-folder-chip="all">All</button><button class="folder-chip" data-folder-chip="">Unsorted</button>'+folders.map(f=>`<button class="folder-chip" data-folder-chip="${escapeHTML(f.id)}" style="--folder-color:${escapeHTML(f.color)}"><i></i>${escapeHTML(f.name)}</button>`).join("");
  document.querySelectorAll("[data-folder-chip]").forEach(b=>b.onclick=()=>{$("folderFilter").value=b.dataset.folderChip;renderVideos();document.querySelectorAll("[data-folder-chip]").forEach(x=>x.classList.toggle("active",x===b));});
}
$("folderFilter").addEventListener("change",()=>{document.querySelectorAll("[data-folder-chip]").forEach(b=>b.classList.toggle("active",b.dataset.folderChip===$("folderFilter").value));renderVideos()});
$("addFolderBtn").onclick=async()=>{const name=$("newFolderName").value.trim();if(!name){toast("Enter a folder name first");return;}const folders=await all("folders");if(folders.some(f=>f.name.toLowerCase()===name.toLowerCase())){toast("A folder with this name already exists");return;}await put("folders",{id:uid(),name,color:$("newFolderColor").value,isDefault:false});$("newFolderName").value="";await renderFolderControls();toast("Folder created");};
$("manageFolder").addEventListener("change",async()=>{const f=(await all("folders")).find(x=>x.id===$("manageFolder").value);$("editFolderName").value=f?f.name:"";$("editFolderColor").value=f?f.color:"#9a8cff";});
$("saveFolderBtn").onclick=async()=>{const id=$("manageFolder").value;if(!id){toast("Choose a folder first");return;}const f=(await all("folders")).find(x=>x.id===id);if(!f)return;const name=$("editFolderName").value.trim();if(!name){toast("Folder name cannot be empty");return;}const folders=await all("folders");if(folders.some(x=>x.id!==id&&x.name.toLowerCase()===name.toLowerCase())){toast("That folder name is already used");return;}f.name=name;f.color=$("editFolderColor").value;await put("folders",f);await renderFolderControls();$("manageFolder").value=id;toast("Folder updated");};
$("deleteFolderBtn").onclick=async()=>{const id=$("manageFolder").value;if(!id){toast("Choose a folder first");return;}const f=(await all("folders")).find(x=>x.id===id);if(!f)return;if(!confirm(`Delete folder "${f.name}"? Its videos will move to Unsorted.`))return;const videos=await all("videos");for(const v of videos){if(v.folderId===id){v.folderId=null;await put("videos",v);}}await del("folders",id);$("manageFolder").value="";$("editFolderName").value="";await renderFolderControls();await renderVideos();await renderHome();toast("Folder deleted. Videos moved to Unsorted.");};

$("videoInput").addEventListener("change",async e=>{const files=[...e.target.files],folderId=$("uploadFolder").value||null;for(const file of files){if(!file.type.startsWith("video/"))continue;try{const rec={id:uid(),name:file.name,subject:"Unsorted",folderId,size:file.size,type:file.type,blob:file,added:Date.now(),position:0};await put("videos",rec);toast("Video saved to this device");}catch(err){toast("Could not save video. Browser storage may be full.");break;}}e.target.value="";renderVideos();renderHome();});
function bytes(n){if(n<1024*1024)return (n/1024).toFixed(0)+" KB";return (n/1024/1024).toFixed(1)+" MB"}
async function renderVideos(){
  const list=await all("videos"),folders=await all("folders"),q=$("videoSearch").value.toLowerCase(),filter=$("folderFilter").value;
  const filtered=list.filter(v=>(v.name+" "+(v.subject||"")).toLowerCase().includes(q)&&(filter==="all"||(filter===""?!v.folderId:v.folderId===filter))).sort((a,b)=>b.added-a.added);
  $("allVideos").innerHTML=filtered.length?filtered.map(v=>videoHTML(v,true,folders)).join(""):'<div class="empty">No videos in this view. Add a lecture or choose another folder.</div>';
  document.querySelectorAll("[data-play]").forEach(b=>b.onclick=()=>playVideo(b.dataset.play));
  document.querySelectorAll("[data-move]").forEach(s=>s.onchange=async()=>{const v=await reqPromise(store("videos").get(s.dataset.move));if(!v)return;v.folderId=s.value||null;await put("videos",v);renderVideos();renderHome();toast("Video moved to "+(s.options[s.selectedIndex].text));});
}
function videoHTML(v,withMove=false,folders=[]){
  const folder=folders.find(f=>f.id===v.folderId);const label=folder?folder.name:"Unsorted";
  const move=withMove?`<select class="move-select" data-move="${escapeHTML(v.id)}" aria-label="Move video folder"><option value="">Unsorted</option>${folders.map(f=>`<option value="${escapeHTML(f.id)}" ${f.id===v.folderId?"selected":""}>${escapeHTML(f.name)}</option>`).join("")}</select>`:"";
  return `<div class="video-item"><div class="video-thumb">▶</div><div class="video-meta"><b>${escapeHTML(v.name)}</b><small><span class="folder-tag">${escapeHTML(label)}</span> · ${bytes(v.size)}${v.position?" · Resume available":""}</small>${move}</div><div class="video-actions"><button class="small-btn" data-play="${escapeHTML(v.id)}">Play</button></div></div>`;
}
$("videoSearch").addEventListener("input",renderVideos);
async function playVideo(id){const v=await reqPromise(store("videos").get(id));if(!v)return;currentVideoId=id;if(currentObjectUrl)URL.revokeObjectURL(currentObjectUrl);currentObjectUrl=URL.createObjectURL(v.blob);$("playerTitle").textContent=v.name;$("playerSubject").textContent=await folderName(v.folderId);$("videoPlayer").src=currentObjectUrl;$("playerDialog").showModal();$("videoPlayer").onloadedmetadata=()=>{if(v.position>0&&v.position<$("videoPlayer").duration-2)$("videoPlayer").currentTime=v.position};}
$("videoPlayer").addEventListener("timeupdate",async()=>{if(!currentVideoId||$("videoPlayer").currentTime%5>1)return;const v=await reqPromise(store("videos").get(currentVideoId));if(v){v.position=$("videoPlayer").currentTime;await put("videos",v)}});
$("closePlayer").onclick=()=>{$("videoPlayer").pause();$("playerDialog").close();};
$("playerDialog").addEventListener("close",()=>{if(currentObjectUrl)URL.revokeObjectURL(currentObjectUrl);currentObjectUrl=null;$("videoPlayer").removeAttribute("src");$("videoPlayer").load();currentVideoId=null;renderVideos()});
$("deleteVideoBtn").onclick=async()=>{if(!currentVideoId)return;if(confirm("Delete this saved video from StudyVault? Your original file on the phone is not deleted.")){await del("videos",currentVideoId);$("playerDialog").close();toast("Saved copy deleted");renderVideos();renderHome()}};

$("taskForm").addEventListener("submit",async e=>{e.preventDefault();const task={id:uid(),subject:$("subjectInput").value.trim(),topic:$("topicInput").value.trim(),duration:Math.max(5,Number($("durationInput").value)||60),priority:Number($("priorityInput").value),done:false,date:todayKey(),time:""};await put("tasks",task);e.target.reset();$("durationInput").value=60;renderTasks();renderHome();renderProgress();toast("Study target added");});
async function renderTasks(){const tasks=(await all("tasks")).sort((a,b)=>(a.done-b.done)||(b.priority-a.priority));$("plannerTasks").innerHTML=tasks.length?tasks.map(taskHTML).join(""):'<div class="empty">No study targets yet. Add a subject and topic above.</div>';document.querySelectorAll("[data-task-check]").forEach(b=>b.onclick=async()=>{const t=await reqPromise(store("tasks").get(b.dataset.taskCheck));t.done=!t.done;await put("tasks",t);renderTasks();renderHome();renderProgress()});}
function taskHTML(t){return `<div class="task-item"><button class="check ${t.done?"done":""}" data-task-check="${escapeHTML(t.id)}">${t.done?"✓":""}</button><div class="task-main"><b>${escapeHTML(t.subject)} · ${escapeHTML(t.topic)}</b><small>${fmtMin(t.duration)} · ${t.done?"Completed":"Pending"}</small></div>${t.time?`<span class="task-time">${escapeHTML(t.time)}</span>`:""}</div>`}
async function generatePlan(){const hours=Math.max(1,Math.min(16,Number($("availableHours").value)||4)),start=$("startTime").value||"07:00";const tasks=(await all("tasks")).filter(t=>!t.done).sort((a,b)=>(b.priority-a.priority)||(a.duration-b.duration));let [h,m]=start.split(":").map(Number),remaining=hours*60;for(const t of tasks){if(remaining<=0)t.time="Later";else if(t.duration<=remaining){t.time=new Date(2000,0,1,h,m).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});let end=h*60+m+t.duration;h=Math.floor(end/60)%24;m=end%60;remaining-=t.duration;}else t.time="Later";await put("tasks",t);}renderTasks();renderHome();toast("Timetable generated from your pending tasks");}
$("generateBtn").onclick=generatePlan;
async function renderHome(){const tasks=(await all("tasks")).sort((a,b)=>(a.done-b.done)),vids=(await all("videos")).sort((a,b)=>b.added-a.added),todays=tasks.filter(t=>t.date===todayKey());$("doneCount").textContent=todays.filter(t=>t.done).length;$("videoCount").textContent=vids.length;$("hoursCount").textContent=fmtMin(todays.reduce((s,t)=>s+t.duration,0));$("todayTasks").innerHTML=todays.length?todays.slice(0,5).map(taskHTML).join(""):'<div class="empty">Your day is open. Add study targets in Planner.</div>';const folders=await all("folders");$("recentVideos").innerHTML=vids.length?vids.slice(0,3).map(v=>videoHTML(v,false,folders)).join(""):'<div class="empty">Your lecture library is waiting for its first video.</div>';document.querySelectorAll("[data-task-check]").forEach(b=>b.onclick=async()=>{const t=await reqPromise(store("tasks").get(b.dataset.taskCheck));t.done=!t.done;await put("tasks",t);renderHome();renderTasks();renderProgress()});document.querySelectorAll("[data-play]").forEach(b=>b.onclick=()=>playVideo(b.dataset.play));}
async function renderProgress(){const tasks=await all("tasks"),done=tasks.filter(t=>t.done).length,total=tasks.length,pct=total?Math.round(done/total*100):0;$("progressPercent").textContent=pct+"%";$("progressRing").style.background=`conic-gradient(var(--accent2) ${pct*3.6}deg,#343d5c 0deg)`;$("progressTitle").textContent=pct===100&&total?"Excellent consistency!":total?"Keep building momentum":"A fresh start";$("progressText").textContent=total?`${done} of ${total} study targets completed.`:"Add a study target to begin tracking your progress.";$("totalTasks").textContent=total;$("completedTasks").textContent=done;$("totalMinutes").textContent=tasks.reduce((s,t)=>s+t.duration,0);}
async function exportBackup(){const tasks=await all("tasks"),folders=await all("folders");const payload={app:"StudyVault",version:2,exportedAt:new Date().toISOString(),tasks,folders};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="studyvault-backup.json";a.click();URL.revokeObjectURL(a.href);toast("Planner backup exported. Videos are not included.");}
$("exportBtn").onclick=exportBackup;$("exportSettingsBtn").onclick=exportBackup;
$("settingsBtn").onclick=()=>$("settingsDialog").showModal();$("closeSettings").onclick=()=>$("settingsDialog").close();
(async()=>{try{db=await openDB();await seedFolders();await renderFolderControls();await renderHome();await renderTasks();await renderProgress();if("serviceWorker"in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(()=>{});}catch(e){console.error(e);toast("Storage could not be initialized in this browser.");}})();