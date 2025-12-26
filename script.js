// CONFIGURATION
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwLBvnrlj8eTfp3NbXoIFxWfvs4BNC_L0YZbez87IMn9ZH5p78qLEPRVGLwI0l3M9MY/exec";

let db, mediaRecorder, chunks = [], finalTranscript = "", currentEntryId = null;
let audioCtx, analyser, dataArray, animId;

// 1. DATABASE INITIALIZATION
const request = indexedDB.open("BABRN_Universal_DB", 2);
request.onupgradeneeded = e => e.target.result.createObjectStore("sessions", { keyPath: "id" });
request.onsuccess = e => { db = e.target.result; loadLibrary(); };

// 2. AUDIO VISUALIZER
function startVisualizer(stream) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const canvas = document.getElementById('visualizer');
    const ctx = canvas.getContext('2d');
    
    function draw() {
        animId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let x = 0;
        const barWidth = canvas.width / dataArray.length;
        for (let i = 0; i < dataArray.length; i++) {
            const h = (dataArray[i] / 255) * canvas.height;
            ctx.fillStyle = '#10b981';
            ctx.fillRect(x, canvas.height - h, barWidth - 2, h);
            x += barWidth;
        }
    }
    draw();
}

// 3. SPEECH RECOGNITION
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.continuous = true;
recognition.interimResults = true;
recognition.lang = 'en-US'; // Change to 'fil-PH' for Tagalog

recognition.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + " ";
        else interim += e.results[i][0].transcript;
    }
    document.getElementById('output').value = finalTranscript + interim;
};

// 4. RECORDING CONTROLS
document.getElementById('start-btn').onclick = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        startVisualizer(stream);
        mediaRecorder = new MediaRecorder(stream);
        chunks = [];
        mediaRecorder.ondataavailable = e => chunks.push(e.data);
        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            saveToLocal(blob);
            stream.getTracks().forEach(t => t.stop());
            cancelAnimationFrame(animId);
            audioCtx.close();
        };
        mediaRecorder.start();
        recognition.start();
        document.getElementById('start-btn').classList.add('hidden');
        document.getElementById('stop-btn').classList.remove('hidden');
        document.getElementById('recording-indicator').classList.remove('hidden');
    } catch (err) { alert("Mic access denied"); }
};

document.getElementById('stop-btn').onclick = () => {
    mediaRecorder.stop();
    recognition.stop();
    document.getElementById('start-btn').classList.remove('hidden');
    document.getElementById('stop-btn').classList.add('hidden');
    document.getElementById('recording-indicator').classList.add('hidden');
};

// 5. STORAGE & SYNC FUNCTIONS
function saveToLocal(blob) {
    const id = Date.now();
    const title = document.getElementById('session-title').value || "Untitled Meeting";
    const text = document.getElementById('output').value;
    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").add({ id, title, text, date: new Date().toLocaleString(), blob });
    currentEntryId = id;
    document.getElementById('save-status').innerText = "✓ Saved Local";
}

async function syncToGoogleSheets() {
    const title = document.getElementById('session-title').value;
    const text = document.getElementById('output').value;
    const btn = document.getElementById('cloud-sync-btn');
    if(!title) return alert("Title is required");

    btn.innerHTML = `<i class="fas fa-spinner animate-spin"></i> SYNCING...`;
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({ title, text, date: new Date().toLocaleString() })
        });
        alert("Synced to Google Sheets!");
    } catch (err) { alert("Sync Error"); }
    btn.innerHTML = `<i class="fas fa-cloud-upload-alt mr-1"></i> Sync to Google Sheets`;
}

function loadLibrary() {
    const list = document.getElementById('library-list');
    const query = document.getElementById('library-search').value.toLowerCase();
    list.innerHTML = "";
    let count = 0;

    db.transaction("sessions", "readonly").objectStore("sessions").openCursor(null, 'prev').onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            const doc = cursor.value;
            if (doc.title.toLowerCase().includes(query) || doc.text.toLowerCase().includes(query)) {
                count++;
                const div = document.createElement('div');
                div.className = "bg-white p-6 rounded-2xl border border-slate-200 shadow-sm";
                div.innerHTML = `
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-[10px] font-bold text-emerald-600 uppercase">${doc.date}</span>
                        <button onclick="deleteEntry(${doc.id})" class="text-slate-300 hover:text-red-500"><i class="fas fa-trash"></i></button>
                    </div>
                    <h3 class="text-sm font-bold text-slate-800 mb-4 uppercase truncate">${doc.title}</h3>
                    <div class="grid grid-cols-2 gap-2">
                        <button onclick="openEditor(${doc.id})" class="bg-slate-800 text-white text-[10px] font-bold py-2 rounded-lg">LOAD</button>
                        <button onclick="syncSingle(${doc.id})" class="bg-blue-600 text-white text-[10px] font-bold py-2 rounded-lg">SYNC</button>
                    </div>
                `;
                list.appendChild(div);
            }
            cursor.continue();
        }
        document.getElementById('empty-msg').style.display = count === 0 ? 'block' : 'none';
    };
}

function deleteEntry(id) {
    if(confirm("Delete this archive?")) {
        db.transaction("sessions", "readwrite").objectStore("sessions").delete(id);
        setTimeout(loadLibrary, 100);
    }
}

function openEditor(id) {
    db.transaction("sessions", "readonly").objectStore("sessions").get(id).onsuccess = (e) => {
        const doc = e.target.result;
        document.getElementById('output').value = doc.text;
        document.getElementById('session-title').value = doc.title;
        finalTranscript = doc.text;
        currentEntryId = doc.id;
        if(doc.blob) document.getElementById('review-player').src = URL.createObjectURL(doc.blob);
        switchTab('recorder');
    };
}

// 6. UTILS
function switchTab(tab) {
    document.getElementById('view-recorder').classList.toggle('hidden', tab !== 'recorder');
    document.getElementById('view-library').classList.toggle('hidden', tab !== 'library');
    document.getElementById('tab-recorder').className = tab === 'recorder' ? 'py-5 active-tab uppercase text-xs font-bold' : 'py-5 uppercase text-xs font-bold text-slate-400';
    document.getElementById('tab-library').className = tab === 'library' ? 'py-5 active-tab uppercase text-xs font-bold' : 'py-5 uppercase text-xs font-bold text-slate-400';
    if(tab === 'library') loadLibrary();
}

function insertTimestamp() {
    const out = document.getElementById('output');
    out.value += `\n[${new Date().toLocaleTimeString()}] `;
}