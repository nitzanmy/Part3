let currentWeekOffset = 0;
let fetchedClasses = [];
let currentManagingClassId = null;
let maxClassDate = null; // התאריך המאוחר ביותר שיש בו שיעור

const role = sessionStorage.getItem('userRole');
const isAdmin = (role === 'admin');

function checkUrlForDate() {
    const urlParams = new URLSearchParams(window.location.search);
    const dateParam = urlParams.get('date');

    if (dateParam) {
        const targetDate = new Date(dateParam);
        const today      = new Date();

        targetDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        const targetSunday = new Date(targetDate);
        targetSunday.setDate(targetDate.getDate() - targetDate.getDay()); // 0=ראשון

        const currentSunday = new Date(today);
        currentSunday.setDate(today.getDate() - today.getDay());

        const diffTime  = targetSunday - currentSunday;
        const diffWeeks = Math.round(diffTime / (1000 * 60 * 60 * 24 * 7));

        currentWeekOffset = diffWeeks;
    }
}

checkUrlForDate();

document.addEventListener('DOMContentLoaded', function () {
    loadMaxClassDate().then(() => {
        loadData();
    });

    const addBtn = document.getElementById('btn-add-class-mode');
    if (addBtn) addBtn.onclick = () => openModal();

    const startTimeInput = document.getElementById('startTime');
    const endTimeInput = document.getElementById('endTime');
    if (startTimeInput && endTimeInput) {
        startTimeInput.addEventListener('change', function () {
            if (!this.value) return;
            const [hours, minutes] = this.value.split(':').map(Number);
            let endHours = (hours + 1) % 24;
            const formattedEnd = `${String(endHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            endTimeInput.value = formattedEnd;
        });
    }
});

function formatDateForInput(dateData) {
    if (!dateData) return new Date().toISOString().split('T')[0];
    if (typeof dateData === 'string' && dateData.length === 10 && !dateData.includes('T')) return dateData;
    const d = new Date(dateData);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// טוען את התאריך המאוחר ביותר שיש עבורו שיעור
async function loadMaxClassDate() {
    try {
        const res = await fetch('/api/max-class-date');
        const data = await res.json();
        if (data.maxDate) {
            maxClassDate = data.maxDate; // "YYYY-MM-DD"
        } else {
            maxClassDate = null;
        }
    } catch (e) {
        maxClassDate = null;
    }
}

function loadData() {
    const uId = sessionStorage.getItem('userId') || 0;
    Promise.all([
        fetch(`/classes?userId=${uId}`).then(res => res.json()),
        fetch('/messages').then(res => res.json())
    ]).then(([classesData, messagesData]) => {
        fetchedClasses = classesData;
        renderSchedule(fetchedClasses, messagesData);

        if (isAdmin && currentManagingClassId) {
            loadManagerData(currentManagingClassId);
        }
    }).catch(err => console.error("Error loading data:", err));
}

function renderSchedule(classes, notices) {
    const noticesContainer = document.getElementById('notices-container');
    if (noticesContainer) {
        noticesContainer.innerHTML = '';
        if (isAdmin) {
            noticesContainer.innerHTML += `
                <div class="admin-notice-controls mb-3">
                    <input type="text" id="newNoticeInput" placeholder="הודעה חדשה..." class="form-control d-inline-block w-75">
                    <button class="btn btn-primary btn-sm" onclick="addNewNotice()">פרסם</button>
                </div>`;
        }
        notices.forEach(notice => {
            let html = `<span>${notice.content}</span>`;
            if (isAdmin) html += `<button class="btn btn-sm btn-danger ms-2" onclick="deleteMessage(${notice.id})">X</button>`;
            const div = document.createElement('div');
            div.className = 'notice-item alert alert-info d-flex justify-content-between align-items-center';
            div.innerHTML = html;
            noticesContainer.appendChild(div);
        });
    }

    const addClassBtn = document.getElementById('btn-add-class-mode');
    if (addClassBtn) addClassBtn.style.display = isAdmin ? 'block' : 'none';

    // כפתור אדמין: יצירת שיעורים לשבוע שמוצג כרגע
    const genNextWeekBtn = document.getElementById('btn-generate-next-week');
    if (genNextWeekBtn) {
        genNextWeekBtn.style.display = isAdmin ? 'block' : 'none';
        genNextWeekBtn.onclick = () => {
            showConfirm(
                'האם ליצור מערכת שעות לשבוע המוצג כעת?',
                function onConfirm() {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const baseDate = new Date(today);
                    baseDate.setDate(today.getDate() + (currentWeekOffset * 7));
                    const dayIndex = baseDate.getDay(); 
                    const startOfWeek = new Date(baseDate);
                    startOfWeek.setDate(baseDate.getDate() - dayIndex);
                    
                    const y = startOfWeek.getFullYear();
                    const m = String(startOfWeek.getMonth() + 1).padStart(2, '0');
                    const d = String(startOfWeek.getDate()).padStart(2, '0');
                    const formattedStartDate = `${y}-${m}-${d}`;

                    fetch('/admin/generate-week-range', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            startDate: formattedStartDate 
                        })
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            loadMaxClassDate().then(() => loadData());
                        } else {
                            showMessage(data.message || 'שגיאה ביצירת מערכת השעות לשבוע זה');
                        }
                    })
                    .catch(() => {
                        showMessage('שגיאה ביצירת מערכת השעות לשבוע זה');
                    });
                }
            );
        };
    }

    setWeeklyDates();
    updateNextWeekButtonVisibility(); // עדכון כפתור שבוע הבא לפי maxClassDate

    for (let i = 0; i <= 5; i++) {
        const el = document.getElementById(`day-content-${i}`);
        if (el) {
            el.innerHTML = '';
        }
    }

    const loggedUserId = sessionStorage.getItem('userId');
    const membershipType = localStorage.getItem('userMembershipType') || 'guest';
    const canSeeZoomLink =
        membershipType === 'gym_1perweek' ||
        membershipType === 'gym_2perweek' ||
        membershipType === 'zoom';

    for (let i = 0; i <= 5; i++) {
        const dayContainer = document.getElementById(`day-content-${i}`);
        if (!dayContainer) continue;

        const columnDayName = dayContainer.getAttribute('data-dayname');
        
        const today = new Date();
        today.setHours(0,0,0,0);
        const base = new Date(today);
        base.setDate(today.getDate() + (currentWeekOffset * 7));
        const dayIndexView = base.getDay(); 
        const startOfWeekView = new Date(base);
        startOfWeekView.setDate(base.getDate() - dayIndexView);
        
        const endOfWeekView = new Date(startOfWeekView);
        endOfWeekView.setDate(startOfWeekView.getDate() + 6);
        endOfWeekView.setHours(23, 59, 59, 999);

        const relevantClasses = classes
            .filter(c => {
                const cDate = new Date(c.class_date);
                return (
                    c.day_of_week === columnDayName &&
                    cDate >= startOfWeekView &&
                    cDate <= endOfWeekView
                );
            })
            .sort((a, b) => a.start_time.localeCompare(b.start_time));

        relevantClasses.forEach(cls => {
            const isZoom = !!cls.zoom;
            const userStatus = cls.user_status;
            const currentCount = cls.current_participants || 0;
            const maxCount = cls.max_participants;
            const isFull = currentCount >= maxCount;

            let actionHtml = '';

            if (isAdmin) {
                actionHtml = `
                    <div class="admin-actions">
                        <button class="btn-admin-edit" onclick="event.stopPropagation(); openModal(${cls.id})">עריכה</button>
                        <button class="btn-admin-delete" onclick="event.stopPropagation(); deleteClass(${cls.id})">מחיקה</button>
                    </div>`;
            } else {
                if (!loggedUserId) {
                    actionHtml = '';
                } else {
                    if (userStatus === 'registered') {
                        actionHtml = `<button class="register-btn registered" onclick="cancelRegistration(${cls.id})">רשום ✓ (ביטול)</button>`;
                    } else if (userStatus === 'waitlist') {
                        actionHtml = `
                            <div class="waitlist-info">את/ה במקום ה ${cls.waitlist_position} ברשימת המתנה </div>
                            <button class="register-btn-waitlist" onclick="cancelRegistration(${cls.id})">ביטול המתנה</button>
                        `;
                    } else {
                        if (!isZoom && isFull) {
                            actionHtml = `<button class="register-btn-waitlist" onclick="registerForClass(${cls.id}, true)">הרשמה להמתנה</button>`;
                        } else {
                            actionHtml = `<button class="register-btn" onclick="registerForClass(${cls.id}, false)">הרשמה לשיעור</button>`;
                        }
                    }
                }
            }

            let zoomHtml = '';
            if (isZoom && loggedUserId && (canSeeZoomLink || isAdmin)) {
                zoomHtml = `
                    <a href="https://us02web.zoom.us/j/3430100607"
                       target="_blank"
                       class="zoom-tag"
                       onclick="event.stopPropagation()">
                       ZOOM
                    </a>`;
            }

            const countDisplay = `
                <span class="participants-tooltip-container" onmouseenter="showParticipants(this, ${cls.id})">
                    <i class="fas fa-users"></i> ${currentCount}/${maxCount}
                    <div class="participants-tooltip">טוען...</div>
                </span>
            `;

            const card = document.createElement('div');
            card.className = 'class-card';

            if (isAdmin) {
                card.classList.add('admin-hover');
                card.style.cursor = 'pointer';
                card.onclick = () => openClassManager(cls.id);
                card.setAttribute('title', 'לחצי לפתיחת ניהול משתתפים');
            }

            const timeRange = `${cls.start_time.substring(0, 5)} - ${cls.end_time.substring(0, 5)}`;

            card.innerHTML = `
                <div class="class-time fw-bold" style="direction:ltr;">${timeRange}</div>
                <div class="class-name">${cls.class_name}</div>
                <div class="class-instructor small text-muted">${cls.instructor}</div>
                <div class="class-details mt-1 d-flex justify-content-between align-items-center">
                    ${countDisplay}
                    ${zoomHtml}
                </div>
                <div class="class-admin-actions-row">
                    ${actionHtml}
                </div>
            `;
            dayContainer.appendChild(card);
        });
    }
}

// ===================== Admin manager =====================

function openClassManager(classId) {
    if (!isAdmin) return;

    currentManagingClassId = classId;
    const cls = fetchedClasses.find(c => c.id === classId);

    let israeliDate = cls.class_date;
    let realDayName = "";

    if (cls.class_date && cls.class_date.includes('-')) {
        const parts = cls.class_date.split('-');
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        const day = parseInt(parts[2]);

        israeliDate = `${parts[2]}-${parts[1]}-${parts[0]}`;

        const dateObj = new Date(year, month, day);
        const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        realDayName = days[dateObj.getDay()];
    } else {
        realDayName = cls.day_of_week;
    }

    document.getElementById('manager-class-name').innerText = cls.class_name;
    document.getElementById('manager-class-time').innerText =
        `יום ${realDayName} | ${israeliDate} | ${cls.start_time.substring(0, 5)}`;

    const managerDiv = document.getElementById('admin-class-manager');
    managerDiv.style.display = 'block';
    managerDiv.scrollIntoView({ behavior: 'smooth' });

    fetch('/all-users')
        .then(res => res.json())
        .then(users => {
            const select = document.getElementById('all-users-select');
            select.innerHTML = '<option value="">-- בחרי מתעמלת להוספה --</option>';
            users.forEach(u => {
                const option = document.createElement('option');
                option.value = u.email;
                option.innerText = `${u.first_name} ${u.last_name} (${u.email})`;
                select.appendChild(option);
            });
        });

    loadManagerData(classId);
}

function loadManagerData(classId) {
    fetch(`/class-participants/${classId}`)
        .then(res => res.json())
        .then(participants => {
            const regList = document.getElementById('list-registered');
            const waitList = document.getElementById('list-waitlist');
            regList.innerHTML = '';
            waitList.innerHTML = '';

            let regCount = 0;
            let waitCount = 0;

            participants.forEach(p => {
                const li = document.createElement('li');
                li.className = 'list-group-item';

                const deleteBtn = `<button class="btn-remove-user" onclick="adminRemoveUser('${p.email}', ${classId})" title="הסר מהשיעור">X</button>`;

                li.innerHTML = `
                    <span>${p.first_name} ${p.last_name}</span>
                    ${deleteBtn}
                `;

                if (p.status === 'registered') {
                    regList.appendChild(li);
                    regCount++;
                } else {
                    waitList.appendChild(li);
                    waitCount++;
                }
            });

            document.getElementById('count-registered').innerText = regCount;
            document.getElementById('count-waitlist').innerText = waitCount;
        });
}

function adminRemoveUser(userEmail, classId) {
    showConfirm('האם להסיר את המתעמלת מהשיעור?', function () {
        fetch('/cancel-registration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userEmail, classId: classId })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    loadData();
                } else {
                    showMessage('שגיאה במחיקה');
                }
            });
    });
}

function adminAddUserToClass() {
    const select = document.getElementById('all-users-select');
    const userEmail = select.value;

    if (!userEmail) {
        showMessage('יש לבחור מתעמלת מהרשימה');
        return;
    }
    if (!currentManagingClassId) return;

    fetch('/admin-add-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userEmail, classId: currentManagingClassId })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showMessage('הוספה בוצעה בהצלחה');
                loadData();
                select.value = "";
            } else {
                showMessage(data.message);
            }
        });
}

// ===================== לוגיקת משתמש רגיל =====================

function registerForClass(classId, isWaitlist) {
    const uId = sessionStorage.getItem('userId');
    if (!uId) {
        showConfirm('יש להתחבר כדי להירשם. לעבור להתחברות?', function () {
            window.location.href = 'login.html';
        });
        return;
    }

    const classItem = fetchedClasses.find(c => c.id === classId);
    if (!classItem) return;

    const membershipType = localStorage.getItem('userMembershipType') || 'guest';
    const isZoomClass = !!classItem.zoom;

    if (membershipType === 'zoom') {
        if (isZoomClass) {
            showMessage("מנוי זום לא צריך להירשם לשיעור.\nתיכנס לשיעור 5 דקות לפני שהשיעור מתחיל");
        } else {
            showMessage('המנוי שלך הוא לזום בלבד.');
        }
        return;
    }

    let weeklyLimit = Infinity;
    if (membershipType === 'gym_1perweek') weeklyLimit = 1;
    if (membershipType === 'gym_2perweek') weeklyLimit = 2;

    if (weeklyLimit !== Infinity) {
        const targetDate = new Date(classItem.class_date);
        const dayOfTarget = targetDate.getDay();
        const startOfWeek = new Date(targetDate);
        startOfWeek.setDate(targetDate.getDate() - dayOfTarget);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);

        let registeredCount = 0;
        fetchedClasses.forEach(c => {
            if (c.user_status === 'registered') {
                const cDate = new Date(c.class_date);
                if (cDate >= startOfWeek && cDate <= endOfWeek) {
                    registeredCount++;
                }
            }
        });

        if (registeredCount >= weeklyLimit) {
            showMessage(`הגעת למכסת השיעורים השבועית שלך (${weeklyLimit} בשבוע).\nלא ניתן להירשם לשיעור נוסף השבוע.`);
            return;
        }
    }

    fetch('/register-class', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uId, classId: classId })
    })
        .then(res => res.json())
        .then(data => {
            showMessage(data.message);
            if (data.success) {
                loadData();
            }
        });
}

function cancelRegistration(classId) {
    const uId = sessionStorage.getItem('userId');
    showConfirm('לבטל את הרישום?', function () {
        fetch('/cancel-registration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: uId, classId: classId })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    loadData();
                } else {
                    showMessage('שגיאה בביטול');
                }
            });
    });
}

function showParticipants(element, classId) {
    const tooltip = element.querySelector('.participants-tooltip');
    if (tooltip.dataset.loaded === "true") return;

    fetch(`/class-participants/${classId}`)
        .then(res => res.json())
        .then(users => {
            const registeredOnly = users.filter(u => u.status === 'registered');

            if (registeredOnly.length === 0) {
                tooltip.innerHTML = "אין רשומים עדיין";
            } else {
                const names = registeredOnly.map(u => `<div>${u.first_name} ${u.last_name}</div>`).join('');
                tooltip.innerHTML = names;
            }
            tooltip.dataset.loaded = "true";
        })
        .catch(() => {
            tooltip.innerHTML = "שגיאה בטעינה";
        });
}

// ========= חישוב שבוע וציון שם היום לכל עמודה =========

function setWeeklyDates() {
    const today = new Date();
    today.setHours(0,0,0,0);

    const currentViewDate = new Date(today);
    currentViewDate.setDate(today.getDate() + (currentWeekOffset * 7));

    const dayIndex = currentViewDate.getDay(); // 0..6
    const startOfWeek = new Date(currentViewDate);
    startOfWeek.setDate(currentViewDate.getDate() - dayIndex); // לזוז אחורה ליום ראשון

    const daysNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

    for (let i = 0; i < 6; i++) {
        let loopDate = new Date(startOfWeek);
        loopDate.setDate(startOfWeek.getDate() + i);
        let dateStringDisplay = loopDate.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
        let element = document.getElementById(`date-${i}`);
        if (element) element.textContent = dateStringDisplay;
        const formattedDate = formatDateForInput(loopDate);
        const dayContent = document.getElementById(`day-content-${i}`);
        if (dayContent) {
            dayContent.setAttribute('data-date', formattedDate);
            dayContent.setAttribute('data-dayname', daysNames[i]); // שם יום לעמודה
        }
    }
}

// חסימת דפדוף קדימה לפי האם יש שיעורים מוגדרים קדימה
function changeWeek(direction) {
    if (!isAdmin && direction > 0 && maxClassDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const targetViewDate = new Date(today);
        targetViewDate.setDate(today.getDate() + ((currentWeekOffset + direction) * 7));

        const targetStr = formatDateForInput(targetViewDate);
        if (targetStr > maxClassDate) {
            return;
        }
    }

    currentWeekOffset += direction;
    loadData();
}

// כפתור "שבוע נוכחי"
function goToCurrentWeek() {
    currentWeekOffset = 0;
    loadData();
}

// עדכון האם להראות את כפתור "שבוע הבא" למשתמש רגיל
function updateNextWeekButtonVisibility() {
    const nextBtn = document.getElementById('btn-next-week');
    if (!nextBtn) return;

    // אדמין תמיד רואה את הכפתור
    if (isAdmin) {
        nextBtn.style.display = 'inline-block';
        return;
    }

    // אם אין בכלל שיעורים – אין כפתור
    if (!maxClassDate) {
        nextBtn.style.display = 'none';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // חישוב תחילת וסוף השבוע שמוצג כרגע
    const currentViewDate = new Date(today);
    currentViewDate.setDate(today.getDate() + (currentWeekOffset * 7));

    const dayIndex = currentViewDate.getDay(); // 0=ראשון
    const startOfWeek = new Date(currentViewDate);
    startOfWeek.setDate(currentViewDate.getDate() - dayIndex);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const endOfWeekStr = formatDateForInput(endOfWeek);

    // אם השיעור האחרון (maxClassDate) נמצא בתוך השבוע הזה או לפניו – אין יותר שבועות עם שיעורים => להסתיר
    if (endOfWeekStr >= maxClassDate) {
        nextBtn.style.display = 'none';
    } else {
        nextBtn.style.display = 'inline-block';
    }
}

// ===== openModal עם עדכון יום לפי תאריך =====

function openModal(classId = null) {
    const modalElement = document.getElementById('classModal');
    const modalTitle = document.getElementById('modalTitle');
    const dateInput  = document.getElementById('classDate');
    const daySelect  = document.getElementById('classDay');
    document.getElementById('formClass').reset();

    if (classId) {
        modalTitle.innerText = "עריכת שיעור";
        const cls = fetchedClasses.find(c => c.id === classId);
        document.getElementById('classId').value = cls.id;
        document.getElementById('className').value = cls.class_name;
        dateInput.value = formatDateForInput(cls.class_date);
        daySelect.value = cls.day_of_week;
        document.getElementById('startTime').value = cls.start_time.substring(0, 5);
        document.getElementById('endTime').value = cls.end_time.substring(0, 5);
        document.getElementById('maxParticipants').value = cls.max_participants;
        document.getElementById('isZoom').checked = cls.zoom;
    } else {
        modalTitle.innerText = "הוספת שיעור חדש";
        document.getElementById('classId').value = "";

        const today = new Date();
        dateInput.value = formatDateForInput(today);

        const daysNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        const todayName = daysNames[today.getDay()];
        daySelect.value = todayName;

        document.getElementById('maxParticipants').value = 8;
    }

    const daysNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    dateInput.onchange = function () {
        if (!this.value) return;
        const d = new Date(this.value);
        const dayName = daysNames[d.getDay()];
        daySelect.value = dayName;
    };

    const modal = new bootstrap.Modal(modalElement);
    modal.show();
}

function submitClassForm() {
    const classId = document.getElementById('classId').value;
    const classData = {
        id: classId,
        className: document.getElementById('className').value,
        classDate: document.getElementById('classDate').value,
        dayOfWeek: document.getElementById('classDay').value,
        startTime: document.getElementById('startTime').value,
        endTime: document.getElementById('endTime').value,
        maxParticipants: document.getElementById('maxParticipants').value,
        instructor: 'מיכל',
        zoom: document.getElementById('isZoom').checked
    };
    const url = classId ? '/update-class' : '/add-class';
    const method = classId ? 'PUT' : 'POST';
    fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(classData)
    })
        .then(res => res.json()).then(data => {
            if (data.success) {
                const modalEl = document.getElementById('classModal');
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();
                loadData();
            } else {
                showMessage('שגיאה');
            }
        });
}

function deleteClass(id) {
    showConfirm('למחוק?', function () {
        fetch(`/delete-class/${id}`, { method: 'DELETE' }).then(res => res.json()).then(data => {
            if (data.success) loadData(); else showMessage('שגיאה');
        });
    });
}

function addNewNotice() {
    const content = document.getElementById('newNoticeInput').value;
    if (!content) return;
    fetch('/add-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    }).then(() => {
        document.getElementById('newNoticeInput').value = '';
        loadData();
    });
}

function deleteMessage(id) {
    showConfirm('למחוק?', function () {
        fetch(`/delete-message/${id}`, { method: 'DELETE' }).then(() => loadData());
    });
}
