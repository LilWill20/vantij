// Creator-only page: fill in the metadata, then upload the file straight to
// Blob Storage via a SAS URL, then publish (which starts transcription).
const GENRES = ["Action","Comedy","Documentary","Drama","Education","Music","Sports","Tech","Other"];
const AGES = ["U","PG","12","15","18"];

async function initAdmin() {
  await Auth.load();
  renderHeader("admin");
  if (!Auth.isAuthed()) { showGate("Please sign in as a creator to upload."); return; }
  if (!Auth.isCreator()) { showGate("Your account is a consumer. Only creators can upload videos."); return; }
  document.getElementById("main").innerHTML = formHtml();
}

function showGate(msg){ document.getElementById("main").innerHTML = `<div class="formwrap center"><p class="note">${escapeHtml(msg)}</p><button class="btn" onclick="Auth.login()">Sign in</button></div>`; }

function formHtml() {
  return `<div class="formwrap">
    <h2>Upload a video</h2>
    <p class="note">Creators only. Set the metadata, choose a file, then publish.</p>
    <div id="msg"></div>
    <div class="field"><label>Title *</label><input id="title" maxlength="120" placeholder="e.g. How HDFS splits a file"></div>
    <div class="row">
      <div class="field"><label>Publisher</label><input id="publisher" placeholder="e.g. Vantij Originals"></div>
      <div class="field"><label>Producer</label><input id="producer" placeholder="e.g. J. Smith"></div>
    </div>
    <div class="row">
      <div class="field"><label>Genre</label><select id="genre">${GENRES.map(g=>`<option>${g}</option>`).join("")}</select></div>
      <div class="field"><label>Age rating</label><select id="age">${AGES.map(a=>`<option ${a==='PG'?'selected':''}>${a}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Video file * (mp4 / webm / mov)</label><input id="file" type="file" accept="video/mp4,video/webm,video/quicktime"></div>
    <div class="progress"><i id="bar"></i></div>
    <div style="margin-top:14px"><button class="btn" id="go" onclick="publish()">Upload &amp; publish</button></div>
  </div>`;
}

function msg(kind, text){ document.getElementById("msg").innerHTML = `<div class="msg ${kind}">${escapeHtml(text)}</div>`; }

async function publish() {
  const title = val("title"), publisher = val("publisher"), producer = val("producer");
  const genre = val("genre"), ageRating = val("age");
  const file = document.getElementById("file").files[0];
  if (!title) return msg("err", "Title is required.");
  if (!file)  return msg("err", "Please choose a video file.");
  const go = document.getElementById("go"); go.disabled = true; msg("ok", "Creating video…");
  try {
    // 1. metadata -> get SAS upload URL
    const { video, uploadUrl } = await API.createVideo({
      title, publisher, producer, genre, ageRating, fileName: file.name
    });
    // 2. upload the file straight to Blob Storage
    msg("ok", "Uploading…");
    await API.uploadToBlob(uploadUrl, file, p => { document.getElementById("bar").style.width = Math.round(p*100)+"%"; });
    // 3. publish + start transcription
    msg("ok", "Publishing…");
    await API.completeVideo(video.id);
    msg("ok", "Published! Transcription is running in the background.");
    setTimeout(() => location.href = "/watch.html?id=" + video.id, 1200);
  } catch (e) {
    msg("err", e.message); go.disabled = false;
  }
}
function val(id){ return (document.getElementById(id).value || "").trim(); }
