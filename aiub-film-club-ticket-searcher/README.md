# 🎬 AIUB Film Club - Ticket Searcher & Gate Admission Portal

A lightweight, fully portable HTML5 ticket search and gate verification application for the **AIUB Film Club (AFC)** movie screening events.

Designed to run on **any PC without installation or server setup**—simply copy the folder to any PC, laptop, or USB flash drive and double-click to start!

---

## 🚀 How to Run

1. **Option A (Recommended):** Double-click **`run.bat`**
2. **Option B:** Double-click **`index.html`** (opens in Chrome, Edge, Firefox, Brave, etc.)

> **Portability Note:** No Node.js, Python, or local server installation required. All code, styles, and offline fallbacks are completely self-contained in this folder.

---

## 🔍 Search Capabilities

You can search tickets in real-time by entering any of the following into the search bar:
* **Student ID:** Search with or without dashes (e.g. `24-57614-2`, `24576142`, or `24 57614 2`).
* **Student Name:** Search by full or partial name (e.g. `Sazin`, `Tuhin`, `Fahima`, `Ishmam`).
* **Ticket Number:** Search full or partial ticket number (e.g. `Day-1-AFC-002`, `AFC-002`, or `002`).
* **Transaction ID (TrxID):** Search by bKash/Nagad TrxID (e.g. `DJA3P14W15`, `DJB8Q7331S`).
* **Phone Number:** Search by sender or student contact number.
* **Email:** Search by registered email address.

---

## ⚡ Key Features

1. **Live Google Sheets Integration:**
   * Fetches real-time ticket registrations directly from Google Sheets using JSONP (bypasses browser CORS limitations without needing a proxy server).
   * Automatically extracts and normalizes headers for both Day 1 and Day 2 sheets.
2. **100% Offline Resilience:**
   * Automatically caches synced tickets into local storage.
   * If internet drops or Wi-Fi is unavailable at the auditorium booth, searches continue uninterrupted.
   * Preloaded snapshot included out-of-the-box in `sample-data.js`.
3. **Gate Admission & Re-entry Prevention:**
   * Click **"🎟️ Admit at Gate / Check-In"** to verify a ticket.
   * Logs entry timestamp and tags the ticket with an **ADMITTED** stamp.
   * If a student tries to enter twice with the same ticket, the system alerts the gate volunteer.
   * Synthesized audio confirmation chime upon successful admission.
4. **Printable Gate Slip:**
   * Click **"🖨️ Print Slip"** to print a gate pass slip formatted for receipt or standard printers.
5. **View Options:**
   * **🎫 Cards View:** Cinema-ticket style cards with perforation, badges, and full details.
   * **📋 Table View:** Compact spreadsheet grid for rapid scanning of all attendees.
6. **Data Export & Import:**
   * Export all tickets or filtered search results to **CSV** or **JSON**.
   * Import CSV files locally if offline.
7. **Custom Sheet Links:**
   * Click the **⚙️ Settings** icon in the header to view or update Google Sheets URLs anytime.

---

## 📁 File Structure

```
aiub-film-club-ticket-searcher/
├── index.html        # Main application page
├── style.css         # Cinema dark/light UI styling
├── app.js            # Search engine, Google Sheets sync & gate check-in logic
├── sample-data.js    # Preloaded offline snapshot of active tickets
├── run.bat           # 1-click Windows launcher
└── README.md         # Documentation & guide
```

---

## 📋 Default Google Sheets Connected

* **Day 1 Sheet:** `https://docs.google.com/spreadsheets/d/1QrkfLwS3J8bKVyySSwsjx4Vgj8gu-XyfKQMwK-gvLTM/edit?usp=sharing`
* **Day 2 Sheet:** `https://docs.google.com/spreadsheets/d/1sGI0hkBuy80hOfdbML92ZpsSUHaQIRpiArSw6zVAzUw/edit?usp=sharing`

---

*Made for the AIUB Film Club Event Organizing Team.*
