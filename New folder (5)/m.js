const DB_NAME = 'attendance-tracker-db';
const DB_VERSION = 1;
let db;

const dom = {};

const state = {
    students: [],
    attendance: {}, // { date: { studentId: { status, note } } }
    selectedDate: '',
    selectedHistoryStudent: ''
};

const STATUS = {
    present: { label: 'Present', className: 'status-present' },
    absent: { label: 'Absent', className: 'status-absent' },
    late: { label: 'Late', className: 'status-late' }
};

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            if (!db.objectStoreNames.contains('students')) {
                db.createObjectStore('students', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('attendance')) {
                db.createObjectStore('attendance', { keyPath: 'date' });
            }
        };
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

async function init() {
    cacheDom();
    bindEvents();
    await loadState();
    setInitialDate();
    renderAll();
}

function cacheDom() {
    dom.dateInput = document.getElementById('attendanceDate');
    dom.todayBtn = document.getElementById('todayBtn');
    dom.addStudentBtn = document.getElementById('addStudentBtn');
    dom.addStudentForm = document.getElementById('addStudentForm');
    dom.studentNameInput = document.getElementById('studentNameInput');
    dom.studentIdInput = document.getElementById('studentIdInput');
    dom.saveStudentBtn = document.getElementById('saveStudentBtn');
    dom.cancelAddBtn = document.getElementById('cancelAddBtn');
    dom.studentTableBody = document.getElementById('studentTableBody');
    dom.emptyState = document.getElementById('emptyState');
    dom.filterChips = document.querySelectorAll('.chip');
    dom.markAllPresent = document.getElementById('markAllPresent');
    dom.markAllAbsent = document.getElementById('markAllAbsent');
    dom.summaryTableBody = document.getElementById('summaryTableBody');
    dom.historyList = document.getElementById('historyList');
    dom.exportBtn = document.getElementById('exportBtn');
    dom.totalStudents = document.getElementById('totalStudents');
    dom.presentCount = document.getElementById('presentCount');
    dom.attendancePct = document.getElementById('attendancePct');
    dom.daysTracked = document.getElementById('daysTracked');
    dom.historyStudentSelect = document.getElementById('historyStudentSelect');
    dom.studentHistoryDetail = document.getElementById('studentHistoryDetail');
}

function bindEvents() {
    dom.todayBtn.addEventListener('click', () => {
        dom.dateInput.value = formatDateInput(new Date());
        state.selectedDate = dom.dateInput.value;
        renderAll();
    });

    dom.dateInput.addEventListener('change', (event) => {
        state.selectedDate = event.target.value;
        renderAll();
    });

    dom.addStudentBtn.addEventListener('click', () => {
        dom.addStudentForm.classList.toggle('hidden');
        dom.studentNameInput.focus();
    });

    dom.cancelAddBtn.addEventListener('click', resetStudentForm);

    dom.saveStudentBtn.addEventListener('click', () => {
        const name = dom.studentNameInput.value.trim();
        const id = dom.studentIdInput.value.trim();
        if (!name) return;

        state.students.push({
            id: id || crypto.randomUUID(),
            displayId: id,
            name
        });

        persistState();
        resetStudentForm();
        renderAll();
    });

    dom.filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            dom.filterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            renderStudents();
        });
    });

    dom.markAllPresent.addEventListener('click', () => bulkMark('present'));
    dom.markAllAbsent.addEventListener('click', () => bulkMark('absent'));
    dom.exportBtn.addEventListener('click', exportCsv);
    dom.historyStudentSelect.addEventListener('change', (event) => {
        state.selectedHistoryStudent = event.target.value;
        renderStudentHistory();
    });
}

function resetStudentForm() {
    dom.studentNameInput.value = '';
    dom.studentIdInput.value = '';
    dom.addStudentForm.classList.add('hidden');
}

async function loadState() {
    try {
        if (!db) await initDB();
        const transaction = db.transaction(['students', 'attendance'], 'readonly');
        const studentsStore = transaction.objectStore('students');
        const attendanceStore = transaction.objectStore('attendance');
        const studentsRequest = studentsStore.getAll();
        const attendanceRequest = attendanceStore.getAll();
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => {
                state.students = studentsRequest.result || [];
                const attendance = {};
                attendanceRequest.result.forEach(item => {
                    attendance[item.date] = item.records;
                });
                state.attendance = attendance;
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.warn('Failed to load attendance data', error);
    }
}

async function persistState() {
    try {
        if (!db) await initDB();
        const transaction = db.transaction(['students', 'attendance'], 'readwrite');
        const studentsStore = transaction.objectStore('students');
        const attendanceStore = transaction.objectStore('attendance');
        // Clear existing
        studentsStore.clear();
        attendanceStore.clear();
        // Add students
        state.students.forEach(student => {
            studentsStore.add(student);
        });
        // Add attendance
        Object.keys(state.attendance).forEach(date => {
            attendanceStore.add({ date, records: state.attendance[date] });
        });
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (error) {
        console.warn('Failed to persist attendance data', error);
    }
}

function setInitialDate() {
    const today = formatDateInput(new Date());
    dom.dateInput.value = today;
    state.selectedDate = today;
}

function formatDateInput(date) {
    return date.toISOString().split('T')[0];
}

function formatHumanDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function getRecordsForDate(date) {
    if (!state.attendance[date]) {
        state.attendance[date] = {};
    }
    return state.attendance[date];
}

function setAttendance(studentId, status, note = '') {
    const records = getRecordsForDate(state.selectedDate);
    records[studentId] = { status, note };
    persistState();
    renderOverview();
    renderSummary();
    renderHistory();
    renderStudentHistory();
}

function bulkMark(status) {
    if (!state.students.length) return;
    const records = getRecordsForDate(state.selectedDate);
    state.students.forEach(student => {
        const existing = records[student.id];
        records[student.id] = {
            status,
            note: existing?.note || ''
        };
    });
    persistState();
    renderStudents();
    renderOverview();
    renderSummary();
    renderHistory();
    renderStudentHistory();
}

function renderAll() {
    renderStudents();
    renderOverview();
    renderSummary();
    renderHistory();
    renderStudentHistory();
}

function renderStudents() {
    const records = getRecordsForDate(state.selectedDate);
    const activeFilter = document.querySelector('.chip.active')?.dataset.filter || 'all';
    dom.studentTableBody.innerHTML = '';

    if (!state.students.length) {
        dom.emptyState.style.display = 'block';
        return;
    }
    dom.emptyState.style.display = 'none';

    state.students.forEach(student => {
        const record = records[student.id];
        if (activeFilter !== 'all' && record?.status !== activeFilter) return;

        const tr = document.createElement('tr');

        const nameTd = document.createElement('td');
        nameTd.innerHTML = `
            <strong>${student.name}</strong>
            ${student.displayId ? `<p class="eyebrow">ID: ${student.displayId}</p>` : ''}
        `;

        const statusTd = document.createElement('td');
        statusTd.appendChild(createStatusSelector(student.id, record?.status));

        const noteTd = document.createElement('td');
        const textarea = document.createElement('textarea');
        textarea.placeholder = 'Add note...';
        textarea.value = record?.note || '';
        textarea.addEventListener('input', () => {
            setAttendance(student.id, record?.status || 'present', textarea.value);
        });
        noteTd.appendChild(textarea);

        tr.appendChild(nameTd);
        tr.appendChild(statusTd);
        tr.appendChild(noteTd);

        dom.studentTableBody.appendChild(tr);
    });
}

function createStatusSelector(studentId, currentStatus) {
    const wrapper = document.createElement('div');
    wrapper.className = 'status-selector';

    Object.entries(STATUS).forEach(([key, meta]) => {
        const btn = document.createElement('button');
        btn.textContent = meta.label;
        btn.className = `${meta.className} ${currentStatus === key ? 'active' : ''}`;
        btn.addEventListener('click', () => {
            setAttendance(studentId, key);
            renderStudents();
        });
        wrapper.appendChild(btn);
    });

    return wrapper;
}

function renderOverview() {
    const records = getRecordsForDate(state.selectedDate);
    const total = state.students.length;
    const present = Object.values(records).filter(r => r.status === 'present').length;
    dom.totalStudents.textContent = total;
    dom.presentCount.textContent = present;
    dom.attendancePct.textContent = total ? Math.round((present / total) * 100) + '%' : '0%';
    dom.daysTracked.textContent = Object.keys(state.attendance).length;
}

function renderSummary() {
    dom.summaryTableBody.innerHTML = '';
    const dates = Object.keys(state.attendance);

    state.students.forEach(student => {
        let present = 0;
        let absent = 0;
        dates.forEach(date => {
            const record = state.attendance[date][student.id];
            if (!record) return;
            if (record.status === 'present') present++;
            if (record.status === 'absent') absent++;
        });

        const total = present + absent;
        const pct = total ? Math.round((present / total) * 100) : 0;
        const badgeClass = pct >= 75 ? 'badge-green' : pct >= 50 ? 'badge-yellow' : 'badge-red';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong>${student.name}</strong>
                ${student.displayId ? `<p class="eyebrow">ID: ${student.displayId}</p>` : ''}
            </td>
            <td>${present}</td>
            <td>${absent}</td>
            <td><span class="badge ${badgeClass}">${pct}%</span></td>
        `;
        dom.summaryTableBody.appendChild(tr);
    });
}

function renderHistory() {
    dom.historyList.innerHTML = '';
    const dates = Object.keys(state.attendance).sort((a, b) => b.localeCompare(a));

    dates.slice(0, 10).forEach(date => {
        const records = state.attendance[date];
        const total = Object.keys(records).length;
        const present = Object.values(records).filter(r => r.status === 'present').length;
        const pct = total ? Math.round((present / total) * 100) : 0;
        const badgeClass = pct >= 75 ? 'badge-green' : pct >= 50 ? 'badge-yellow' : 'badge-red';

        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
            <h4>${formatHumanDate(date)}</h4>
            <p>${present}/${total} present • <span class="badge badge-small ${badgeClass}">${pct}%</span></p>
        `;
        dom.historyList.appendChild(item);
    });
}

function renderStudentHistory() {
    const select = dom.historyStudentSelect;
    const detail = dom.studentHistoryDetail;
    select.innerHTML = '';

    if (!state.students.length) {
        select.disabled = true;
        detail.innerHTML = '<p class="empty-state">Add students to view history.</p>';
        return;
    }

    select.disabled = false;
    state.students.forEach(student => {
        const option = document.createElement('option');
        option.value = student.id;
        option.textContent = student.name + (student.displayId ? ` (${student.displayId})` : '');
        select.appendChild(option);
    });

    if (!state.selectedHistoryStudent || !state.students.find(s => s.id === state.selectedHistoryStudent)) {
        state.selectedHistoryStudent = state.students[0].id;
    }
    select.value = state.selectedHistoryStudent;

    const entries = [];
    Object.entries(state.attendance).forEach(([date, records]) => {
        const record = records[state.selectedHistoryStudent];
        if (record) entries.push({ date, ...record });
    });
    entries.sort((a, b) => b.date.localeCompare(a.date));

    if (!entries.length) {
        detail.innerHTML = '<p class="empty-state">No attendance recorded yet for this student.</p>';
        return;
    }

    detail.innerHTML = '';
    entries.forEach(entry => {
        const badgeClass = entry.status === 'present'
            ? 'badge-green'
            : entry.status === 'late'
            ? 'badge-yellow'
            : 'badge-red';

        const wrapper = document.createElement('div');
        wrapper.className = 'history-entry';
        wrapper.innerHTML = `
            <div>
                <strong>${formatHumanDate(entry.date)}</strong>
                ${entry.note ? `<p class="eyebrow">${entry.note}</p>` : ''}
            </div>
            <span class="badge ${badgeClass}">${STATUS[entry.status]?.label || entry.status}</span>
        `;
        detail.appendChild(wrapper);
    });
}

function exportCsv() {
    const rows = [['Date', 'Student', 'Status', 'Note']];
    Object.entries(state.attendance).forEach(([date, records]) => {
        state.students.forEach(student => {
            const record = records[student.id];
            rows.push([
                date,
                student.name,
                record?.status || 'not-recorded',
                record?.note ? record.note.replace(/"/g, '""') : ''
            ]);
        });
    });

    const csv = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'attendance.csv';
    link.click();
    URL.revokeObjectURL(url);
}

window.addEventListener('DOMContentLoaded', init);