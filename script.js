const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwLBvnrlj8eTfp3NbXoIFxWfvs4BNC_L0YZbez87IMn9ZH5p78qLEPRVGLwI0l3M9MY/exec";

let db, mediaRecorder, chunks = [], finalTranscript = "", currentEntryId = null;
let audioCtx, analyser, dataArray, animId;

// 1. DATABASE INIT
const request = indexedDB.open("BABRN_Turbo_DB", 3);
request.onupgradeneeded = e => e.target.result.createObjectStore("sessions", { keyPath: "id" });
request.onsuccess = e => { db = e.target.result; loadLibrary(); };

// 2. TURBO SPEECH RECOGNITION (Optimized for Speed)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();

recognition.continuous = true;
recognition.interimResults = true; // Shows words while you are still speaking
recognition.lang = 'en-US'; // Use 'fil-PH' for Tagalog

recognition.onresult = (e) => {
    let interimTranscript = "";
    for (let i = e.resultIndex; i < e.results.length; ++i) {
        let transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
            finalTranscript += transcript + " ";
        } else {
            interimTranscript += transcript;
        }
    }
    // Update the textarea with both finalized and "thinking" text
    const output = document.getElementById('output');
    output.value = finalTranscript + interimTranscript;
    output.scrollTop = output.scrollHeight; // Auto-scroll
};

// 3. ENHANCED VISUALIZER (Signal Strength Detection)

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
        
        // Calculate average volume for signal indicator
        let sum = 0;
        for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
        let average = sum / dataArray.length;

        for (let i = 0; i < dataArray.length; i++) {
            const h = (dataArray[i] / 255) * canvas.height;
            
            // Color Logic: Red if too quiet, Green if good
            if (average < 15) ctx.fillStyle = '#ef4444'; // Red (Too quiet)
            else ctx.fillStyle = '#10b981'; // Green (Good signal)
            
            ctx.fillRect(x, canvas.height - h, barWidth - 2, h);
            x += barWidth;
        }
    }
    draw();
}

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
            saveLocal(blob);
            stream.getTracks().forEach(t => t.stop());
            cancelAnimationFrame(animId);
            audioCtx.close();
        };
        mediaRecorder.start();
        recognition.start();
        
        document.getElementById('start-btn').classList.add('hidden');
        document.getElementById('stop-btn').classList.remove('hidden');
        document.getElementById('recording-indicator').classList.remove('hidden');
    } catch (err) { alert("Microphone not detected or permission denied."); }
};

document.getElementById('stop-btn').onclick = () => {
    mediaRecorder.stop();
    recognition.stop();
    document.getElementById('start-btn').classList.remove('hidden');
    document.getElementById('stop-btn').classList.add('hidden');
    document.getElementById('recording-indicator').classList.add('hidden');
};

// 5. DATA MANAGEMENT (Local & Cloud)
function saveLocal(blob) {
    const id = Date.now();
    const title = document.getElementById('session-title').value || "Meeting " + new Date().toLocaleTimeString();
    const text = document.getElementById('output').value;
    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").add({ id, title, text, date: new Date().toLocaleString(), blob });
    currentEntryId = id;
    document.getElementById('save-status').innerText = "✓ ARCHIVED LOCALLY";
}

async function syncToGoogleSheets() {
    const title = document.getElementById('session-title').value;
    const text = document.getElementById('output').value;
    if(!text) return alert("Nothing to sync!");

    const btn = document.getElementById('cloud-sync-btn');
    btn.innerHTML = `<i class="fas fa-spinner animate-spin"></i> SYNCING...`;
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({ title, text, date: new Date().toLocaleString() })
        });
        alert("Success! Data sent to Google Sheets.");
    } catch (e) { alert("Cloud Sync Failed"); }
    btn.innerHTML = `<i class="fas fa-cloud-upload-alt mr-1"></i> Sync to Google Sheets`;
}

// 6. ARCHIVE & SEARCH LOGIC
function loadLibrary() {
    const list = document.getElementById('library-list');
    const query = document.getElementById('library-search').value.toLowerCase();
    list.innerHTML = "";
    
    db.transaction("sessions", "readonly").objectStore("sessions").openCursor(null, 'prev').onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            const doc = cursor.value;
            if (doc.title.toLowerCase().includes(query) || doc.text.toLowerCase().includes(query)) {
                const div = document.createElement('div');
                div.className = "bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative group";
                div.innerHTML = `
                    <button onclick="deleteEntry(${doc.id})" class="absolute top-4 right-4 text-slate-300 hover:text-red-500"><i class="fas fa-trash"></i></button>
                    <h3 class="font-bold text-slate-800 text-sm truncate pr-6">${doc.title}</h3>
                    <p class="text-[10px] text-slate-400 mb-4">${doc.date}</p>
                    <button onclick="openEditor(${doc.id})" class="w-full bg-slate-100 py-2 rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-500 hover:text-white transition-all">Open Session</button>
                `;
                list.appendChild(div);
            }
            cursor.continue();
        }
    };
}

function deleteEntry(id) {
    if(confirm("Permanently delete this archive?")) {
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
        switchTab('recorder');
    };
}

function switchTab(tab) {
    document.getElementById('view-recorder').classList.toggle('hidden', tab !== 'recorder');
    document.getElementById('view-library').classList.toggle('hidden', tab !== 'library');
    if(tab === 'library') loadLibrary();
}

function insertTimestamp() {
    document.getElementById('output').value += `\n[${new Date().toLocaleTimeString()}] `;
}
