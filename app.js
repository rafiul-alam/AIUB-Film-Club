/**
 * AIUB Film Club - Ticket Searcher & Gate Admission System
 * Core Application Engine
 */

(function () {
  'use strict';

  // --- Constants & Storage Keys ---
  const STORAGE_KEYS = {
    DAY1_URL: 'afc_sheet_day1_url',
    DAY2_URL: 'afc_sheet_day2_url',
    CACHED_DATA: 'afc_cached_tickets_v1',
    LAST_SYNC: 'afc_last_sync_timestamp',
    ADMISSIONS: 'afc_gate_admissions',
    THEME: 'afc_theme_preference',
    SOUND: 'afc_sound_preference',
    AUTO_SYNC: 'afc_auto_sync_interval',
    REVENUE_VISIBLE: 'afc_revenue_visible'
  };

  const DEFAULT_SHEETS = {
    day1: 'https://docs.google.com/spreadsheets/d/1QrkfLwS3J8bKVyySSwsjx4Vgj8gu-XyfKQMwK-gvLTM/edit?usp=sharing',
    day2: 'https://docs.google.com/spreadsheets/d/1sGI0hkBuy80hOfdbML92ZpsSUHaQIRpiArSw6zVAzUw/edit?usp=sharing'
  };

  // --- Application State ---
  const state = {
    allTickets: [],
    filteredTickets: [],
    admissions: {}, // { [ticketNumber]: { timestamp, displayTime } }
    day1Url: '',
    day2Url: '',
    currentView: 'cards', // 'cards' | 'table'
    searchQuery: '',
    filterDay: 'all',
    filterMovie: 'all',
    filterCheckIn: 'all',
    soundEnabled: true,
    revenueVisible: false,
    isSyncing: false,
    autoSyncTimer: null
  };

  // --- Audio Chime Synthesizer (Zero External Dependencies) ---
  function playAudioFeedback(type = 'success') {
    if (!state.soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      if (type === 'success') {
        // High two-tone confirmation chime
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, now); // D5
        osc1.frequency.setValueAtTime(880, now + 0.1); // A5

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

        osc1.connect(gain);
        gain.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.35);
      } else if (type === 'alert') {
        // Warning chime
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(350, now);
        osc.frequency.setValueAtTime(250, now + 0.15);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.4);
      }
    } catch (e) {
      console.warn('Audio feedback failed:', e);
    }
  }

  // --- Utility Functions ---
  function extractSheetId(input) {
    if (!input) return '';
    const trimmed = input.trim();
    // Check if it's already a raw ID (alphanumeric + hyphens/underscores, ~30-50 chars)
    if (/^[a-zA-Z0-9-_]{20,60}$/.test(trimmed)) {
      return trimmed;
    }
    // Match /spreadsheets/d/([a-zA-Z0-9-_]+)
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      return match[1];
    }
    return trimmed;
  }

  function normalizeAlphanumeric(str) {
    if (!str) return '';
    return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function formatCurrency(amount) {
    const num = parseFloat(amount) || 0;
    return `৳${num.toLocaleString('en-US')}`;
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- JSONP Google Sheets Loader ---
  function fetchGoogleSheetJsonp(sheetId) {
    return new Promise((resolve, reject) => {
      if (!sheetId) {
        return resolve({ cols: [], rows: [] });
      }

      const callbackName = 'afc_gviz_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
      const script = document.createElement('script');
      let timedOut = false;

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        cleanup();
        reject(new Error('Connection timed out while fetching Google Sheet'));
      }, 15000);

      function cleanup() {
        clearTimeout(timeoutTimer);
        try {
          delete window[callbackName];
        } catch (e) {
          window[callbackName] = undefined;
        }
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      }

      window[callbackName] = function (response) {
        if (timedOut) return;
        cleanup();
        if (response && response.status === 'error') {
          reject(new Error(response.errors && response.errors[0] ? response.errors[0].message : 'Sheet error'));
        } else {
          resolve(response);
        }
      };

      script.onerror = function () {
        cleanup();
        reject(new Error('Network error or Sheet permissions issue'));
      };

      script.src = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=responseHandler:${callbackName}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
  }

  // --- Parser for Google Visualization Response ---
  function parseGoogleSheetResponse(gvizData, dayLabel) {
    if (!gvizData || !gvizData.table) return [];
    const table = gvizData.table;
    let headers = [];
    let rows = [];

    const colsHaveLabels = table.cols && table.cols.some(c => c && c.label && c.label.trim() !== '');

    if (colsHaveLabels) {
      headers = table.cols.map(c => (c && c.label ? c.label.trim() : ''));
      rows = table.rows || [];
    } else if (table.rows && table.rows.length > 0) {
      // Row 0 is the column header row (e.g. Day 2)
      headers = table.rows[0].c.map(cell => (cell && cell.v !== null && cell.v !== undefined ? String(cell.v).trim() : ''));
      rows = table.rows.slice(1);
    } else {
      return [];
    }

    const fieldMap = {
      timestamp: -1,
      name: -1,
      studentId: -1,
      contact: -1,
      movie: -1,
      totalTickets: -1,
      paymentMethod: -1,
      senderMobile: -1,
      trxId: -1,
      amount: -1,
      email: -1,
      ticketNumber: -1,
      emailStatus: -1
    };

    headers.forEach((h, idx) => {
      const lower = h.toLowerCase();
      if (lower.includes('ticket number') || lower.includes('ticket no') || lower.includes('ticket#')) {
        fieldMap.ticketNumber = idx;
      } else if (lower.includes('student id') || lower.includes('id no') || lower.includes('student_id')) {
        fieldMap.studentId = idx;
      } else if (lower.includes('name') && !lower.includes('sender')) {
        fieldMap.name = idx;
      } else if (lower.includes('movie') || lower.includes('slot')) {
        fieldMap.movie = idx;
      } else if (lower.includes('total ticket') || lower.includes('quantity') || lower.includes('seats')) {
        fieldMap.totalTickets = idx;
      } else if (lower.includes('trxid') || lower.includes('transaction')) {
        fieldMap.trxId = idx;
      } else if (lower.includes('payment amount') || lower.includes('amount') || lower.includes('bdt') || lower.includes('taka')) {
        fieldMap.amount = idx;
      } else if (lower.includes('payment method')) {
        fieldMap.paymentMethod = idx;
      } else if (lower.includes('sender') && lower.includes('mobile')) {
        fieldMap.senderMobile = idx;
      } else if (lower.includes('contact') || lower.includes('mobile') || lower.includes('phone')) {
        fieldMap.contact = idx;
      } else if (lower.includes('email') && !lower.includes('status')) {
        fieldMap.email = idx;
      } else if (lower.includes('status')) {
        fieldMap.emailStatus = idx;
      } else if (lower.includes('timestamp') || lower.includes('time')) {
        fieldMap.timestamp = idx;
      }
    });

    const parsedTickets = [];

    rows.forEach((row, rowIndex) => {
      if (!row || !row.c) return;

      const getVal = (colIndex) => {
        if (colIndex === -1 || !row.c[colIndex]) return '';
        const cell = row.c[colIndex];
        if (cell.f !== undefined && cell.f !== null) return String(cell.f).trim();
        if (cell.v !== undefined && cell.v !== null) return String(cell.v).trim();
        return '';
      };

      const ticketNumber = getVal(fieldMap.ticketNumber);
      const studentId = getVal(fieldMap.studentId);
      const name = getVal(fieldMap.name);

      // Skip row if it has no identifier at all
      if (!ticketNumber && !studentId && !name) return;

      let cleanTotal = getVal(fieldMap.totalTickets);
      if (!cleanTotal || cleanTotal === '0') cleanTotal = '1';

      parsedTickets.push({
        id: `${dayLabel}-${rowIndex}-${ticketNumber || studentId}`,
        day: dayLabel,
        ticketNumber: ticketNumber || `${dayLabel}-PASS-${rowIndex + 1}`,
        studentId: studentId,
        name: name,
        contact: getVal(fieldMap.contact),
        movie: getVal(fieldMap.movie) || 'AIUB Film Club Screening',
        totalTickets: cleanTotal,
        paymentMethod: getVal(fieldMap.paymentMethod) || 'Bkash',
        senderMobile: getVal(fieldMap.senderMobile),
        trxId: getVal(fieldMap.trxId),
        amount: getVal(fieldMap.amount) || '50',
        email: getVal(fieldMap.email),
        emailStatus: getVal(fieldMap.emailStatus) || 'SENT',
        timestamp: getVal(fieldMap.timestamp)
      });
    });

    return parsedTickets;
  }

  // --- Fallback & Offline Parser for Preloaded Object Data ---
  function parsePreloadedRows(rowList, dayLabel) {
    if (!Array.isArray(rowList)) return [];
    return rowList.map((item, idx) => {
      let movieKey = Object.keys(item).find(k => k.toLowerCase().includes('movie') || k.toLowerCase().includes('slot')) || '';
      let amountKey = Object.keys(item).find(k => k.toLowerCase().includes('amount') || k.toLowerCase().includes('bdt')) || '';
      let paymentKey = Object.keys(item).find(k => k.toLowerCase().includes('payment method')) || '';

      return {
        id: `${dayLabel}-preloaded-${idx}`,
        day: dayLabel,
        ticketNumber: item['Ticket Number'] || `${dayLabel}-AFC-00${idx + 1}`,
        studentId: item['Student ID'] || '',
        name: item['Name'] || '',
        contact: item['Contact Number'] || '',
        movie: item[movieKey] || item['Movie'] || 'AIUB Film Club Screening',
        totalTickets: item['Total Ticket'] || '1',
        paymentMethod: item[paymentKey] || item['Payment Method'] || 'Bkash',
        senderMobile: item["Sender's Mobile Number"] || '',
        trxId: item['Transaction ID (TrxID)'] || item['TrxID'] || '',
        amount: item[amountKey] || item['Payment Amount'] || '50',
        email: item['Email Address'] || '',
        emailStatus: item['Ticket Email Status'] || 'SENT',
        timestamp: item['Timestamp'] || ''
      };
    });
  }

  // --- Sync Controller ---
  async function syncTickets(forceUserTrigger = false) {
    if (state.isSyncing) return;
    state.isSyncing = true;
    updateSyncIndicator('syncing', 'Syncing live sheets...');

    const btnSync = document.getElementById('btnSync');
    if (btnSync) btnSync.classList.add('btn-spinning');

    const day1Id = extractSheetId(state.day1Url);
    const day2Id = extractSheetId(state.day2Url);

    let day1Tickets = [];
    let day2Tickets = [];
    let isDay1Success = false;
    let isDay2Success = false;

    // 1. Attempt Live Fetch for Day 1
    try {
      if (day1Id) {
        const res1 = await fetchGoogleSheetJsonp(day1Id);
        day1Tickets = parseGoogleSheetResponse(res1, 'Day 1');
        isDay1Success = true;
      }
    } catch (err) {
      console.warn('Day 1 Live Fetch Error:', err);
    }

    // 2. Attempt Live Fetch for Day 2
    try {
      if (day2Id) {
        const res2 = await fetchGoogleSheetJsonp(day2Id);
        day2Tickets = parseGoogleSheetResponse(res2, 'Day 2');
        isDay2Success = true;
      }
    } catch (err) {
      console.warn('Day 2 Live Fetch Error:', err);
    }

    // 3. Fallback to offline cache if live fetch failed completely
    if (!isDay1Success && !isDay2Success) {
      const cached = localStorage.getItem(STORAGE_KEYS.CACHED_DATA);
      if (cached) {
        try {
          const parsedCache = JSON.parse(cached);
          if (Array.isArray(parsedCache) && parsedCache.length > 0) {
            state.allTickets = parsedCache;
            updateSyncIndicator('offline', 'Using Cached Offline Data');
            if (forceUserTrigger) showToast('Loaded cached tickets (Offline mode)', 'info');
            finishSync();
            return;
          }
        } catch (e) {
          console.error('Failed to parse cached data:', e);
        }
      }

      // If no local cache, use preloaded sample snapshot
      if (window.PRELOADED_DAY1_DATA) {
        day1Tickets = parsePreloadedRows(window.PRELOADED_DAY1_DATA, 'Day 1');
      }
      if (window.PRELOADED_DAY2_DATA) {
        day2Tickets = parsePreloadedRows(window.PRELOADED_DAY2_DATA, 'Day 2');
      }
      updateSyncIndicator('offline', 'Offline Mode (Preloaded)');
      if (forceUserTrigger) showToast('Internet unavailable. Using preloaded snapshot.', 'info');
    } else {
      // Successful live fetch!
      const syncTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      localStorage.setItem(STORAGE_KEYS.LAST_SYNC, syncTimeStr);
      updateSyncIndicator('online', `Synced at ${syncTimeStr}`);

      const prevCount = state.allTickets.length;
      const newTotalCount = day1Tickets.length + day2Tickets.length;

      if (prevCount > 0 && newTotalCount > prevCount) {
        const diff = newTotalCount - prevCount;
        showToast(`🎉 ${diff} new ticket entry${diff > 1 ? 's' : ''} detected from Google Form!`, 'success');
        playAudioFeedback('success');
      } else if (forceUserTrigger) {
        showToast(`Sheets updated: ${newTotalCount} tickets loaded!`, 'success');
      }
    }

    // Combine tickets & update cache
    state.allTickets = [...day1Tickets, ...day2Tickets];
    if (state.allTickets.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEYS.CACHED_DATA, JSON.stringify(state.allTickets));
      } catch (e) {
        console.warn('Storage quota exceeded:', e);
      }
    }

    finishSync();
  }

  function finishSync() {
    state.isSyncing = false;
    const btnSync = document.getElementById('btnSync');
    if (btnSync) btnSync.classList.remove('btn-spinning');

    populateMovieDropdown();
    applySearchAndFilters();
    updateStats();
  }

  function updateSyncIndicator(status, text) {
    const dot = document.getElementById('statusDot');
    const label = document.getElementById('statusLabel');
    const time = document.getElementById('lastSyncTime');

    if (dot) {
      dot.className = `status-dot ${status}`;
    }
    if (label) {
      label.textContent = status === 'online' ? 'Live Connected' : status === 'syncing' ? 'Syncing...' : 'Offline Mode';
    }
    if (time) {
      time.textContent = text;
    }
  }

  // --- Dynamic Movie Filter Population ---
  function populateMovieDropdown() {
    const movieSelect = document.getElementById('filterMovie');
    if (!movieSelect) return;

    const currentVal = movieSelect.value;
    const movies = new Set();

    state.allTickets.forEach(t => {
      if (t.movie && t.movie.trim()) {
        movies.add(t.movie.trim());
      }
    });

    let html = '<option value="all">All Movie Slots</option>';
    Array.from(movies).sort().forEach(movie => {
      const selected = movie === currentVal ? 'selected' : '';
      html += `<option value="${escapeHtml(movie)}" ${selected}>${escapeHtml(movie)}</option>`;
    });

    movieSelect.innerHTML = html;
  }

  // --- Multi-Field Search Engine ---
  function applySearchAndFilters() {
    const query = state.searchQuery.trim().toLowerCase();
    const queryNoDash = normalizeAlphanumeric(query);

    const filtered = state.allTickets.filter(ticket => {
      // 1. Day Filter
      if (state.filterDay !== 'all') {
        if (ticket.day !== state.filterDay) return false;
      }

      // 2. Movie Filter
      if (state.filterMovie !== 'all') {
        if (ticket.movie !== state.filterMovie) return false;
      }

      // 3. Gate Status Filter
      const isAdmitted = !!state.admissions[ticket.ticketNumber];
      if (state.filterCheckIn === 'admitted' && !isAdmitted) return false;
      if (state.filterCheckIn === 'not_admitted' && isAdmitted) return false;

      // 4. Search Query Match
      if (!query) return true;

      // Match Student ID (with or without hyphens)
      const sidClean = normalizeAlphanumeric(ticket.studentId);
      if (sidClean && (sidClean.includes(queryNoDash) || ticket.studentId.toLowerCase().includes(query))) {
        return true;
      }

      // Match Name
      if (ticket.name && ticket.name.toLowerCase().includes(query)) {
        return true;
      }

      // Match Ticket Number (e.g. Day-1-AFC-002, 002, AFC-002)
      const tNumLower = ticket.ticketNumber.toLowerCase();
      const tNumClean = normalizeAlphanumeric(ticket.ticketNumber);
      if (tNumLower.includes(query) || (queryNoDash && tNumClean.includes(queryNoDash))) {
        return true;
      }

      // Match Transaction ID (TrxID)
      if (ticket.trxId && ticket.trxId.toLowerCase().includes(query)) {
        return true;
      }

      // Match Phone / Mobile
      const contactClean = normalizeAlphanumeric(ticket.contact);
      const senderClean = normalizeAlphanumeric(ticket.senderMobile);
      if ((contactClean && contactClean.includes(queryNoDash)) || (senderClean && senderClean.includes(queryNoDash))) {
        return true;
      }

      // Match Email
      if (ticket.email && ticket.email.toLowerCase().includes(query)) {
        return true;
      }

      return false;
    });

    state.filteredTickets = filtered;
    renderResults();
    updateStats();
  }

  // --- Rendering Functions ---
  function renderResults() {
    const grid = document.getElementById('ticketsGrid');
    const tableView = document.getElementById('ticketsTableView');
    const emptyState = document.getElementById('emptyState');
    const resultsCount = document.getElementById('resultsCount');

    const totalCount = state.filteredTickets.length;

    // Results counter text
    if (state.searchQuery.trim()) {
      resultsCount.innerHTML = `Found <strong>${totalCount}</strong> matching ticket${totalCount === 1 ? '' : 's'} for "<em>${escapeHtml(state.searchQuery)}</em>"`;
    } else {
      resultsCount.innerHTML = `Showing <strong>${totalCount}</strong> ticket${totalCount === 1 ? '' : 's'} total`;
    }

    if (totalCount === 0) {
      grid.style.display = 'none';
      tableView.style.display = 'none';
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    if (state.currentView === 'cards') {
      grid.style.display = 'grid';
      tableView.style.display = 'none';
      renderCardsView(grid);
    } else {
      grid.style.display = 'none';
      tableView.style.display = 'block';
      renderTableView();
    }
  }

  function renderCardsView(container) {
    let html = '';

    state.filteredTickets.forEach(ticket => {
      const admission = state.admissions[ticket.ticketNumber];
      const isAdmitted = !!admission;
      const cardClass = isAdmitted ? 'ticket-card is-admitted' : 'ticket-card';
      const statusBadgeClass = ticket.emailStatus && ticket.emailStatus.toUpperCase() === 'SENT' ? 'badge-status-sent' : 'badge-status-pending';

      html += `
        <article class="${cardClass}" data-ticket="${escapeHtml(ticket.ticketNumber)}">
          <!-- Top Header -->
          <div class="ticket-header">
            <div class="ticket-movie-badge-wrap">
              <div class="badge-row">
                <span class="badge badge-day">${escapeHtml(ticket.day)}</span>
                <span class="badge badge-ticket-num">${escapeHtml(ticket.ticketNumber)}</span>
                <span class="badge ${statusBadgeClass}">${escapeHtml(ticket.emailStatus || 'CONFIRMED')}</span>
              </div>
              <h3 class="ticket-movie-title">${escapeHtml(ticket.movie)}</h3>
            </div>
            <div class="ticket-qty-pill" title="Number of tickets purchased">
              <span class="qty-number">${escapeHtml(ticket.totalTickets)}</span>
              <span class="qty-label">${parseInt(ticket.totalTickets, 10) > 1 ? 'SEATS' : 'SEAT'}</span>
            </div>
          </div>

          <!-- Student & Ticket Details -->
          <div class="ticket-body">
            <div class="student-hero">
              <div class="student-info">
                <div class="student-name">${escapeHtml(ticket.name || 'Anonymous Student')}</div>
                <div class="student-id">ID: ${escapeHtml(ticket.studentId || 'N/A')}</div>
              </div>
              ${isAdmitted ? `
                <div class="admitted-meta-badge" title="Verified at entry">
                  <span class="admitted-title">✅ VERIFIED</span>
                  <span class="admitted-sub">${escapeHtml(admission.displayTime)}</span>
                </div>
              ` : ''}
            </div>

            <!-- Perforation Cutout -->
            <div class="ticket-perforation">
              <div class="perforation-line"></div>
            </div>

            <!-- Details Grid -->
            <div class="details-table-grid">
              <div class="detail-cell">
                <span class="detail-k">Payment Method</span>
                <span class="detail-v">${escapeHtml(ticket.paymentMethod)}</span>
              </div>

              <div class="detail-cell">
                <span class="detail-k">Amount Paid</span>
                <span class="detail-v">${formatCurrency(ticket.amount)}</span>
              </div>

              <div class="detail-cell">
                <span class="detail-k">Transaction ID</span>
                <span class="detail-v"><code>${escapeHtml(ticket.trxId || 'N/A')}</code></span>
              </div>

              <div class="detail-cell">
                <span class="detail-k">Sender Phone</span>
                <span class="detail-v">${escapeHtml(ticket.senderMobile || 'N/A')}</span>
              </div>

              <div class="detail-cell">
                <span class="detail-k">Student Contact</span>
                <span class="detail-v">
                  ${ticket.contact ? `<a href="tel:${escapeHtml(ticket.contact)}">${escapeHtml(ticket.contact)}</a>` : 'N/A'}
                </span>
              </div>

              <div class="detail-cell">
                <span class="detail-k">Registered Time</span>
                <span class="detail-v">${escapeHtml(ticket.timestamp || 'N/A')}</span>
              </div>

              <div class="detail-cell full-width">
                <span class="detail-k">Email Address</span>
                <span class="detail-v">
                  ${ticket.email ? `<a href="mailto:${escapeHtml(ticket.email)}">${escapeHtml(ticket.email)}</a>` : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          <!-- Gate Pass Admission Footer -->
          <div class="ticket-footer">
            <div class="admit-action-row">
              ${isAdmitted ? `
                <button class="btn btn-checkin admitted" disabled>
                  <span>✅ Admitted at Gate (${escapeHtml(admission.displayTime)})</span>
                </button>
                <button class="btn-undo" onclick="window.afcApp.undoCheckIn('${escapeHtml(ticket.ticketNumber)}')" title="Undo gate check-in">
                  Undo
                </button>
              ` : `
                <button class="btn btn-checkin admit-ready" onclick="window.afcApp.checkIn('${escapeHtml(ticket.ticketNumber)}')">
                  <span>🎟️ Admit at Gate / Check-In</span>
                </button>
              `}
            </div>

            <div class="ticket-secondary-actions">
              <button class="btn btn-sm btn-outline" onclick="window.afcApp.copyTicketDetails('${escapeHtml(ticket.ticketNumber)}')">
                📋 Copy Info
              </button>
              <button class="btn btn-sm btn-outline" onclick="window.afcApp.printPass('${escapeHtml(ticket.ticketNumber)}')">
                🖨️ Print Slip
              </button>
            </div>
          </div>
        </article>
      `;
    });

    container.innerHTML = html;
  }

  function renderTableView() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;

    let html = '';
    state.filteredTickets.forEach(ticket => {
      const isAdmitted = !!state.admissions[ticket.ticketNumber];
      const admission = state.admissions[ticket.ticketNumber];
      const rowClass = isAdmitted ? 'row-admitted' : '';

      html += `
        <tr class="${rowClass}">
          <td><strong><code>${escapeHtml(ticket.ticketNumber)}</code></strong></td>
          <td><span class="badge badge-day">${escapeHtml(ticket.day)}</span></td>
          <td><strong style="color: var(--ticket-highlight);">${escapeHtml(ticket.studentId)}</strong></td>
          <td><strong>${escapeHtml(ticket.name)}</strong></td>
          <td>${escapeHtml(ticket.movie)}</td>
          <td><span class="badge badge-ticket-num">${escapeHtml(ticket.totalTickets)}</span></td>
          <td>${escapeHtml(ticket.paymentMethod)} (${formatCurrency(ticket.amount)})</td>
          <td><code>${escapeHtml(ticket.trxId || '-')}</code></td>
          <td>${escapeHtml(ticket.contact || ticket.senderMobile || '-')}</td>
          <td>
            ${isAdmitted ? 
              `<span style="color: var(--accent-green); font-weight:700;">✅ In (${escapeHtml(admission.displayTime)})</span>` : 
              `<span style="color: var(--text-muted);">Pending</span>`}
          </td>
          <td>
            ${isAdmitted ? 
              `<button class="btn-undo" onclick="window.afcApp.undoCheckIn('${escapeHtml(ticket.ticketNumber)}')">Undo</button>` : 
              `<button class="btn btn-sm btn-primary" onclick="window.afcApp.checkIn('${escapeHtml(ticket.ticketNumber)}')">Admit</button>`}
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  }

  // --- Statistics Update ---
  function updateStats() {
    const statTotalTickets = document.getElementById('statTotalTickets');
    const statTotalSeats = document.getElementById('statTotalSeats');
    const revenueAmount = document.getElementById('revenueAmount');
    const statAdmittedCount = document.getElementById('statAdmittedCount');

    let totalSeats = 0;
    let totalRevenue = 0;
    let admittedCount = 0;

    state.allTickets.forEach(t => {
      const qty = parseInt(t.totalTickets, 10) || 1;
      totalSeats += qty;
      totalRevenue += parseFloat(t.amount) || (qty * 50);

      if (state.admissions[t.ticketNumber]) {
        admittedCount++;
      }
    });

    if (statTotalTickets) statTotalTickets.textContent = state.allTickets.length;
    if (statTotalSeats) statTotalSeats.textContent = totalSeats;
    if (revenueAmount) revenueAmount.textContent = `৳${totalRevenue.toLocaleString('en-US')}`;
    if (statAdmittedCount) statAdmittedCount.textContent = `${admittedCount} / ${state.allTickets.length}`;
  }

  // --- Revenue Visibility Toggle ---
  function toggleRevenueVisibility() {
    state.revenueVisible = !state.revenueVisible;
    localStorage.setItem(STORAGE_KEYS.REVENUE_VISIBLE, String(state.revenueVisible));
    applyRevenueVisibility();
  }

  function applyRevenueVisibility() {
    const hiddenLabel = document.getElementById('revenueHiddenLabel');
    const amountEl = document.getElementById('revenueAmount');
    const revealIcon = document.getElementById('revealIcon');

    if (!hiddenLabel || !amountEl) return;

    if (state.revenueVisible) {
      hiddenLabel.style.display = 'none';
      amountEl.style.display = 'inline';
      if (revealIcon) revealIcon.textContent = '🙈';
    } else {
      hiddenLabel.style.display = 'inline';
      amountEl.style.display = 'none';
      if (revealIcon) revealIcon.textContent = '👁️';
    }
  }

  // --- Check-In & Gate Verification Handlers ---
  function handleCheckIn(ticketNumber) {
    if (!ticketNumber) return;
    const now = new Date();
    const timeDisplay = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    state.admissions[ticketNumber] = {
      admittedAt: now.toISOString(),
      displayTime: timeDisplay
    };

    saveAdmissions();
    playAudioFeedback('success');
    showToast(`Checked in ticket ${ticketNumber} at ${timeDisplay}!`, 'success');
    renderResults();
    updateStats();
  }

  function handleUndoCheckIn(ticketNumber) {
    if (!ticketNumber || !state.admissions[ticketNumber]) return;
    delete state.admissions[ticketNumber];
    saveAdmissions();
    showToast(`Reverted gate admission for ${ticketNumber}.`, 'info');
    renderResults();
    updateStats();
  }

  function saveAdmissions() {
    try {
      localStorage.setItem(STORAGE_KEYS.ADMISSIONS, JSON.stringify(state.admissions));
    } catch (e) {
      console.warn('Failed to save admissions:', e);
    }
  }

  function loadAdmissions() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.ADMISSIONS);
      if (stored) {
        state.admissions = JSON.parse(stored);
      }
    } catch (e) {
      state.admissions = {};
    }
  }

  // --- Copy Details to Clipboard ---
  function handleCopyDetails(ticketNumber) {
    const ticket = state.allTickets.find(t => t.ticketNumber === ticketNumber);
    if (!ticket) return;

    const admission = state.admissions[ticket.ticketNumber];
    const admittedText = admission ? `Admitted at ${admission.displayTime}` : 'Not Checked In';

    const textToCopy = [
      `🎬 AIUB FILM CLUB - TICKET VERIFICATION`,
      `---------------------------------------`,
      `Ticket Number: ${ticket.ticketNumber}`,
      `Day: ${ticket.day}`,
      `Student Name: ${ticket.name}`,
      `Student ID: ${ticket.studentId}`,
      `Movie: ${ticket.movie}`,
      `Total Seats: ${ticket.totalTickets}`,
      `Contact: ${ticket.contact || 'N/A'}`,
      `TrxID: ${ticket.trxId || 'N/A'}`,
      `Amount: ৳${ticket.amount} BDT`,
      `Gate Status: ${admittedText}`
    ].join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        showToast(`Copied details for ${ticket.ticketNumber} to clipboard!`, 'success');
      }).catch(() => fallbackCopy(textToCopy));
    } else {
      fallbackCopy(textToCopy);
    }
  }

  function fallbackCopy(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      showToast('Copied to clipboard!', 'success');
    } catch (e) {
      showToast('Unable to copy automatically.', 'error');
    }
    document.body.removeChild(textArea);
  }

  // --- Print Gate Pass Slip ---
  function handlePrintPass(ticketNumber) {
    const ticket = state.allTickets.find(t => t.ticketNumber === ticketNumber);
    if (!ticket) return;

    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    const admission = state.admissions[ticket.ticketNumber];
    const admittedText = admission ? `ADMITTED at ${admission.displayTime}` : 'VALID FOR ENTRY';

    printArea.innerHTML = `
      <div style="font-family: sans-serif; padding: 25px; border: 2px dashed #000; max-width: 420px; margin: 0 auto; background: #fff; color: #000;">
        <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 12px;">
          <h2 style="margin: 0; font-size: 1.4rem;">🎬 AIUB FILM CLUB</h2>
          <p style="margin: 2px 0 0 0; font-size: 0.8rem; letter-spacing: 1px;">OFFICIAL GATE ADMISSION SLIP</p>
        </div>

        <div style="background: #f0f0f0; padding: 10px; border-radius: 6px; text-align: center; margin-bottom: 12px;">
          <div style="font-size: 0.85rem; font-weight: bold; text-transform: uppercase;">${escapeHtml(ticket.day)} • ${escapeHtml(ticket.movie)}</div>
          <div style="font-size: 1.3rem; font-weight: 900; letter-spacing: 2px; margin-top: 4px;">${escapeHtml(ticket.ticketNumber)}</div>
        </div>

        <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-bottom: 14px;">
          <tr>
            <td style="padding: 4px 0; color: #555;">Student Name:</td>
            <td style="padding: 4px 0; font-weight: bold; text-align: right;">${escapeHtml(ticket.name)}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #555;">Student ID:</td>
            <td style="padding: 4px 0; font-weight: bold; text-align: right;">${escapeHtml(ticket.studentId)}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #555;">Seats / Passes:</td>
            <td style="padding: 4px 0; font-weight: bold; text-align: right;">${escapeHtml(ticket.totalTickets)}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #555;">Payment TrxID:</td>
            <td style="padding: 4px 0; font-weight: bold; text-align: right;">${escapeHtml(ticket.trxId || 'Verified')}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #555;">Paid Amount:</td>
            <td style="padding: 4px 0; font-weight: bold; text-align: right;">৳${escapeHtml(ticket.amount)} BDT</td>
          </tr>
        </table>

        <div style="border-top: 1px dashed #000; padding-top: 10px; text-align: center;">
          <div style="font-size: 0.8rem; font-weight: bold; color: #000;">${admittedText}</div>
          <div style="font-size: 0.65rem; color: #666; margin-top: 4px;">Venue: AIUB Auditorium, Ground Floor, Building D</div>
        </div>
      </div>
    `;

    window.print();
  }

  // --- Export / Import Handlers ---
  function exportData(format = 'csv', subset = 'all') {
    const dataToExport = subset === 'filtered' ? state.filteredTickets : state.allTickets;
    if (!dataToExport || dataToExport.length === 0) {
      showToast('No tickets to export!', 'error');
      return;
    }

    if (format === 'json') {
      const jsonStr = JSON.stringify(dataToExport, null, 2);
      downloadFile(jsonStr, `aiub_film_club_tickets_${Date.now()}.json`, 'application/json');
      showToast('Exported tickets as JSON', 'success');
    } else {
      // CSV Format
      const headers = ['Day', 'Ticket Number', 'Student ID', 'Name', 'Movie', 'Seats', 'Payment Method', 'Amount', 'TrxID', 'Sender Mobile', 'Contact', 'Email', 'Gate Status'];
      const rows = dataToExport.map(t => {
        const isAdmitted = !!state.admissions[t.ticketNumber];
        return [
          t.day,
          t.ticketNumber,
          t.studentId,
          `"${(t.name || '').replace(/"/g, '""')}"`,
          `"${(t.movie || '').replace(/"/g, '""')}"`,
          t.totalTickets,
          t.paymentMethod,
          t.amount,
          t.trxId,
          t.senderMobile,
          t.contact,
          t.email,
          isAdmitted ? 'ADMITTED' : 'NOT_ADMITTED'
        ].join(',');
      });

      const csvContent = [headers.join(','), ...rows].join('\r\n');
      downloadFile(csvContent, `aiub_film_club_tickets_${Date.now()}.csv`, 'text/csv');
      showToast('Exported tickets as CSV', 'success');
    }
  }

  function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
  }

  function handleImportCsv(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (event) {
      try {
        const text = event.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
        if (lines.length < 2) {
          showToast('Invalid CSV file (insufficient rows)', 'error');
          return;
        }

        // Basic CSV split parser
        const headers = parseCsvLine(lines[0]);
        const importedTickets = [];

        for (let i = 1; i < lines.length; i++) {
          const cells = parseCsvLine(lines[i]);
          if (cells.length < 3) continue;

          const getByHeader = (keyword) => {
            const idx = headers.findIndex(h => h.toLowerCase().includes(keyword));
            return idx !== -1 && cells[idx] ? cells[idx].trim() : '';
          };

          const ticketNum = getByHeader('ticket') || `IMPORTED-${i}`;
          const sid = getByHeader('student') || getByHeader('id');
          const name = getByHeader('name');

          importedTickets.push({
            id: `imported-${i}`,
            day: getByHeader('day') || 'Day 1',
            ticketNumber: ticketNum,
            studentId: sid,
            name: name,
            movie: getByHeader('movie') || 'AIUB Film Club Screening',
            totalTickets: getByHeader('total') || getByHeader('seat') || '1',
            paymentMethod: getByHeader('payment') || 'Bkash',
            amount: getByHeader('amount') || '50',
            trxId: getByHeader('trx') || '',
            senderMobile: getByHeader('sender') || '',
            contact: getByHeader('contact') || '',
            email: getByHeader('email') || '',
            emailStatus: 'SENT',
            timestamp: ''
          });
        }

        if (importedTickets.length > 0) {
          state.allTickets = importedTickets;
          localStorage.setItem(STORAGE_KEYS.CACHED_DATA, JSON.stringify(importedTickets));
          updateSyncIndicator('offline', `Imported ${importedTickets.length} tickets from file`);
          populateMovieDropdown();
          applySearchAndFilters();
          updateStats();
          closeModal('settingsModal');
          showToast(`Successfully imported ${importedTickets.length} tickets!`, 'success');
        } else {
          showToast('No valid ticket rows found in CSV.', 'error');
        }
      } catch (err) {
        console.error('CSV Import Error:', err);
        showToast('Error parsing CSV file.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function parseCsvLine(line) {
    const result = [];
    let insideQuotes = false;
    let entry = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (insideQuotes && line[i + 1] === '"') {
          entry += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (c === ',' && !insideQuotes) {
        result.push(entry);
        entry = '';
      } else {
        entry += c;
      }
    }
    result.push(entry);
    return result;
  }

  // --- Modals Controller ---
  function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'flex';
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
  }

  // --- Auto-Sync Scheduler ---
  function setupAutoSync() {
    if (state.autoSyncTimer) {
      clearInterval(state.autoSyncTimer);
      state.autoSyncTimer = null;
    }

    const intervalSec = parseInt(localStorage.getItem(STORAGE_KEYS.AUTO_SYNC) || '60', 10);
    if (intervalSec > 0) {
      state.autoSyncTimer = setInterval(() => {
        // Only background sync if not currently interacting
        syncTickets(false);
      }, intervalSec * 1000);
    }
  }

  // --- Initialization & Event Binding ---
  function init() {
    // 1. Load Stored URLs
    state.day1Url = localStorage.getItem(STORAGE_KEYS.DAY1_URL) || DEFAULT_SHEETS.day1;
    state.day2Url = localStorage.getItem(STORAGE_KEYS.DAY2_URL) || DEFAULT_SHEETS.day2;

    // 2. Load Stored Settings
    loadAdmissions();
    const storedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';
    document.body.className = storedTheme === 'light' ? 'theme-light' : 'theme-dark';

    const storedSound = localStorage.getItem(STORAGE_KEYS.SOUND);
    if (storedSound !== null) {
      state.soundEnabled = storedSound === 'true';
    }
    const soundIcon = document.getElementById('soundIcon');
    if (soundIcon) soundIcon.textContent = state.soundEnabled ? '🔔' : '🔕';

    // 3. Search Bar Event Listeners
    const searchInput = document.getElementById('searchInput');
    const btnClearSearch = document.getElementById('btnClearSearch');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        if (btnClearSearch) {
          btnClearSearch.classList.toggle('visible', state.searchQuery.length > 0);
        }
        applySearchAndFilters();
      });

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          searchInput.value = '';
          state.searchQuery = '';
          if (btnClearSearch) btnClearSearch.classList.remove('visible');
          applySearchAndFilters();
        }
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        state.searchQuery = '';
        btnClearSearch.classList.remove('visible');
        applySearchAndFilters();
      });
    }

    // 4. Global Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl+K or '/' to focus search
      if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (e.key === '/' && document.activeElement !== searchInput)) {
        if (searchInput && document.activeElement !== searchInput) {
          e.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
      }
    });

    // 5. Filter Dropdowns
    const filterDay = document.getElementById('filterDay');
    if (filterDay) {
      filterDay.addEventListener('change', (e) => {
        state.filterDay = e.target.value;
        applySearchAndFilters();
      });
    }

    const filterMovie = document.getElementById('filterMovie');
    if (filterMovie) {
      filterMovie.addEventListener('change', (e) => {
        state.filterMovie = e.target.value;
        applySearchAndFilters();
      });
    }

    const filterCheckIn = document.getElementById('filterCheckIn');
    if (filterCheckIn) {
      filterCheckIn.addEventListener('change', (e) => {
        state.filterCheckIn = e.target.value;
        applySearchAndFilters();
      });
    }

    // 6. View Switcher
    const btnViewCards = document.getElementById('btnViewCards');
    const btnViewTable = document.getElementById('btnViewTable');

    if (btnViewCards && btnViewTable) {
      btnViewCards.addEventListener('click', () => {
        state.currentView = 'cards';
        btnViewCards.classList.add('active');
        btnViewTable.classList.remove('active');
        renderResults();
      });

      btnViewTable.addEventListener('click', () => {
        state.currentView = 'table';
        btnViewTable.classList.add('active');
        btnViewCards.classList.remove('active');
        renderResults();
      });
    }

    // 7. Header Action Buttons
    const btnSync = document.getElementById('btnSync');
    if (btnSync) {
      btnSync.addEventListener('click', () => syncTickets(true));
    }

    const btnToggleSound = document.getElementById('btnToggleSound');
    if (btnToggleSound) {
      btnToggleSound.addEventListener('click', () => {
        state.soundEnabled = !state.soundEnabled;
        localStorage.setItem(STORAGE_KEYS.SOUND, String(state.soundEnabled));
        if (soundIcon) soundIcon.textContent = state.soundEnabled ? '🔔' : '🔕';
        showToast(state.soundEnabled ? 'Check-in sound enabled' : 'Check-in sound muted', 'info');
      });
    }

    const btnToggleTheme = document.getElementById('btnToggleTheme');
    if (btnToggleTheme) {
      btnToggleTheme.addEventListener('click', () => {
        const isDark = document.body.classList.contains('theme-dark');
        const newTheme = isDark ? 'light' : 'dark';
        document.body.className = newTheme === 'light' ? 'theme-light' : 'theme-dark';
        localStorage.setItem(STORAGE_KEYS.THEME, newTheme);
      });
    }

    // Revenue Hide / Unhide Toggle
    const storedRevVis = localStorage.getItem(STORAGE_KEYS.REVENUE_VISIBLE);
    state.revenueVisible = storedRevVis === 'true'; // Defaults to false (hidden)
    applyRevenueVisibility();

    const btnToggleRevenue = document.getElementById('btnToggleRevenue');
    if (btnToggleRevenue) {
      btnToggleRevenue.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleRevenueVisibility();
      });
    }

    const revenueCard = document.getElementById('revenueCard');
    if (revenueCard) {
      revenueCard.addEventListener('click', () => {
        toggleRevenueVisibility();
      });
    }

    // 8. Settings Modal Controls
    const btnSettings = document.getElementById('btnSettings');
    const btnCloseSettings = document.getElementById('btnCloseSettings');
    const btnSaveSettings = document.getElementById('btnSaveSettings');
    const btnRestoreDefaults = document.getElementById('btnRestoreDefaultSheets');
    const settingDay1Url = document.getElementById('settingDay1Url');
    const settingDay2Url = document.getElementById('settingDay2Url');
    const settingAutoSync = document.getElementById('settingAutoSync');
    const btnResetAdmissions = document.getElementById('btnResetAdmissions');

    if (btnSettings) {
      btnSettings.addEventListener('click', () => {
        if (settingDay1Url) settingDay1Url.value = state.day1Url;
        if (settingDay2Url) settingDay2Url.value = state.day2Url;
        if (settingAutoSync) settingAutoSync.value = localStorage.getItem(STORAGE_KEYS.AUTO_SYNC) || '60';
        openModal('settingsModal');
      });
    }

    if (btnCloseSettings) {
      btnCloseSettings.addEventListener('click', () => closeModal('settingsModal'));
    }

    if (btnSaveSettings) {
      btnSaveSettings.addEventListener('click', () => {
        state.day1Url = (settingDay1Url && settingDay1Url.value.trim()) || DEFAULT_SHEETS.day1;
        state.day2Url = (settingDay2Url && settingDay2Url.value.trim()) || DEFAULT_SHEETS.day2;
        localStorage.setItem(STORAGE_KEYS.DAY1_URL, state.day1Url);
        localStorage.setItem(STORAGE_KEYS.DAY2_URL, state.day2Url);

        if (settingAutoSync) {
          localStorage.setItem(STORAGE_KEYS.AUTO_SYNC, settingAutoSync.value);
          setupAutoSync();
        }

        closeModal('settingsModal');
        showToast('Settings saved. Refreshing sheets...', 'success');
        syncTickets(true);
      });
    }

    if (btnRestoreDefaults) {
      btnRestoreDefaults.addEventListener('click', () => {
        if (settingDay1Url) settingDay1Url.value = DEFAULT_SHEETS.day1;
        if (settingDay2Url) settingDay2Url.value = DEFAULT_SHEETS.day2;
      });
    }

    if (btnResetAdmissions) {
      btnResetAdmissions.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all gate check-in / admitted records? This cannot be undone.')) {
          state.admissions = {};
          saveAdmissions();
          renderResults();
          updateStats();
          closeModal('settingsModal');
          showToast('Gate admissions reset successfully.', 'info');
        }
      });
    }

    // 9. Export & Import Controls
    const btnExportFiltered = document.getElementById('btnExportFiltered');
    if (btnExportFiltered) {
      btnExportFiltered.addEventListener('click', () => exportData('csv', 'filtered'));
    }

    const btnExportAllCsv = document.getElementById('btnExportAllCsv');
    if (btnExportAllCsv) {
      btnExportAllCsv.addEventListener('click', () => exportData('csv', 'all'));
    }

    const btnExportAllJson = document.getElementById('btnExportAllJson');
    if (btnExportAllJson) {
      btnExportAllJson.addEventListener('click', () => exportData('json', 'all'));
    }

    const importCsvInput = document.getElementById('importCsvInput');
    if (importCsvInput) {
      importCsvInput.addEventListener('change', handleImportCsv);
    }

    // Close modal on click outside
    window.addEventListener('click', (e) => {
      const modal = document.getElementById('settingsModal');
      if (e.target === modal) {
        closeModal('settingsModal');
      }
    });

    // 10. Start Initial Sync & Timer
    setupAutoSync();
    syncTickets(false);
  }

  // --- Expose App API for Inlined Handlers ---
  window.afcApp = {
    checkIn: handleCheckIn,
    undoCheckIn: handleUndoCheckIn,
    copyTicketDetails: handleCopyDetails,
    printPass: handlePrintPass
  };

  // Run on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
