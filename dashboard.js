import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { initProfileDropdown } from './profiledropdown.js';
import { initNotificationBell, loadActivity, notifyActivityChanged } from './notificationbell.js';

const firebaseConfig = {
    apiKey: "AIzaSyDiUes0g8qj-pCRD0kDdcPsmSMsrYDbmwU",
    authDomain: "recallgen-4b38d.firebaseapp.com",
    projectId: "recallgen-4b38d",
    storageBucket: "recallgen-4b38d.firebasestorage.app",
    messagingSenderId: "67954844866",
    appId: "1:67954844866:web:5f52423f12fd30644b475b",
    measurementId: "G-TYTK4RHRBH"
};
const SUPABASE_URL = 'https://xdudxyjihjyteukiaate.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkdWR4eWppaGp5dGV1a2lhYXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3OTA4MDksImV4cCI6MjA4NjM2NjgwOX0.szi9C6EK9OZ1TrkYBI1oJZkFkSeDNTdcjnM2MuY8ti4';

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// USERNAME SYNC: preserve a saved Settings username; initialize missing names only.
function cleanProfileUsername(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isCurrentUsernameUser(user) {
    return !!user?.uid && auth?.currentUser?.uid === user.uid;
}

async function usernameDeadline(operation) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(operation),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Username sync timed out.')), 5000); })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function initializeProfileUsername(user, candidate, existing) {
    const name = cleanProfileUsername(candidate);
    const saved = cleanProfileUsername(existing?.username);
    if (saved) return saved;
    if (!name || !isCurrentUsernameUser(user)) return '';
    const store = await getUsernameStore();
    if (!isCurrentUsernameUser(user)) return '';
    if (existing) {
        // Compare the original blank value so another tab's rename wins.
        let update = store.from('user_settings').update({ username: name }).eq('user_id', user.uid);
        update = existing.username == null ? update.is('username', null) : update.eq('username', existing.username);
        const { error } = await update;
        if (error) throw error;
    } else {
        // A concurrent profile insert must not reset its name, photo, or theme.
        const { error } = await store.from('user_settings').upsert({
            user_id: user.uid, email: user.email || '', username: name
        }, { onConflict: 'user_id', ignoreDuplicates: true });
        if (error) throw error;
    }
    if (!isCurrentUsernameUser(user)) return '';
    const { data, error } = await store.from('user_settings').select('username').eq('user_id', user.uid).maybeSingle();
    if (error) throw error;
    return cleanProfileUsername(data?.username) || name;
}
// END USERNAME SYNC COMMON

async function getUsernameStore() { return supabase; }

async function resolveProfileUsername(user, profile, profileReadable = true) {
    const saved = cleanProfileUsername(profile?.username);
    if (saved) return saved;
    let registered = cleanProfileUsername(user.displayName);
    if (!registered && isCurrentUsernameUser(user)) {
        try {
            registered = await usernameDeadline(async () => {
                const sdk = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
                if (!isCurrentUsernameUser(user)) return '';
                const snapshot = await sdk.getDoc(sdk.doc(sdk.getFirestore(app), 'users', user.uid));
                return snapshot.exists() ? cleanProfileUsername(snapshot.data().username) : '';
            });
        } catch (error) {
            console.warn('Could not load the registered username:', error);
        }
    }
    if (!isCurrentUsernameUser(user)) return '';
    if (registered && profileReadable) {
        try {
            return await usernameDeadline(() => initializeProfileUsername(user, registered, profile));
        } catch (error) {
            // The known registered name can still be displayed if Supabase is unavailable.
            console.warn('Could not initialize the profile username:', error);
        }
    }
    return registered;
}
// END USERNAME SYNC RESOLVE

// HELPERS 

function getDisplayName(storageFilename) {
    return storageFilename.replace(/^\d+_/, '');
}

function applyThemeColorToBanner(hex) {
    if (!hex) return;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    document.documentElement.style.setProperty('--banner-color-rgb', `${r}, ${g}, ${b}`);
    const banner = document.getElementById('quickstart-banner');
    if (banner) {
        banner.style.background  = `linear-gradient(135deg, rgba(${r},${g},${b},0.12), rgba(${r},${g},${b},0.04))`;
        banner.style.borderColor = `rgba(${r},${g},${b},0.3)`;
    }
    document.querySelectorAll('.qs-step-icon').forEach(el => {
        el.style.background = `rgba(${r},${g},${b},0.12)`;
        el.style.color = hex;
    });
    document.querySelectorAll('.qs-step-num').forEach(el => {
        el.style.background = hex;
    });
    const qsTitle = document.querySelector('.qs-title');
    if (qsTitle) qsTitle.style.color = hex;
}

function getFileIcon(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    if (ext === 'pdf')                             return 'fas fa-file-pdf';
    if (['png','jpg','jpeg','gif'].includes(ext))  return 'fas fa-file-image';
    if (['doc','docx'].includes(ext))              return 'fas fa-file-word';
    return 'fas fa-file-alt';
}

function formatDate(isoString) {
    const date      = new Date(isoString);
    const now       = new Date();
    const diffMs    = now - date;
    const diffMins  = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays  = Math.floor(diffMs / 86400000);
    if (diffMins  < 1)  return 'Just now';
    if (diffMins  < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays  < 7)  return `${diffDays}d ago`;
    return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

//  COLLAPSE HELPER  

function attachCollapseToggle(toggleBtn, body, storageKey, itemCount = 0) {
    const SCROLL_THRESHOLD  = 3;
    const MAX_SCROLL_HEIGHT = 290;

    if (itemCount > SCROLL_THRESHOLD) {
        body.style.maxHeight    = `${MAX_SCROLL_HEIGHT}px`;
        body.style.overflowY   = 'auto';
        body.style.paddingRight = '4px';
        body.classList.add('collapse-scroll-active');
    }

    const sectionCard    = body.closest('.section-card');
    const sectionDivider = sectionCard ? sectionCard.querySelector('.section-divider') : null;

    function applyCollapsed(collapsed) {
        if (collapsed) {
            body.style.display = 'none';
            if (sectionDivider) sectionDivider.style.display = 'none';
            toggleBtn.classList.add('collapsed');
            const labelEl = toggleBtn.querySelector('.collapse-label');
            if (labelEl) labelEl.textContent = 'Show';
        } else {
            body.style.display = '';
            if (sectionDivider) sectionDivider.style.display = '';
            toggleBtn.classList.remove('collapsed');
            const labelEl = toggleBtn.querySelector('.collapse-label');
            if (labelEl) labelEl.textContent = 'Hide';
        }
    }

    const savedCollapsed = localStorage.getItem(storageKey) === 'true';
    applyCollapsed(savedCollapsed);

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = body.style.display === 'none';
        applyCollapsed(!isCollapsed);
        localStorage.setItem(storageKey, String(!isCollapsed));
    });
}

//  FOLDER PICKER 

function showFolderPicker(fileName, folders) {
    return new Promise((resolve) => {
        const bg = document.createElement('div');
        bg.className = 'folder-picker-bg';

        function renderFolderList(folderList) {
            return folderList.length
                ? folderList.map(f => `
                    <div class="fp-folder-item" data-id="${f.id}">
                        <i class="fas fa-folder"></i>
                        <span>${f.name}</span>
                        ${f.is_locked ? `<span class="fp-lock"><i class="fas fa-lock"></i> locked</span>` : ''}
                    </div>`).join('')
                : `<div class="fp-empty-hint">No folders yet — create one below.</div>`;
        }

        bg.innerHTML = `
            <div class="folder-picker-modal">
                <h3><i class="fas fa-folder-open" style="color:var(--primary-teal,#2D5A53);margin-right:8px;"></i>
                    Choose a folder
                </h3>
                <p>Where would you like to save this file?</p>
                <div class="fp-file-name">
                    <i class="fas fa-file-pdf"></i>
                    <span>${fileName}</span>
                </div>
                <div class="fp-folder-list" id="fp-folder-list">
                    ${renderFolderList(folders)}
                    <div class="fp-none-item selected" data-id="none">
                        <i class="fas fa-inbox"></i>
                        <span>No folder (uncategorized)</span>
                    </div>
                </div>

                <div class="fp-new-folder-row" id="fp-new-folder-row">
                    <input id="fp-new-folder-input" type="text" placeholder="Folder name...">
                    <button id="fp-new-folder-confirm" class="fp-new-folder-confirm">Add</button>
                    <button id="fp-new-folder-cancel" class="fp-new-folder-cancel">Cancel</button>
                </div>

                <div class="fp-btns">
                    <button class="fp-btn-add-folder" id="fp-add-folder-btn">
                        <i class="fas fa-plus" style="margin-right:5px;"></i>New Folder
                    </button>
                    <div style="display:flex; gap:8px;">
                        <button class="fp-btn fp-btn-cancel" id="fp-cancel">Cancel</button>
                        <button class="fp-btn fp-btn-upload" id="fp-upload">
                            <i class="fas fa-upload" style="margin-right:5px;"></i>Upload
                        </button>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(bg);

        let selectedId = null;

        function bindFolderItems() {
            bg.querySelectorAll('.fp-folder-item, .fp-none-item').forEach(item => {
                item.addEventListener('click', () => {
                    bg.querySelectorAll('.fp-folder-item, .fp-none-item').forEach(i => i.classList.remove('selected'));
                    item.classList.add('selected');
                    selectedId = item.dataset.id === 'none' ? null : item.dataset.id;
                });
            });
        }
        bindFolderItems();

        const addFolderBtn     = bg.querySelector('#fp-add-folder-btn');
        const newFolderRow     = bg.querySelector('#fp-new-folder-row');
        const newFolderInput   = bg.querySelector('#fp-new-folder-input');
        const newFolderConfirm = bg.querySelector('#fp-new-folder-confirm');
        const newFolderCancel  = bg.querySelector('#fp-new-folder-cancel');
        const folderListEl     = bg.querySelector('#fp-folder-list');

        addFolderBtn.addEventListener('click', () => {
            newFolderRow.style.display = 'flex';
            newFolderInput.focus();
            addFolderBtn.style.display = 'none';
        });

        newFolderCancel.addEventListener('click', () => {
            newFolderRow.style.display = 'none';
            newFolderInput.value = '';
            addFolderBtn.style.display = '';
        });

        newFolderConfirm.addEventListener('click', async () => {
            const name = newFolderInput.value.trim();
            if (!name) { newFolderInput.focus(); return; }

            const user = auth.currentUser;
            if (!user) return;

            //  DUPLICATE CHECK 
            const duplicate = folders.find(
                f => f.name.trim().toLowerCase() === name.toLowerCase()
            );
            if (duplicate) {
                Swal.fire({
                    title: 'Folder already exists',
                    text: `A folder named "${name}" already exists.`,
                    icon: 'warning',
                    didOpen: () => {
                        const container = Swal.getPopup()?.closest('.swal2-container');
                        if (container) container.style.zIndex = '999999';
                    }
                });
                newFolderInput.select();
                return;
            }

            newFolderConfirm.textContent = 'Saving...';
            newFolderConfirm.disabled    = true;

            const { data: newFolder, error } = await supabase
                .from('module_folders')
                .insert({ user_id: user.uid, name: name, is_locked: false })
                .select('id, name, is_locked')
                .single();

            newFolderConfirm.textContent = 'Add';
            newFolderConfirm.disabled    = false;

            if (error) {
                Swal.fire('Error', error.message, 'error');
                return;
            }

            folders.push(newFolder);

            const noneItem = folderListEl.querySelector('.fp-none-item');
            const newItem  = document.createElement('div');
            newItem.className  = 'fp-folder-item';
            newItem.dataset.id = newFolder.id;
            newItem.innerHTML  = `<i class="fas fa-folder"></i><span>${newFolder.name}</span>`;
            folderListEl.insertBefore(newItem, noneItem);
            bindFolderItems();

            folderListEl.querySelectorAll('.fp-folder-item, .fp-none-item').forEach(i => i.classList.remove('selected'));
            newItem.classList.add('selected');
            selectedId = newFolder.id;

            newFolderRow.style.display = 'none';
            newFolderInput.value       = '';
            addFolderBtn.style.display = '';

            const emptyHint = folderListEl.querySelector('.fp-empty-hint');
            if (emptyHint) emptyHint.remove();
        });

        newFolderInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter')  newFolderConfirm.click();
            if (e.key === 'Escape') newFolderCancel.click();
        });

        bg.querySelector('#fp-cancel').addEventListener('click', () => {
            bg.remove(); resolve(null);
        });
        bg.addEventListener('click', (e) => {
            if (e.target === bg) { bg.remove(); resolve(null); }
        });
        bg.querySelector('#fp-upload').addEventListener('click', () => {
            bg.remove(); resolve({ folderId: selectedId });
        });
    });
}

//  PAUSED QUIZZES 

async function loadPausedQuizzes(userId) {
    try {
        const { data, error } = await supabase
            .from('quiz_paused')
            .select('*')
            .eq('user_id', userId)
            .order('paused_at', { ascending: false });

        if (error) throw error;

        // Always remove old section first
        const oldSection = document.getElementById('paused-quizzes-section');
        if (oldSection) oldSection.remove();
        if (!data || data.length === 0) return;

        const section = document.createElement('section');
        section.id = 'paused-quizzes-section';
        section.innerHTML = `
            <div class="section-card">
                <div class="paused-section-header">
                    <h3>⏸️ Continue Where You Left Off <span class="paused-badge" id="paused-count">0</span></h3>
                    <button class="btn-collapse-toggle" id="paused-collapse-btn" title="Toggle section">
                        <i class="fas fa-chevron-up"></i>
                        <span class="collapse-label">Hide</span>
                    </button>
                </div>
                <div class="section-divider"></div>
                <div class="paused-cards" id="paused-cards-list"></div>
            </div>`;

        // Insert BEFORE the content-grid (upload + modules panel)
        const mainContent = document.querySelector('.main-content');
        const contentGrid = document.querySelector('.content-grid');
        if (mainContent && contentGrid) {
            mainContent.insertBefore(section, contentGrid);
        } else {
            (mainContent || document.body).appendChild(section);
        }

        const list        = section.querySelector('#paused-cards-list');
        const countEl     = section.querySelector('#paused-count');
        const collapseBtn = section.querySelector('#paused-collapse-btn');
        if (countEl) countEl.textContent = data.length;

        data.forEach(paused => {
            const progress  = paused.total_questions > 0
                ? Math.round((paused.current_question / paused.total_questions) * 100)
                : 0;
            const typeIcons = { 'Multiple Choice': '📝', 'True / False': '✅', 'Identification': '✏️' };
            const icon      = typeIcons[paused.quiz_type] || '📚';

            const card = document.createElement('div');
            card.className = 'paused-card';
            card.innerHTML = `
                <div class="paused-card-icon">${icon}</div>
                <div class="paused-card-info">
                    <div class="paused-card-name" title="${paused.module_name}">${paused.module_name}</div>
                    <div class="paused-card-meta">
                        <span><i class="fas fa-list-ol" style="font-size:10px;opacity:0.7;"></i>&nbsp;Q${paused.current_question} of ${paused.total_questions}</span>
                        <span class="paused-meta-dot">·</span>
                        <span>${paused.quiz_type}</span>
                        <span class="paused-meta-dot">·</span>
                        <span><i class="fas fa-clock" style="font-size:10px;opacity:0.7;"></i>&nbsp;${formatTime(paused.elapsed_seconds || 0)}</span>
                        <span class="paused-meta-dot">·</span>
                        <span>${formatDate(paused.paused_at)}</span>
                    </div>
                    <div class="paused-progress-bar">
                        <div class="paused-progress-fill" style="width:0%;" data-target="${progress}"></div>
                    </div>
                    <div class="paused-progress-label">${progress}% done</div>
                </div>
                <div class="paused-card-actions">
                    <button class="btn-paused-continue">▶ Continue</button>
                    <button class="btn-paused-discard">Discard</button>
                </div>`;

            setTimeout(() => {
                const fill = card.querySelector('.paused-progress-fill');
                if (fill) fill.style.width = `${progress}%`;
            }, 80);

            card.querySelector('.btn-paused-continue').addEventListener('click', (e) => {
                e.stopPropagation();
                window.location.href = `quiz.html?resume=${paused.id}`;
            });

            card.querySelector('.btn-paused-discard').addEventListener('click', async (e) => {
                e.stopPropagation();
                const confirmed = await Swal.fire({
                    title: 'Discard progress?',
                    text: `"${paused.module_name}" quiz progress will be permanently deleted.`,
                    icon: 'warning', showCancelButton: true,
                    confirmButtonColor: '#ff4757', cancelButtonColor: '#aaa',
                    confirmButtonText: 'Yes, discard', cancelButtonText: 'Cancel'
                });
                if (!confirmed.isConfirmed) return;

                const { error: delErr } = await supabase
                    .from('quiz_paused').delete().eq('id', paused.id);
                if (delErr) { Swal.fire('Error', delErr.message, 'error'); return; }

                card.style.transition = 'opacity 0.25s, transform 0.25s';
                card.style.opacity    = '0';
                card.style.transform  = 'translateX(20px)';
                setTimeout(() => {
                    card.remove();
                    const remaining = list.querySelectorAll('.paused-card').length;
                    if (!remaining) section.remove();
                    else if (countEl) countEl.textContent = remaining;
                }, 260);
            });

            list.appendChild(card);
        });

        attachCollapseToggle(collapseBtn, list, 'collapse_paused', data.length);

    } catch (err) { console.error('❌ loadPausedQuizzes error:', err); }
}

//  RECENT QUIZZES 

async function loadRecentQuizzes(userId) {
    const section = document.getElementById('recent-quizzes-section');
    if (!section) return;

    section.setAttribute('aria-busy', 'true');
    section.innerHTML = `
        <div class="rq-section-header">
            <h3 id="recent-quizzes-title"><i class="fas fa-history" aria-hidden="true"></i> Recent Quizzes <span class="rq-badge">...</span></h3>
            <button type="button" class="btn-collapse-toggle" id="rq-collapse-btn" title="Show or hide recent quizzes" aria-controls="rq-cards-list" aria-expanded="true" hidden>
                <i class="fas fa-chevron-up" aria-hidden="true"></i>
                <span class="collapse-label">Hide</span>
            </button>
        </div>
        <div class="section-divider"></div>
        <div class="rq-cards" id="rq-cards-list" aria-live="polite">
            <div class="rq-empty"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i><p>Loading quizzes...</p></div>
        </div>`;

    const list = section.querySelector('#rq-cards-list');
    const collapseBtn = section.querySelector('#rq-collapse-btn');
    const countBadge = section.querySelector('.rq-badge');

    try {
        const { data, error } = await supabase
            .from('quiz_results').select('*').eq('user_id', userId)
            .order('taken_at', { ascending: false }).limit(5);
        if (error) throw error;

        list.innerHTML = '';
        countBadge.textContent = data?.length || 0;

        if (!data || data.length === 0) {
            list.innerHTML = `<div class="rq-empty"><i class="fas fa-brain" aria-hidden="true"></i><p>No quizzes yet.<br>Complete a quiz to see your results here.</p></div>`;
            return;
        }

        collapseBtn.hidden = false;

        const typeParamMap = {
            'Multiple Choice':    'multiple',
            'True / False':       'truefalse',
            'Fill in the Blanks': 'fillblank',
            'Identification':     'fillblank'
        };

        function getAccentColor(pct) {
            if (pct >= 75) return '#27ae60';
            if (pct >= 50) return '#e67e22';
            return '#ff4757';
        }
        function fmtTime(sec) {
            if (!sec) return null;
            return `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;
        }

        data.forEach((result, index) => {
            const pct       = result.percentage ?? Math.round((result.score / result.total) * 100);
            const typeParam = typeParamMap[result.quiz_type] || 'multiple';
            const accent    = getAccentColor(pct);
            const timeTaken = fmtTime(result.time_taken);
            const r         = 18;
            const circ      = +(2 * Math.PI * r).toFixed(1);
            const offset    = +(circ - (pct / 100) * circ).toFixed(1);

            const card = document.createElement('div');
            card.className = 'rq-card';
            card.style.setProperty('--rq-accent', accent);
            card.innerHTML = `
                <div class="rq-ring-wrap">
                    <svg width="44" height="44" viewBox="0 0 44 44">
                        <circle cx="22" cy="22" r="${r}" fill="none" stroke="${accent}22" stroke-width="4"/>
                        <circle class="rq-ring-fill" cx="22" cy="22" r="${r}" fill="none"
                            stroke="${accent}" stroke-width="4"
                            stroke-dasharray="${circ}" stroke-dashoffset="${circ}"
                            stroke-linecap="round"
                            style="transition:stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1);"/>
                    </svg>
                    <div class="rq-ring-center">
                        <div class="rq-ring-pct">${pct}%</div>
                        <div class="rq-ring-lbl">score</div>
                    </div>
                </div>
                <div class="rq-card-info">
                    <div class="rq-card-name" title="${result.module_name}">${result.module_name}</div>
                    <div class="rq-card-meta">
                        <i class="fas fa-check-circle" style="color:${accent};opacity:1;"></i>
                        <span>${result.score}/${result.total} correct</span>
                        ${timeTaken ? `<span class="rq-meta-dot">·</span><i class="fas fa-clock"></i><span>${timeTaken}</span>` : ''}
                        <span class="rq-meta-dot">·</span>
                        <i class="fas fa-calendar-alt"></i>
                        <span>${formatDate(result.taken_at)}</span>
                        <span class="rq-meta-dot">·</span>
                        <i class="fas fa-clock" style="font-size:9px;"></i>
                        <span>${new Date(result.taken_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                </div>
                <div class="rq-card-actions">
                    <button class="btn-rq-retake"><i class="fas fa-redo"></i> Retake</button>
                </div>`;

            setTimeout(() => {
                const fill = card.querySelector('.rq-ring-fill');
                if (fill) fill.style.strokeDashoffset = offset;
            }, 100 + index * 60);

            card.querySelector('.btn-rq-retake').addEventListener('click', (e) => {
                e.stopPropagation();
                window.location.href = `quiz.html?file=${encodeURIComponent(result.module_name)}&type=${typeParam}&retake=${result.id}`;
            });

            list.appendChild(card);
        });

        attachCollapseToggle(collapseBtn, list, 'collapse_recent_quizzes', data.length);
        const syncExpanded = () => collapseBtn.setAttribute('aria-expanded', String(list.style.display !== 'none'));
        syncExpanded();
        collapseBtn.addEventListener('click', syncExpanded);

    } catch (err) {
        console.error('❌ loadRecentQuizzes error:', err);
        countBadge.hidden = true;
        collapseBtn.hidden = true;
        list.innerHTML = `<div class="rq-empty"><i class="fas fa-exclamation-circle" aria-hidden="true"></i><p>Could not load recent quizzes.<br>Refresh the page to try again.</p></div>`;
    } finally {
        section.setAttribute('aria-busy', 'false');
    }
}

// QUIZ MODULE PICKER
// Keep the native select as the contract used by the existing mode-selector.js.
function initQuizModulePicker() {
    const root = document.getElementById('mode-module-picker');
    const select = document.getElementById('mode-file-select');
    const ui = document.getElementById('mode-module-picker-ui');
    if (!root || !select || !ui) return null;

    const trigger = document.getElementById('mode-module-trigger');
    const label = document.getElementById('mode-module-label');
    const menu = document.getElementById('mode-module-menu');
    const search = document.getElementById('mode-module-search');
    const list = document.getElementById('mode-module-list');
    const count = document.getElementById('mode-module-count');
    const status = document.getElementById('mode-module-status');
    const retry = document.getElementById('mode-module-retry');
    let modules = [];
    let filtered = [];
    let phase = 'loading';
    let activeIndex = -1;

    function updateLabel() {
        const selected = modules.find(module => module.id === select.value);
        label.textContent = phase === 'loading' ? 'Loading modules...'
            : phase === 'error' ? 'Could not load modules'
            : selected ? selected.name : 'Upload your first module';
        label.title = label.textContent;
        root.setAttribute('aria-busy', String(phase === 'loading'));
    }

    function setActive(index, scroll = true) {
        activeIndex = filtered.length ? Math.max(0, Math.min(index, filtered.length - 1)) : -1;
        Array.from(list.children).forEach((option, i) => {
            option.classList.toggle('is-active', i === activeIndex);
        });
        const option = list.children[activeIndex];
        if (option) {
            search.setAttribute('aria-activedescendant', option.id);
            if (scroll) option.scrollIntoView({ block: 'nearest' });
        } else {
            search.removeAttribute('aria-activedescendant');
        }
    }

    function close(restoreFocus = false) {
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        search.setAttribute('aria-expanded', 'false');
        search.removeAttribute('aria-activedescendant');
        root.classList.remove('is-open');
        if (restoreFocus) trigger.focus();
    }

    function choose(module) {
        select.value = module.id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        close(true);
    }

    function renderResults() {
        const query = search.value.trim().toLocaleLowerCase();
        filtered = phase === 'ready'
            ? modules.filter(module => module.name.toLocaleLowerCase().includes(query)) : [];
        list.replaceChildren();
        filtered.forEach((module, index) => {
            const option = document.createElement('div');
            option.className = 'module-picker-option';
            option.id = `mode-module-option-${index}`;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(module.id === select.value));
            const icon = document.createElement('i');
            icon.className = getFileIcon(module.name);
            icon.setAttribute('aria-hidden', 'true');
            const name = document.createElement('span');
            name.className = 'module-picker-name';
            name.textContent = module.name;
            name.title = module.name;
            const check = document.createElement('i');
            check.className = 'fas fa-check module-picker-check';
            check.setAttribute('aria-hidden', 'true');
            option.append(icon, name, check);
            // Keep focus on the search combobox while selecting with a pointer.
            option.addEventListener('mousedown', event => event.preventDefault());
            option.addEventListener('click', () => choose(module));
            list.appendChild(option);
        });
        count.textContent = phase === 'loading' ? 'Loading...'
            : phase === 'error' ? 'Try loading again'
            : query ? `${filtered.length} of ${modules.length} modules`
            : `${modules.length} module${modules.length === 1 ? '' : 's'}`;
        status.hidden = phase === 'ready' && filtered.length > 0;
        status.textContent = phase === 'loading' ? 'Loading your modules...'
            : phase === 'error' ? 'Could not load your modules. Please try again.'
            : modules.length ? 'No modules match your search.'
            : 'No modules yet. Use Browse Files to upload your study material.';
        retry.hidden = phase !== 'error';
        search.disabled = phase !== 'ready' || modules.length === 0;
        const selectedIndex = filtered.findIndex(module => module.id === select.value);
        setActive(selectedIndex < 0 ? 0 : selectedIndex, false);
    }

    function open() {
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        search.setAttribute('aria-expanded', 'true');
        root.classList.add('is-open');
        search.value = '';
        renderResults();
        if (!search.disabled) search.focus();
        else if (!retry.hidden) retry.focus();
    }

    trigger.addEventListener('click', () => menu.hidden ? open() : close());
    trigger.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open();
            setActive(event.key === 'ArrowUp' ? filtered.length - 1 : 0);
        }
    });
    search.addEventListener('input', renderResults);
    search.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            setActive((activeIndex + direction + filtered.length) % (filtered.length || 1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (filtered[activeIndex]) choose(filtered[activeIndex]);
        }
    });
    root.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !menu.hidden) {
            event.preventDefault();
            event.stopPropagation();
            close(true);
        }
    });
    document.addEventListener('pointerdown', event => {
        if (!menu.hidden && !root.contains(event.target)) close();
    });
    root.addEventListener('focusout', event => {
        if (!root.contains(event.relatedTarget)) close();
    });
    select.addEventListener('change', () => {
        updateLabel();
        if (!menu.hidden) renderResults();
    });
    retry.addEventListener('click', () => {
        if (auth.currentUser) loadQuizModeModules(auth.currentUser.uid);
    });

    select.hidden = true;
    root.querySelector(':scope > i').hidden = true;
    ui.hidden = false;
    root.classList.add('module-picker--enhanced');

    return {
        setState(nextPhase, nextModules = []) {
            phase = nextPhase;
            modules = nextModules;
            updateLabel();
            renderResults();
            // A retry may disable the currently focused search field or button.
            if (!menu.hidden && search.disabled && retry.hidden) trigger.focus();
        }
    };
}

const quizModulePicker = initQuizModulePicker();
let quizModuleLoadVersion = 0;

async function loadQuizModeModules(userId) {
    const select = document.getElementById('mode-file-select');
    if (!select) return;
    const requestVersion = ++quizModuleLoadVersion;
    const previous = select.value;
    window.populateModeFiles([]);
    quizModulePicker?.setState('loading');

    try {
        const pageSize = 500;
        const rows = [];
        // Read saved modules directly; the picker no longer depends on Recent Uploads.
        // Pagination also avoids limiting this dropdown to five recent files.
        for (let offset = 0; ; offset += pageSize) {
            const { data, error } = await supabase.from('user_modules')
                .select('file_name').eq('user_id', userId)
                .order('uploaded_at', { ascending: false })
                .order('file_name', { ascending: true })
                .range(offset, offset + pageSize - 1);
            if (requestVersion !== quizModuleLoadVersion) return;
            if (error) throw error;
            rows.push(...(data || []));
            if (!data || data.length < pageSize) break;
        }

        const seen = new Set();
        const modules = rows.flatMap(row => {
            if (typeof row.file_name !== 'string') return [];
            const name = getDisplayName(row.file_name);
            if (!name.trim() || seen.has(name)) return [];
            seen.add(name);
            // quiz.js expects the display filename, without its storage timestamp.
            return [{ id: name, name }];
        });
        window.populateModeFiles(modules);
        if (modules.some(module => module.id === previous)) select.value = previous;
        quizModulePicker?.setState('ready', modules);
        select.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
        if (requestVersion !== quizModuleLoadVersion) return;
        console.error('Error loading quiz modules:', error);
        window.populateModeFiles([]);
        quizModulePicker?.setState('error');
    }
}


//  AUTH 

onAuthStateChanged(auth, async (user) => {
    if (user) {
        initNotificationBell(auth);

        let userData = null;
        let displayUsername = cleanProfileUsername(user.displayName) || user.email?.split('@')[0] || 'Explorer';
        try {
            const { data, error } = await supabase
                .from('user_settings').select('*').eq('user_id', user.uid).single();
            if (error && error.code !== 'PGRST116') throw error;
            userData = data;
            displayUsername = await resolveProfileUsername(user, data);
            if (!isCurrentUsernameUser(user)) return;
            displayUsername ||= user.email?.split('@')[0] || 'Explorer';
            if (data) {
                document.getElementById('display-username').innerText = displayUsername;
                if (data.profile_pic?.startsWith('http'))
                    document.getElementById('nav-pfp').src = data.profile_pic;
                if (data.theme_bg) {
                    document.body.style.backgroundImage    = `url('${data.theme_bg}')`;
                    document.body.style.backgroundSize     = 'cover';
                    document.body.style.backgroundPosition = 'center';
                }
            } else {
                document.getElementById('display-username').innerText = displayUsername;
            }
        } catch (error) {
            console.error('Error loading user data:', error);
            displayUsername = await resolveProfileUsername(user, null, false) || user.email?.split('@')[0] || 'Explorer';
            if (!isCurrentUsernameUser(user)) return;
            document.getElementById('display-username').innerText = displayUsername;
        }

        document.documentElement.style.setProperty('--primary-teal', '#2D5A53');
        applyThemeColorToBanner('#2D5A53');

        await loadQuizModeModules(user.uid);
        await loadPausedQuizzes(user.uid);
        await loadRecentQuizzes(user.uid);
        await loadActivity(user.uid, supabase);
        await initProfileDropdown(user, supabase);
        await loadRGContext(
            user.uid,
            displayUsername,
            'Dashboard'
        );

    } else {
        if (localStorage.getItem('isRegistering') === 'true') {
            localStorage.removeItem('isRegistering');
            return;
        }
        window.location.href = 'login.html';
    }
});

//  FILE UPLOAD 

const fileInput = document.getElementById('file-input');
if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        const user = auth.currentUser;
        if (!file || !user) return;

        fileInput.value = '';

        try {
            const { data: folders } = await supabase
                .from('module_folders')
                .select('id, name, is_locked')
                .eq('user_id', user.uid)
                .order('created_at', { ascending: true });

            const picked = await showFolderPicker(file.name, folders || []);
            if (picked === null) return;

            const timestamp = Date.now();
            const fileName  = `${timestamp}_${file.name}`;
            const filePath  = `${user.uid}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('modules').upload(filePath, file);
            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('modules').getPublicUrl(filePath);

            await supabase.from('user_modules').insert({
                user_id:     user.uid,
                file_name:   fileName,
                file_url:    publicUrl,
                folder_id:   picked.folderId,
                uploaded_at: new Date().toISOString()
            });

            const { error: activityError } = await supabase.from('activity_logs').insert({
                user_id:     user.uid,
                type:        'upload',
                description: `Uploaded ${file.name}`,
                file_name:   file.name,
                created_at:  new Date().toISOString()
            });
            if (activityError) console.warn('Could not log module upload:', activityError.message);
            else notifyActivityChanged(user.uid, supabase);

            const folderName = picked.folderId
                ? (folders || []).find(f => f.id === picked.folderId)?.name || 'a folder'
                : null;

            await loadQuizModeModules(user.uid);

            // POST-UPLOAD MODAL
            const teal   = getComputedStyle(document.documentElement).getPropertyValue('--primary-teal').trim() || '#2D5A53';
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
                           document.body.getAttribute('data-theme') === 'dark';

            const { value: action } = await Swal.fire({
                title: 'Module Selected',
                html: `
                    <div id="swal-module-card" style="
                        display:flex; align-items:center; gap:12px;
                        border-radius:14px; padding:14px 16px;
                        margin-bottom:8px; text-align:left;
                        border: 1.5px solid ${isDark ? '#3a3a5e' : '#eee'};
                        background: ${isDark ? '#2a2a3e' : '#f4f6f9'};">
                        <div style="
                            background: ${isDark ? '#1e1e2e' : '#fff'};
                            border-radius:10px; padding:10px;
                            box-shadow:0 2px 8px rgba(0,0,0,0.08);
                            flex-shrink:0;">
                            <i class="fas fa-file-pdf" style="color:#e74c3c; font-size:1.4rem;"></i>
                        </div>
                        <div>
                            <div style="font-weight:600; font-size:14px; color:${isDark ? '#f0f0f0' : '#1a1a1a'};">${file.name}</div>
                            <div style="font-size:12px; color:${isDark ? '#aaa' : '#888'};">
                                Date: ${new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}
                            </div>
                        </div>
                    </div>`,
                showConfirmButton: true,
                confirmButtonText: 'Create Quiz Now',
                showDenyButton:    true,
                denyButtonText:    'Upload New',
                showCancelButton:  true,
                cancelButtonText:  'Done ✓',
                background: isDark ? '#1e1e2e' : '#fff',
                color:      isDark ? '#f0f0f0' : '#1a1a1a',
                didOpen: () => {
                    const popup = Swal.getPopup();
                    if (popup) {
                        popup.style.borderRadius = '20px';
                        popup.style.padding      = '28px 24px';
                        popup.style.boxShadow    = '0 20px 60px rgba(0,0,0,0.18)';
                    }

                    const confirmBtn = Swal.getConfirmButton();
                    if (confirmBtn) {
                        confirmBtn.style.cssText = `
                            background: ${teal} !important;
                            border-radius: 12px !important;
                            padding: 11px 28px !important;
                            font-family: 'Poppins', sans-serif !important;
                            font-size: 14px !important;
                            font-weight: 700 !important;
                            box-shadow: 0 4px 14px ${teal}55 !important;
                            border: none !important;
                        `;
                    }

                    const denyBtn = Swal.getDenyButton();
                    if (denyBtn) {
                        denyBtn.style.cssText = `
                            background: none !important;
                            color: ${isDark ? '#aaa' : '#888'} !important;
                            font-weight: 500 !important;
                            font-size: 14px !important;
                            font-family: 'Poppins', sans-serif !important;
                            box-shadow: none !important;
                            border: none !important;
                            padding: 11px 20px !important;
                        `;
                    }

                    const cancelBtn = Swal.getCancelButton();
                    if (cancelBtn) {
                        cancelBtn.style.cssText = `
                            background: rgba(45,90,83,0.08) !important;
                            color: ${teal} !important;
                            font-weight: 600 !important;
                            font-size: 14px !important;
                            font-family: 'Poppins', sans-serif !important;
                            border-radius: 12px !important;
                            padding: 11px 20px !important;
                            border: 1.5px solid ${teal}44 !important;
                            box-shadow: none !important;
                        `;
                    }

                    const title = Swal.getTitle();
                    if (title) {
                        title.style.cssText = `
                            font-size: 18px !important;
                            font-weight: 700 !important;
                            color: ${isDark ? '#f0f0f0' : '#1a1a1a'} !important;
                            font-family: 'Poppins', sans-serif !important;
                            margin-bottom: 16px !important;
                        `;
                    }
                }
            });

            if (action === true) {
                await Swal.fire({
                    title: 'Upload Complete!',
                    text: folderName
                        ? `"${file.name}" saved to "${folderName}".`
                        : `"${file.name}" uploaded successfully.`,
                    icon: 'success',
                    timer: 1500,
                    showConfirmButton: false,
                    position: 'center',
                    timerProgressBar: true
                });
                window.location.href = `quiz.html?file=${encodeURIComponent(file.name)}`;

            } else if (action === false) {
                fileInput.click();

            } else {
                Swal.fire({
                    title: 'Upload Complete!',
                    text: folderName
                        ? `"${file.name}" saved to "${folderName}".`
                        : `"${file.name}" uploaded successfully.`,
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false,
                    position: 'center',
                    timerProgressBar: true
                });
            }

        } catch (error) {
            console.error('Upload Error:', error);
            Swal.fire('Upload Failed', error.message, 'error');
        }
    });
}

//  LOGOUT 

document.getElementById('logout-btn').addEventListener('click', () => {
    signOut(auth).then(() => { window.location.href = 'login.html'; });
});

//  BURGER MENU 

const burgerBtn = document.getElementById('burgerBtn');
const sidebar   = document.getElementById('sidebar');
const overlay   = document.getElementById('sidebarOverlay');

burgerBtn.addEventListener('click', () => {
    burgerBtn.classList.toggle('open');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible');
});
overlay.addEventListener('click', () => {
    burgerBtn.classList.remove('open');
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
});
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        burgerBtn.classList.remove('open');
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
    });
});

//  QUICKSTART BANNER 

const banner = document.getElementById('quickstart-banner');
const qsClose = document.getElementById('qs-close');
const qsLinks = ['dashboard.html', 'modules.html', 'quiz.html'];

document.querySelectorAll('.qs-step').forEach((step, index) => {
    step.style.cursor = 'pointer';
    step.addEventListener('click', () => { window.location.href = qsLinks[index]; });
});
qsClose.addEventListener('click', (e) => { e.stopPropagation(); banner.classList.add('hidden'); });

//  RG CONTEXT 

async function loadRGContext(userId, username, currentPage) {
    try {
        const [modResult, scoreResult] = await Promise.all([
            supabase.from('user_modules').select('file_name').eq('user_id', userId),
            supabase.from('quiz_results').select('*').eq('user_id', userId).order('taken_at', { ascending: false })
        ]);

        const modules = (modResult.data || []).map(f => f.file_name.replace(/^\d+_/, ''));
        const scores  = scoreResult.data || [];

        const highestScore = scores.length
            ? scores.reduce((best, r) => r.percentage > best.percentage ? r : best, scores[0])
            : null;
        const avgScore = scores.length
            ? Math.round(scores.reduce((s, r) => s + r.percentage, 0) / scores.length)
            : 0;

        const days = new Set(scores.map(r => new Date(r.taken_at).toLocaleDateString('en-CA')));
        let streak = 0;
        let check  = new Date(); check.setHours(0, 0, 0, 0);
        while (days.has(check.toLocaleDateString('en-CA'))) { streak++; check.setDate(check.getDate() - 1); }

        const moduleScores = {};
        scores.forEach(r => {
            if (!moduleScores[r.module_name]) moduleScores[r.module_name] = [];
            moduleScores[r.module_name].push(r.percentage);
        });
        const bestModule = Object.entries(moduleScores).sort((a, b) =>
            (b[1].reduce((s, v) => s + v, 0) / b[1].length) - (a[1].reduce((s, v) => s + v, 0) / a[1].length)
        )[0];

        window.RG_CONTEXT = {
            username, currentPage, modules,
            totalModules: modules.length,
            totalQuizzes: scores.length,
            streak, avgScore,
            highestScore: highestScore
                ? { module: highestScore.module_name, score: highestScore.percentage, type: highestScore.quiz_type }
                : null,
            bestModule: bestModule
                ? { name: bestModule[0], avg: Math.round(bestModule[1].reduce((s, v) => s + v, 0) / bestModule[1].length) }
                : null,
            recentScores: scores.slice(0, 5).map(s => ({ module: s.module_name, score: s.percentage, type: s.quiz_type }))
        };
    } catch (e) { console.error('RG_CONTEXT error:', e); }
}

// STUDY PLANNER ADDITION. All original dashboard code above remains unchanged.
(() => {
    const root = document.getElementById('study-planner');
    if (!root) return;

    const byId = id => document.getElementById(id);
    const calendar = byId('sp-calendar');
    const taskList = byId('sp-tasks');
    const dialog = byId('sp-task-dialog');
    const form = byId('sp-task-form');
    const endpoint = `${SUPABASE_URL}/functions/v1/study-planner`;
    const signalKey = 'recallgen_study_planner_changed';
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const state = {
        userId: null, epoch: 0, selected: dateKey(new Date()),
        month: firstOfMonth(new Date()), tasks: [], ready: false,
        loading: false, loadError: '', actionError: '', busy: false,
        requestVersion: 0, controller: null, editor: null, interval: null
    };

    function dateKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function parseDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
        const [year, month, day] = value.split('-').map(Number);
        if (year < 1900 || year > 2100) return null;
        const date = new Date(year, month - 1, day, 12);
        return dateKey(date) === value ? date : null;
    }

    function firstOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth(), 1, 12);
    }

    function calendarDates() {
        const start = firstOfMonth(state.month);
        start.setDate(1 - start.getDay());
        return Array.from({ length: 42 }, (_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index);
            return date;
        });
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function icon(name) {
        const node = element('i', `fas fa-${name}`);
        node.setAttribute('aria-hidden', 'true');
        return node;
    }

    function currentSession(userId, epoch) {
        return state.userId === userId && state.epoch === epoch && auth.currentUser?.uid === userId;
    }

    function dayTasks(key) {
        return state.tasks.filter(task => task.task_date === key).sort((a, b) =>
            Number(a.is_completed) - Number(b.is_completed) ||
            (a.task_time || '99').localeCompare(b.task_time || '99') ||
            a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    }

    function renderCalendar() {
        const today = dateKey(new Date());
        const activeDate = calendar.contains(document.activeElement) ? document.activeElement.dataset.date : null;
        const monthPrefix = dateKey(state.month).slice(0, 7);
        byId('sp-month').textContent = state.month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
        const dates = calendarDates().map(date => {
            const key = dateKey(date);
            const tasks = state.tasks.filter(task => task.task_date === key);
            const button = element('button', 'sp-day', String(date.getDate()));
            button.type = 'button';
            button.dataset.date = key;
            button.tabIndex = key === state.selected ? 0 : -1;
            button.disabled = state.busy || !parseDate(key);
            button.classList.toggle('is-outside', date.getMonth() !== state.month.getMonth());
            button.classList.toggle('is-selected', key === state.selected);
            button.classList.toggle('is-today', key === today);
            button.classList.toggle('has-tasks', tasks.length > 0);
            button.classList.toggle('all-done', tasks.length > 0 && tasks.every(task => task.is_completed));
            button.setAttribute('aria-pressed', String(key === state.selected));
            if (key === today) button.setAttribute('aria-current', 'date');
            const label = date.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
            button.setAttribute('aria-label', `${label}${key === today ? ', today' : ''}${tasks.length ? `, ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}` : ''}`);
            return button;
        });
        calendar.replaceChildren(...dates);
        calendar.setAttribute('aria-busy', String(state.loading));
        if (activeDate) calendar.querySelector(`[data-date="${activeDate}"]`)?.focus({ preventScroll: true });
        const count = state.tasks.filter(task => task.task_date.startsWith(monthPrefix)).length;
        byId('sp-month-count').textContent = state.ready ? `${count} ${count === 1 ? 'task' : 'tasks'} this month` : 'Your monthly plans';
        byId('sp-prev').disabled = state.busy || (state.month.getFullYear() === 1900 && state.month.getMonth() === 0);
        byId('sp-next').disabled = state.busy || (state.month.getFullYear() === 2100 && state.month.getMonth() === 11);
        byId('sp-today').disabled = state.busy;
    }

    function renderAgenda() {
        const tasks = dayTasks(state.selected);
        const complete = tasks.filter(task => task.is_completed).length;
        const percent = tasks.length ? Math.round(complete / tasks.length * 100) : 0;
        const selected = parseDate(state.selected);
        const today = dateKey(new Date());
        const dateLabel = selected.toLocaleDateString('en-PH', {
            weekday: 'short', month: 'short', day: 'numeric',
            ...(selected.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {})
        });
        byId('sp-selected-date').textContent = `${state.selected === today ? 'Today · ' : ''}${dateLabel}`;
        byId('sp-progress-label').textContent = `${complete} of ${tasks.length} completed`;
        byId('sp-progress-percent').textContent = `${percent}%`;
        byId('sp-progress-fill').style.width = `${percent}%`;
        byId('sp-progress').setAttribute('aria-valuenow', String(percent));
        byId('sp-add').disabled = !state.userId || !state.ready || state.busy;

        const active = taskList.contains(document.activeElement) ? document.activeElement : null;
        const focusId = active?.dataset.taskId;
        const focusAction = active?.dataset.action;
        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const rows = tasks.map(task => {
            const row = element('div', 'sp-task');
            row.setAttribute('role', 'listitem');
            const overdue = !task.is_completed && (task.task_date < today ||
                (task.task_date === today && task.task_time && task.task_time.slice(0, 5) < currentTime));
            row.classList.toggle('is-complete', task.is_completed);
            row.classList.toggle('is-overdue', !!overdue);
            const label = element('label', 'sp-task-check');
            const check = element('input');
            check.type = 'checkbox';
            check.checked = task.is_completed;
            check.disabled = state.busy;
            check.dataset.taskId = task.id;
            check.dataset.action = 'toggle';
            check.setAttribute('aria-label', `Mark ${task.title} as ${task.is_completed ? 'incomplete' : 'complete'}`);
            label.appendChild(check);
            const copy = element('div', 'sp-task-copy');
            // User-entered titles are text, never HTML.
            copy.appendChild(element('span', 'sp-task-title', task.title));
            const meta = element('div', 'sp-task-meta');
            meta.appendChild(icon(task.is_completed ? 'check-circle' : 'clock'));
            let timeLabel = 'Any time';
            if (task.task_time) {
                const date = parseDate(task.task_date);
                const [hours, minutes] = task.task_time.split(':').map(Number);
                date.setHours(hours, minutes);
                timeLabel = date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
            }
            meta.appendChild(element('span', '', task.is_completed ? 'Completed' : `${timeLabel}${overdue ? ' · Overdue' : ''}`));
            copy.appendChild(meta);
            const edit = element('button', 'sp-icon-btn');
            edit.type = 'button';
            edit.dataset.action = 'edit';
            edit.dataset.taskId = task.id;
            edit.disabled = state.busy;
            edit.setAttribute('aria-label', `Edit ${task.title}`);
            edit.appendChild(icon('pen'));
            row.append(label, copy, edit);
            return row;
        });
        if (!rows.length && state.ready && !state.loading && !state.loadError) {
            const empty = element('div', 'sp-empty');
            empty.append(icon('book-open'), element('strong', '', 'Nothing planned for this day.'),
                element('p', '', 'Add a task to schedule your next review.'));
            rows.push(empty);
        }
        taskList.replaceChildren(...rows);
        if (focusId && uuidPattern.test(focusId)) {
            taskList.querySelector(`[data-task-id="${focusId}"][data-action="${focusAction}"]`)?.focus({ preventScroll: true });
        }
    }

    function renderStatus() {
        const message = state.busy ? 'Saving your changes…' : state.actionError || state.loadError ||
            (state.loading ? (state.ready ? 'Updating plans…' : 'Loading your study plans…') :
                (!state.userId ? 'Sign in to see your study plans.' : ''));
        byId('sp-status').hidden = !message;
        byId('sp-status-text').textContent = message;
        byId('sp-status').classList.toggle('is-error', !!(state.loadError || state.actionError));
        byId('sp-retry').hidden = !state.userId || state.busy || state.loading || !(state.loadError || state.actionError);
        byId('sp-refresh').disabled = !state.userId || state.busy || state.loading;
        root.setAttribute('aria-busy', String(state.busy || state.loading));
        if (dialog.open) {
            form.querySelectorAll('input, button').forEach(control => { control.disabled = state.busy; });
            byId('sp-save').textContent = state.busy ? 'Saving…' : (state.editor?.isNew ? 'Save task' : 'Save changes');
        }
    }

    function render() { renderCalendar(); renderAgenda(); renderStatus(); }

    async function request(method, path, body, userId, signal) {
        const user = auth.currentUser;
        if (user?.uid !== userId) throw new Error('Your account has changed. Please reopen the planner.');
        let token = await user.getIdToken(false);
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        if (signal?.aborted) controller.abort();
        else signal?.addEventListener('abort', onAbort, { once: true });
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            for (let attempt = 0; attempt < 2; attempt++) {
                if (auth.currentUser?.uid !== userId) throw new Error('Your account has changed. Please reopen the planner.');
                const response = await fetch(endpoint + path, {
                    method, cache: 'no-store', signal: controller.signal,
                    headers: {
                        Accept: 'application/json', apikey: SUPABASE_KEY,
                        Authorization: `Bearer ${token}`,
                        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
                    },
                    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
                });
                if (response.status === 401 && attempt === 0) {
                    token = await user.getIdToken(true);
                    continue;
                }
                let data;
                try { data = await response.json(); } catch { data = {}; }
                if (!response.ok) {
                    const error = new Error(data.error || 'Study plans are unavailable right now. Please try again.');
                    error.status = response.status;
                    throw error;
                }
                return data;
            }
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', onAbort);
        }
    }

    function abortLoad() {
        state.requestVersion++;
        state.controller?.abort();
        state.controller = null;
        state.loading = false;
    }

    function normalizeTask(task) {
        if (!task || !uuidPattern.test(task.id || '') || !parseDate(task.task_date) ||
            typeof task.title !== 'string' || typeof task.is_completed !== 'boolean' ||
            typeof task.created_at !== 'string' ||
            (task.task_time != null && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(task.task_time))) {
            throw new Error('Could not read your study plans. Please refresh and try again.');
        }
        return { ...task, task_time: task.task_time ? task.task_time.slice(0, 5) : null };
    }

    async function loadTasks() {
        if (!state.userId || state.busy) return;
        abortLoad();
        const version = state.requestVersion;
        const epoch = state.epoch;
        const userId = state.userId;
        const controller = new AbortController();
        state.controller = controller;
        state.loading = true;
        state.loadError = '';
        state.actionError = '';
        render();
        const dates = calendarDates();
        const from = dateKey(dates[0]) < '1900-01-01' ? '1900-01-01' : dateKey(dates[0]);
        const to = dateKey(dates[41]) > '2100-12-31' ? '2100-12-31' : dateKey(dates[41]);
        try {
            let page = 0;
            let more = true;
            const tasks = new Map();
            while (more) {
                const result = await request('GET', `?from=${from}&to=${to}&page=${page}`, undefined, userId, controller.signal);
                if (!currentSession(userId, epoch) || version !== state.requestVersion) return;
                if (!Array.isArray(result.tasks) || typeof result.hasMore !== 'boolean') throw new Error('Invalid planner response.');
                result.tasks.forEach(task => { const normalized = normalizeTask(task); tasks.set(normalized.id, normalized); });
                more = result.hasMore;
                if (more && !result.tasks.length) throw new Error('Invalid planner pagination.');
                page++;
            }
            state.tasks = [...tasks.values()];
            state.ready = true;
        } catch (error) {
            if (!currentSession(userId, epoch) || version !== state.requestVersion) return;
            console.warn('Study Planner load failed:', error);
            state.loadError = 'Could not load your study plans. Please try again.';
        } finally {
            if (currentSession(userId, epoch) && version === state.requestVersion) {
                state.loading = false;
                state.controller = null;
                render();
            }
        }
    }

    function selectDate(key, focus = false) {
        const date = parseDate(key);
        if (!date || state.busy) return;
        const monthChanged = date.getMonth() !== state.month.getMonth() || date.getFullYear() !== state.month.getFullYear();
        state.selected = key;
        state.month = firstOfMonth(date);
        state.actionError = '';
        render();
        if (focus) calendar.querySelector(`[data-date="${key}"]`)?.focus({ preventScroll: true });
        if (monthChanged) loadTasks();
    }

    function moveMonth(amount, focus = false) {
        const selected = parseDate(state.selected);
        const next = new Date(state.month.getFullYear(), state.month.getMonth() + amount, 1, 12);
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0, 12).getDate();
        next.setDate(Math.min(selected.getDate(), lastDay));
        selectDate(dateKey(next), focus);
    }

    function closeEditor(force = false) {
        if (state.busy && !force) return;
        const returnFocus = state.editor?.returnFocus;
        state.editor = null;
        if (dialog.open) dialog.close();
        if (!force) {
            if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
            else byId('sp-add').focus({ preventScroll: true });
        }
    }

    function openEditor(taskId = null) {
        if (state.busy || !state.userId || !state.ready) return;
        const task = taskId ? state.tasks.find(item => item.id === taskId) : null;
        if (taskId && !task) return;
        state.editor = { id: task?.id || crypto.randomUUID(), isNew: !task, returnFocus: document.activeElement };
        byId('sp-dialog-title').textContent = task ? 'Edit study task' : 'Add a study task';
        byId('sp-task-title').value = task?.title || '';
        byId('sp-task-title').setCustomValidity('');
        byId('sp-task-date').value = task?.task_date || state.selected;
        byId('sp-task-time').value = task?.task_time?.slice(0, 5) || '';
        byId('sp-delete').hidden = !task;
        byId('sp-delete-confirm').hidden = true;
        byId('sp-form-error').hidden = true;
        dialog.showModal();
        renderStatus();
        byId('sp-task-title').focus();
    }

    function announce(message) { byId('sp-announcement').textContent = message; }

    function broadcastChange(userId) {
        try { localStorage.setItem(signalKey, JSON.stringify({ userId, token: crypto.randomUUID() })); }
        catch { /* The current tab and account storage still work without localStorage. */ }
    }

    async function mutate(operation, onSuccess) {
        if (state.busy || !state.userId) return;
        const userId = state.userId;
        const epoch = state.epoch;
        abortLoad();
        state.busy = true;
        state.actionError = '';
        byId('sp-form-error').hidden = true;
        render();
        try {
            const result = await operation(userId);
            broadcastChange(userId);
            if (!currentSession(userId, epoch)) return;
            state.busy = false;
            onSuccess(result);
            render();
            loadTasks();
        } catch (error) {
            if (!currentSession(userId, epoch)) return;
            console.warn('Study Planner save failed:', error);
            const message = error.name === 'AbortError' ? 'The request took too long. Please try again.' :
                (error.status ? error.message : 'Could not save your changes. Please check your connection and try again.');
            if (dialog.open) {
                byId('sp-form-error').textContent = message;
                byId('sp-form-error').hidden = false;
            } else state.actionError = message;
        } finally {
            if (currentSession(userId, epoch)) {
                state.busy = false;
                render();
            }
        }
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        if (!state.editor || state.busy) return;
        const title = byId('sp-task-title').value.trim();
        const taskDate = byId('sp-task-date').value;
        const taskTime = byId('sp-task-time').value || null;
        byId('sp-task-title').setCustomValidity(title ? '' : 'Enter a task title.');
        if (!form.reportValidity() || !parseDate(taskDate) || (taskTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(taskTime))) return;
        const editor = state.editor;
        const payload = { id: editor.id, title, task_date: taskDate, task_time: taskTime };
        mutate(userId => request(editor.isNew ? 'POST' : 'PATCH', '', payload, userId), result => {
            const task = normalizeTask(result.task);
            state.tasks = [...state.tasks.filter(item => item.id !== task.id), task];
            state.selected = task.task_date;
            state.month = firstOfMonth(parseDate(task.task_date));
            closeEditor();
            announce(editor.isNew ? 'Study task added.' : 'Study task updated.');
        });
    });
    byId('sp-task-title').addEventListener('input', () => byId('sp-task-title').setCustomValidity(''));
    byId('sp-add').addEventListener('click', () => openEditor());
    byId('sp-cancel').addEventListener('click', () => closeEditor());
    byId('sp-dialog-close').addEventListener('click', () => closeEditor());
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
    byId('sp-delete').addEventListener('click', () => {
        byId('sp-delete-confirm').hidden = false;
        byId('sp-confirm-delete').focus();
    });
    byId('sp-keep-task').addEventListener('click', () => {
        byId('sp-delete-confirm').hidden = true;
        byId('sp-delete').focus();
    });
    byId('sp-confirm-delete').addEventListener('click', () => {
        if (!state.editor || state.editor.isNew || state.busy) return;
        const id = state.editor.id;
        mutate(userId => request('DELETE', '', { id }, userId), () => {
            state.tasks = state.tasks.filter(task => task.id !== id);
            closeEditor();
            announce('Study task deleted.');
        });
    });
    taskList.addEventListener('click', event => {
        const button = event.target.closest('button[data-action="edit"]');
        if (button && taskList.contains(button)) openEditor(button.dataset.taskId);
    });
    taskList.addEventListener('change', event => {
        const check = event.target;
        if (check.dataset.action !== 'toggle') return;
        const task = state.tasks.find(item => item.id === check.dataset.taskId);
        if (!task || state.busy) return;
        const complete = !task.is_completed;
        mutate(userId => request('PATCH', '', { id: task.id, is_completed: complete }, userId), result => {
            const updated = normalizeTask(result.task);
            state.tasks = state.tasks.map(item => item.id === updated.id ? updated : item);
            announce(complete ? 'Task completed.' : 'Task marked incomplete.');
        });
    });
    calendar.addEventListener('click', event => {
        const button = event.target.closest('button[data-date]');
        if (button && calendar.contains(button)) selectDate(button.dataset.date);
    });
    calendar.addEventListener('keydown', event => {
        const button = event.target.closest('button[data-date]');
        if (!button || state.busy) return;
        const date = parseDate(button.dataset.date);
        if (!date) return;
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
            Home: -date.getDay(), End: 6 - date.getDay() };
        if (Object.prototype.hasOwnProperty.call(offsets, event.key)) {
            event.preventDefault();
            date.setDate(date.getDate() + offsets[event.key]);
            selectDate(dateKey(date), true);
        } else if (event.key === 'PageUp' || event.key === 'PageDown') {
            event.preventDefault();
            moveMonth(event.key === 'PageUp' ? -1 : 1, true);
        }
    });
    byId('sp-prev').addEventListener('click', () => moveMonth(-1));
    byId('sp-next').addEventListener('click', () => moveMonth(1));
    byId('sp-today').addEventListener('click', () => selectDate(dateKey(new Date()), true));
    byId('sp-refresh').addEventListener('click', loadTasks);
    byId('sp-retry').addEventListener('click', loadTasks);

    function refreshVisible() {
        if (state.userId && !state.busy && !dialog.open && document.visibilityState !== 'hidden') loadTasks();
    }
    function stopPolling() { clearInterval(state.interval); state.interval = null; }
    function startPolling() {
        if (state.userId && !state.interval) state.interval = setInterval(refreshVisible, 60000);
    }
    window.addEventListener('focus', refreshVisible);
    window.addEventListener('online', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('pagehide', () => { stopPolling(); abortLoad(); });
    window.addEventListener('pageshow', () => { startPolling(); refreshVisible(); });
    window.addEventListener('storage', event => {
        if (event.key !== signalKey || !event.newValue) return;
        try { if (JSON.parse(event.newValue).userId === state.userId) refreshVisible(); }
        catch { /* Ignore malformed cross-tab signals. */ }
    });

    render();
    onAuthStateChanged(auth, user => {
        abortLoad();
        stopPolling();
        closeEditor(true);
        state.epoch++;
        state.userId = user?.uid || null;
        state.tasks = [];
        state.ready = false;
        state.busy = false;
        state.loadError = '';
        state.actionError = '';
        state.selected = dateKey(new Date());
        state.month = firstOfMonth(new Date());
        render();
        if (state.userId) { startPolling(); loadTasks(); }
    });
})();

/* ===== PASTE AT THE VERY BOTTOM OF script/dashboard.js (after the Study Planner block) ===== */
/* dashboard-enhance.js
   1) Quiz hub: one card with a Continue / Recent toggle.
      dashboard.js creates #paused-quizzes-section on its own; this file moves it
      into the hub (and keeps doing so if dashboard.js re-inserts it).
   2) Upload hero: real drag & drop (hands the file to #file-input) and click-to-browse. */
(function () {
    'use strict';

    /* ---------- Upload hero: drag & drop + click anywhere to browse ----------
       dashboard.js only listens for "change" on #file-input, so a dropped file is
       handed to that same input and a change event is fired. The folder picker,
       upload and "Create Quiz Now" modal then run exactly as with Browse Files. */
    var dz = document.getElementById('drop-zone');
    var fileInput = document.getElementById('file-input');
    if (dz && fileInput) {
        var MAX_BYTES = 50 * 1024 * 1024;
        var OK_EXT = ['pdf', 'png', 'jpg', 'jpeg'];

        function warn(title, text) {
            if (window.Swal) window.Swal.fire(title, text, 'warning');
            else window.alert(title + '\n' + text);
        }

        function handOff(file) {
            var ext = (file.name.split('.').pop() || '').toLowerCase();
            if (OK_EXT.indexOf(ext) === -1) { warn('Unsupported file', 'Please choose a PDF, PNG or JPG file.'); return; }
            if (file.size > MAX_BYTES) { warn('File too large', 'The maximum file size is 50MB.'); return; }
            try {
                var dt = new DataTransfer();
                dt.items.add(file);
                fileInput.files = dt.files;
                fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (err) {
                warn('Could not read the dropped file', 'Please use Browse Files instead.');
            }
        }

        ['dragenter', 'dragover'].forEach(function (t) {
            dz.addEventListener(t, function (e) {
                if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') === -1) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                dz.classList.add('is-dragover');
            });
        });
        dz.addEventListener('dragleave', function (e) {
            if (e.relatedTarget && dz.contains(e.relatedTarget)) return;
            dz.classList.remove('is-dragover');
        });
        dz.addEventListener('drop', function (e) {
            e.preventDefault();
            dz.classList.remove('is-dragover');
            var files = e.dataTransfer && e.dataTransfer.files;
            if (!files || !files.length) return;
            if (files.length > 1) warn('One file at a time', 'Only the first file will be uploaded.');
            handOff(files[0]);
        });

        // Clicking the empty part of the hero opens the file chooser too.
        dz.addEventListener('click', function (e) {
            if (e.target.closest('#browse-btn')) return; // the button already does this
            fileInput.click();
        });

        // Dropping a file outside the hero should not make the browser open it.
        ['dragover', 'drop'].forEach(function (t) {
            window.addEventListener(t, function (e) {
                if (!dz.contains(e.target) && e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) e.preventDefault();
            });
        });
    }

    /* ---------- Quiz hub ---------- */
    var hub = document.getElementById('quiz-hub');
    if (!hub) return;

    var tabsEl = hub.querySelector('.hub-tabs');
    var tabs = Array.prototype.slice.call(hub.querySelectorAll('.hub-tab'));
    var panes = {
        continue: document.getElementById('hub-pane-continue'),
        recent: document.getElementById('hub-pane-recent')
    };
    var countEl = {
        continue: document.getElementById('hub-count-continue'),
        recent: document.getElementById('hub-count-recent')
    };
    var captionEl = document.getElementById('hub-caption');
    var emptyContinue = document.getElementById('hub-empty-continue');

    var STORE_KEY = 'rgHubTab';
    var current = 'recent';
    var userPicked = false;
    try {
        var saved = sessionStorage.getItem(STORE_KEY);
        if (saved === 'continue' || saved === 'recent') { current = saved; userPicked = true; }
    } catch (e) { /* storage blocked: fine */ }

    function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }

    function select(name, byUser, focus) {
        current = name;
        if (byUser) {
            userPicked = true;
            try { sessionStorage.setItem(STORE_KEY, name); } catch (e) {}
        }
        tabsEl.setAttribute('data-active', name);
        tabs.forEach(function (tab) {
            var on = tab.getAttribute('data-tab') === name;
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
            tab.tabIndex = on ? 0 : -1;
            if (on && focus) tab.focus();
        });
        panes.continue.hidden = name !== 'continue';
        panes.recent.hidden = name !== 'recent';
        updateCaption();
    }

    var counts = { continue: 0, recent: 0 };

    function updateCaption() {
        var n = counts[current];
        var loading = current === 'recent' && hub.querySelector('#rq-cards-list .fa-spinner');
        var text;
        if (loading) text = 'Loading your quizzes…';
        else if (current === 'continue') {
            text = n > 0
                ? n + ' unfinished ' + (n === 1 ? 'quiz' : 'quizzes') + ' · pick up where you stopped'
                : 'Nothing paused right now';
        } else {
            text = n > 0
                ? 'Your last ' + n + ' ' + (n === 1 ? 'quiz' : 'quizzes') + ' · retake any time'
                : 'No quizzes taken yet';
        }
        setText(captionEl, text);
    }

    function adopt() {
        var paused = document.getElementById('paused-quizzes-section');
        if (paused && paused.parentNode !== panes.continue) {
            panes.continue.insertBefore(paused, panes.continue.firstChild);
        }
    }

    function refresh() {
        adopt();
        counts.continue = hub.querySelectorAll('.paused-card').length;
        counts.recent = hub.querySelectorAll('#rq-cards-list .rq-card').length;

        setText(countEl.continue, String(counts.continue));
        setText(countEl.recent, String(counts.recent));
        hub.setAttribute('data-has-continue', counts.continue > 0 ? 'true' : 'false');
        emptyContinue.hidden = counts.continue > 0;

        if (!userPicked) {
            var want = counts.continue > 0 ? 'continue' : 'recent';
            if (want !== current || panes[want].hidden) select(want, false);
        }
        updateCaption();
    }

    var raf = 0;
    function schedule() {
        if (raf) return;
        raf = requestAnimationFrame(function () { raf = 0; refresh(); });
    }

    tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () { select(tab.getAttribute('data-tab'), true); });
        tab.addEventListener('keydown', function (e) {
            var next = null;
            if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
            else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = tabs.length - 1;
            if (next === null) return;
            e.preventDefault();
            select(tabs[next].getAttribute('data-tab'), true, true);
        });
    });

    select(current, false);
    refresh();

    var root = document.querySelector('.main-content') || document.body;
    new MutationObserver(function () { adopt(); schedule(); }).observe(root, { childList: true, subtree: true });
})();
