<script>
        // ASSIGNED GOOGLE APPS SCRIPT URL
        const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwLBvnrlj8eTfp3NbXoIFxWfvs4BNC_L0YZbez87IMn9ZH5p78qLEPRVGLwI0l3M9MY/exec";

        let db, mediaRecorder, chunks = [], finalTranscript = "", currentEntryId = null;
        let audioCtx, analyser, animId;

        // DB INITIALIZATION
        const request = indexedDB.open("BABRN_Turbo_Cloud_DB", 1);
        request.onupgradeneeded = e => e.target.result.createObjectStore("sessions", { keyPath: "id" });
        request.onsuccess = e => { db = e.target.result; loadLibrary(); };

        // VOLUME METER
        function startSimpleVisualizer(stream) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioCtx.createMediaStreamSource(stream);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            function update() {
                animId = requestAnimationFrame(update);
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
                let volume = Math.min(100, ((sum / dataArray.length) / 128) * 100);
                const bar = document.getElementById('volume-bar');
                bar.style.width = volume + "%";
                bar.style.backgroundColor = volume > 80 ? "#ef4444" : (volume > 5 ? "#10b981" : "#cbd5e1");
            }
            update();
        }

        // TRANSCRIPTION - UPDATED FOR TAGLISH
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        
        // Change to fil-PH to support Tagalog + English naturally
        recognition.lang = 'fil-PH'; 

        recognition.onresult = (e) => {
            let interim = "";
            for (let i = e.resultIndex; i < e.results.length; ++i) {
                if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + " ";
                else interim += e.results[i][0].transcript;
            }
            document.getElementById('output').value = finalTranscript + interim;
            updateWordCount();
        };

        // CONTROLS
        document.getElementById('start-btn').onclick = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                startSimpleVisualizer(stream);
                mediaRecorder = new MediaRecorder(stream);
                chunks = [];
                mediaRecorder.ondataavailable = e => chunks.push(e.data);
                mediaRecorder.onstop = () => {
                    saveToLocal(new Blob(chunks, { type: 'audio/webm' }));
                    cancelAnimationFrame(animId);
                    if(audioCtx) audioCtx.close();
                    stream.getTracks().forEach(t => t.stop());
                };
                mediaRecorder.start();
                recognition.start();
                document.getElementById('start-btn').classList.add('hidden');
                document.getElementById('stop-btn').classList.remove('hidden');
                document.getElementById('recording-indicator').classList.remove('hidden');
            } catch(err) { alert("Mic Access Denied. Use HTTPS."); }
        };

        document.getElementById('stop-btn').onclick = () => {
            mediaRecorder.stop();
            recognition.stop();
            document.getElementById('start-btn').classList.remove('hidden');
            document.getElementById('stop-btn').classList.add('hidden');
            document.getElementById('recording-indicator').classList.add('hidden');
        };

        function updateWordCount() {
            const text = document.getElementById('output').value.trim();
            document.getElementById('word-count').innerText = text ? text.split(/\s+/).length : 0;
        }

        function saveToLocal(blob) {
            const id = Date.now();
            const title = document.getElementById('session-title').value.trim() || "Meeting " + new Date().toLocaleTimeString();
            const text = document.getElementById('output').value;
            const tx = db.transaction("sessions", "readwrite");
            tx.objectStore("sessions").add({ id, title, text, date: new Date().toLocaleString() });
            currentEntryId = id;
            document.getElementById('save-status').innerText = "✓ LOCALLY ARCHIVED";
            setTimeout(() => document.getElementById('save-status').innerText = "", 3000);
        }

        async function syncToGoogle() {
            const title = document.getElementById('session-title').value || "No Title";
            const text = document.getElementById('output').value;
            if(!text) return alert("Nothing to sync!");
            const btn = document.getElementById('cloud-btn');
            btn.innerText = "SYNCING...";
            btn.disabled = true;
            try {
                await fetch(SCRIPT_URL, { 
                    method: 'POST', 
                    mode: 'no-cors', 
                    body: JSON.stringify({ title, text, date: new Date().toLocaleString() }) 
                });
                document.getElementById('last-sync').innerText = "Last sync: " + new Date().toLocaleTimeString();
                alert("Cloud Sync Successful!");
            } catch(e) { alert("Sync failed."); }
            finally { btn.innerHTML = `<i class="fas fa-cloud-upload-alt"></i> Sync to Google Sheet`; btn.disabled = false; }
        }

        function loadLibrary() {
            const list = document.getElementById('library-list');
            const query = document.getElementById('library-search').value.toLowerCase();
            list.innerHTML = "";
            let count = 0;
            db.transaction("sessions", "readonly").objectStore("sessions").openCursor(null, 'prev').onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    if (cursor.value.title.toLowerCase().includes(query)) {
                        count++;
                        const div = document.createElement('div');
                        div.className = "bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative";
                        div.innerHTML = `
                            <h3 class="font-bold text-sm truncate uppercase pr-6">${cursor.value.title}</h3>
                            <p class="text-[9px] text-slate-400 mb-4">${cursor.value.date}</p>
                            <div class="flex gap-2">
                                <button onclick="openEntry(${cursor.value.id})" class="flex-1 bg-slate-800 text-white py-2 rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-500">Open</button>
                                <button onclick="deleteEntry(${cursor.value.id})" class="text-slate-300 hover:text-red-500"><i class="fas fa-trash"></i></button>
                            </div>
                        `;
                        list.appendChild(div);
                    }
                    cursor.continue();
                }
                document.getElementById('empty-msg').classList.toggle('hidden', count > 0);
            };
        }

        function openEntry(id) {
            db.transaction("sessions", "readonly").objectStore("sessions").get(id).onsuccess = (e) => {
                const doc = e.target.result;
                document.getElementById('output').value = doc.text;
                document.getElementById('session-title').value = doc.title;
                finalTranscript = doc.text;
                currentEntryId = id;
                updateWordCount();
                switchTab('recorder');
            };
        }

        function deleteEntry(id) {
            if(confirm("Delete archive?")) {
                db.transaction("sessions", "readwrite").objectStore("sessions").delete(id);
                setTimeout(loadLibrary, 100);
            }
        }

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
            finalTranscript = out.value;
            out.scrollTop = out.scrollHeight;
        }

        function prepareNewSession() {
            if(confirm("Start new session?")) {
                document.getElementById('output').value = "";
                document.getElementById('session-title').value = "";
                finalTranscript = "";
                currentEntryId = null;
                updateWordCount();
            }
        }
    </script>
