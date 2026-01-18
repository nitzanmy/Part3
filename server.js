

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

const app = express();
const port = 3000;
const db = require('./db');


app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());


const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

  //  מושכת את כל השיעורים מהפריסט של השעות וימים הקבועים של השיעורים
function generateClassesForWeek(startDateStr, callback) {
  const sqlTemplates = 'SELECT * FROM classes_templates';

  db.query(sqlTemplates, (err, templates) => {
    if (err) return callback(err);
    // המרת תאריך התחלה לפורמט של תאריך
    const inserts = [];
    const [year, month, day] = startDateStr.split('-').map(Number);
    const current = new Date(year, month - 1, day);
    for (let i = 0; i < 7; i++) {
      const jsDay = current.getDay();
      const hebDay = dayNames[jsDay];
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const d = String(current.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;

      // סינון תבניות שמתאימות ליום בעברית והכנת פריסט להכנסה
      if (hebDay) {
        templates
          .filter(t => t.day_of_week === hebDay)
          .forEach(t => {
            inserts.push([
              t.default_name,
              dateStr,
              hebDay,
              t.start_time,
              t.end_time,
              'מיכל',  // מדריכה קבועה
              t.default_zoom,
              t.default_max_participants
            ]);
          });
      }
      current.setDate(current.getDate() + 1);
    }

    if (!inserts.length) return callback(null);

    // הכנסת כל השיעורים בשבוע בבת אחת  
    const insertSql = `
      INSERT INTO classes
      (class_name, class_date, day_of_week, start_time, end_time,
       instructor, zoom, max_participants)
      VALUES ?
      ON DUPLICATE KEY UPDATE id = id
    `;

    db.query(insertSql, [inserts], (err2) => {
      if (err2) return callback(err2);
      callback(null);
    });
  });
}

  // חישוב תאריך ראשון בשבוע הבא
function generateNextWeekClasses(callback) {
  const today = new Date();
  const day = today.getDay();
  const diffToNextSunday = (7 - day) % 7 || 7;
  const start = new Date(today);
  start.setDate(today.getDate() + diffToNextSunday);
  start.setHours(0, 0, 0, 0);

  const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  generateClassesForWeek(startStr, callback);
}

// ניהול משתמשים 

app.post('/registration', (req, res) => {
  const { email, password, firstName, lastName, phone, birthdate, city, trainingHabits, membershipType, comments, role } = req.body;
  const query = `INSERT INTO users (email, password, first_name, last_name, phone, birthdate, city, training_habit, membership_type, comments, role) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.query(
    query,
    [email, password, firstName, lastName, phone, birthdate, city, trainingHabits, membershipType, comments, role || 'client'],
    (err) => {
      if (err) {
        console.error(err);
        res.status(500).send('אירעה שגיאה במהלך ההרשמה');
      } else {
        res.status(200).send('ההרשמה בוצעה בהצלחה');
      }
    }
  );
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const query = 'SELECT * FROM users WHERE email = ? AND password = ?';

  db.query(query, [email, password], (err, results) => {
    if (err) {
      res.status(500).json({ success: false, message: 'אירעה שגיאה בעת ההתחברות' });
    } else if (results.length > 0) {
      const user = results[0];
      // Cookie עם כתובת מייל (תוקף של שעה אחת)
      res.cookie('userSession', user.email, { maxAge: 3600000, httpOnly: true });
      res.json({
        success: true,
        message: 'התחברת בהצלחה',
        user: {
          id: user.email,
          firstName: user.first_name,
          role: user.role,
          membershipType: user.membership_type
        }
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'שם משתמש או סיסמה שגויים'
      });
    }
  });
});

app.get('/logout', (req, res) => {
  res.clearCookie('userSession');
  res.json({ success: true, message: 'התנתקת מהמערכת' });
});

app.get('/api/check-session', (req, res) => {
  // בדיקת מצב התחברות דרך cookie
  const email = req.cookies.userSession;
  if (!email) {
    return res.json({ isLoggedIn: false });
  }
  const query = 'SELECT first_name, email, role, membership_type FROM users WHERE email = ?';
  db.query(query, [email], (err, results) => {
    if (results && results.length > 0) {
      const user = results[0];
      res.json({
        isLoggedIn: true,
        user: {
          id: user.email,
          firstName: user.first_name,
          role: user.role,
          membershipType: user.membership_type
        }
      });
    } else {
      res.json({ isLoggedIn: false });
    }
  });
});

// מחזיר פרטי משתמש מלאים (לעמוד הפרופיל)
app.get('/api/user-info', (req, res) => {
  const userId = req.query.userId;
  const query = 'SELECT first_name, last_name, email, phone, city, birthdate, membership_type FROM users WHERE email = ?';
  db.query(query, [userId], (err, results) => {
    if (err || results.length === 0) {
      res.status(500).json({ error: 'המשתמש לא נמצא' });
    } else {
      res.json(results[0]);
    }
  });
});

// מעדכן פרטי משתמש (שם, טלפון, וכו')
app.put('/api/update-user', (req, res) => {
  const { email, firstName, lastName, phone, city, birthdate } = req.body;
  const query = `UPDATE users SET first_name=?, last_name=?, phone=?, city=?, birthdate=? WHERE email=?`;
  db.query(query, [firstName, lastName, phone, city, birthdate, email], (err) => {
    if (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'אירעה שגיאה בעדכון הפרטים' });
    } else {
      res.json({ success: true, message: 'הפרטים עודכנו בהצלחה' });
    }
  });
});

  // רשימת כל המשתמשים
app.get('/all-users', (req, res) => {
  const query = 'SELECT first_name, last_name, email, phone FROM users ORDER BY first_name ASC';
  db.query(query, (err, results) => {
    if (err) res.status(500).send('אירעה שגיאה בטעינת המשתמשים');
    else res.json(results);
  });
});


//  ניהול שיעורים

 // שיעורים עתידיים של משתמש ספציפי (עד 3 הקרובים ביותר)
app.get('/api/my-classes', (req, res) => {
  const userId = req.query.userId;
  const query = `
    SELECT c.id, c.class_name, c.class_date, c.start_time, c.end_time, c.zoom, r.status
    FROM classes c
    JOIN registrations r ON c.id = r.class_id
    WHERE r.user_id = ?
      AND TIMESTAMP(c.class_date, c.end_time) >= NOW()
    ORDER BY c.class_date ASC, c.start_time ASC
    LIMIT 3
  `;
  db.query(query, [userId], (err, results) => {
    if (err) res.status(500).send('אירעה שגיאה בטעינת השיעורים');
    else res.json(results);
  });
});

  // הוספת שיעור חדש ידנית
app.post('/add-class', (req, res) => {
  const { className, classDate, dayOfWeek, startTime, endTime, instructor, zoom, maxParticipants } = req.body;
  const query = `
    INSERT INTO classes
      (class_name, class_date, day_of_week, start_time, end_time, instructor, zoom, max_participants)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.query(
    query,
    [className, classDate, dayOfWeek, startTime, endTime, instructor, zoom, maxParticipants],
    (err) => {
      if (err) res.status(500).json({ success: false, message: 'אירעה שגיאה בהוספת השיעור' });
      else res.json({ success: true, message: 'השיעור נוסף בהצלחה' });
    }
  );
});

 // עריכת פרטי שיעור קיים
app.put('/update-class', (req, res) => {
  const { id, className, classDate, dayOfWeek, startTime, endTime, instructor, zoom, maxParticipants } = req.body;
  const query = `
    UPDATE classes
    SET class_name=?, class_date=?, day_of_week=?, start_time=?, end_time=?, instructor=?, zoom=?, max_participants=?
    WHERE id=?
  `;
  db.query(
    query,
    [className, classDate, dayOfWeek, startTime, endTime, instructor, zoom, maxParticipants, id],
    (err) => {
      if (err) res.status(500).json({ success: false, message: 'אירעה שגיאה בעדכון השיעור' });
      else res.json({ success: true, message: 'השיעור עודכן בהצלחה' });
    }
  );
});



app.get('/classes', (req, res) => {
  const userId = req.query.userId || 0; // מי המשתמש (0 = הצג לכולם)
  //  כל פרטי השיעור + מצב המשתמש (רשום/בהמתנה/לא רשום)
  const query = `
    SELECT c.*, r.status AS user_status, 
           (SELECT COUNT(*) + 1
               FROM registrations r2
              WHERE r2.class_id = c.id
                AND r2.status = 'waitlist'
                AND r2.id < r.id) AS waitlist_position,
           (SELECT COUNT(*)
               FROM registrations r3
              WHERE r3.class_id = c.id
                AND r3.status = 'waitlist') AS waitlist_count 
    FROM classes c
    LEFT JOIN registrations r
            ON c.id = r.class_id AND r.user_id = ?
    ORDER BY c.class_date ASC, c.start_time ASC
  `;
  db.query(query, [userId], (err, results) => { //ביצוע השאילתה 
    if (err) res.status(500).send('אירעה שגיאה בטעינת מערכת השיעורים');
    else res.json(results);
  });
});

  // תאריך השיעור האחרון במערכת
app.get('/api/max-class-date', (req, res) => {
  const query = 'SELECT MAX(class_date) AS maxDate FROM classes';
  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ maxDate: null });
    }
    const row = results[0];
    res.json({ maxDate: row && row.maxDate ? row.maxDate : null });
  });
});

//מחיקת שיעור מהמערכת
app.delete('/delete-class/:id', (req, res) => {
  db.query('DELETE FROM classes WHERE id = ?', [req.params.id], (err) => {
    if (err) res.status(500).json({ success: false, message: 'אירעה שגיאה במחיקת השיעור' });
    else res.json({ success: true, message: 'השיעור נמחק בהצלחה' });
  });
});

 // יצירת שבוע מלא מהפריסט ובדיקת כפילויות
app.post('/admin/generate-week-range', (req, res) => {
  const { startDate } = req.body;

  if (!startDate) {
    return res.status(400).json({ success: false, message: 'חסר תאריך התחלה' });
  }

  const [year, month, day] = startDate.split('-').map(Number);
  const startObj = new Date(year, month - 1, day);
  const endObj = new Date(startObj);
  endObj.setDate(startObj.getDate() + 6);

  const startStr = startDate;
  const endStr = `${endObj.getFullYear()}-${String(endObj.getMonth() + 1).padStart(2, '0')}-${String(endObj.getDate()).padStart(2, '0')}`;

  // בדיקה אם כבר קיימים שיעורים במערכת לשבוע הזה
  const checkSql = `
    SELECT COUNT(*) AS cnt
    FROM classes
    WHERE class_date BETWEEN ? AND ?
  `;
  db.query(checkSql, [startStr, endStr], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'שגיאה בבדיקת השבוע במערכת' });
    }

    if (results[0].cnt > 0) {
      return res.status(400).json({
        success: false,
        message: 'כבר קיימת מערכת שעות לשבוע הזה. מחקי קודם את כל השיעורים בשבוע אם את רוצה ליצור מחדש.'
      });
    }

    generateClassesForWeek(startStr, (err2) => {
      if (err2) {
        console.error(err2);
        return res.status(500).json({ success: false, message: 'שגיאה ביצירת שיעורים לשבוע' });
      }
      res.json({ success: true, message: 'השבוע נוצר בהצלחה' });
    });
  });
});


//  הרשמה וביטול לשיעורים

app.post('/register-class', (req, res) => {
  const { userId, classId } = req.body;
  // בדיקה האם השיעור קיים 
  const checkQuery = 'SELECT * FROM classes WHERE id = ?';
  db.query(checkQuery, [classId], (err, results) => {
    if (err || results.length === 0) {
      return res.status(500).json({ success: false, message: 'השיעור לא נמצא' });
    }

    const cls = results[0];

    // בדיקת זמן - חסימת רישום לשיעורים שהסתיימו כבר
    const now = new Date();
    const [y, m, d] = cls.class_date.split('-').map(Number);
    const [h, min] = cls.start_time.split(':').map(Number);
    const classStart = new Date(y, m - 1, d, h, min);

    if (classStart < now) {
      return res.json({ success: false, message: 'לא ניתן להירשם לשיעור שכבר התחיל או הסתיים' });
    }

    const isFull = cls.current_participants >= cls.max_participants;
    const status = isFull ? 'waitlist' : 'registered';

    // רישום לבסיס הנתונים
    const registerQuery = 'INSERT INTO registrations (user_id, class_id, status) VALUES (?, ?, ?)';
    db.query(registerQuery, [userId, classId, status], (err2) => {
      if (err2) return res.json({ success: false, message: 'כבר נרשמת לשיעור הזה' });

       // עדכון ספירת משתתפים אם נרשם לשיעור
      if (status === 'registered') {
        db.query('UPDATE classes SET current_participants = current_participants + 1 WHERE id = ?', [classId]);
      }

      res.json({
        success: true,
        status: status,
        message: isFull ? 'נכנסת לרשימת ההמתנה' : 'נרשמת לשיעור בהצלחה'
      });
    });
  });
});

// קידום אוטומטי מרשימת המתנה כשמישהו מבטל
app.post('/cancel-registration', (req, res) => {
  const { userId, classId } = req.body;

  // שלב 1: בדיקת הסטטוס הנוכחי של המבטל
  db.query(
    'SELECT status FROM registrations WHERE user_id = ? AND class_id = ?',
    [userId, classId],
    (err, results) => {
      if (err || results.length === 0) {
        return res.json({ success: false, message: 'הרישום לשיעור לא נמצא' });
      }
      const oldStatus = results[0].status;

      // שלב 2: מחיקת הרישום
      db.query(
        'DELETE FROM registrations WHERE user_id = ? AND class_id = ?',
        [userId, classId],
        (err2) => {
          if (err2) return res.json({ success: false, message: 'אירעה שגיאה בביטול הרישום' });

          // שלב 3: אם מי שביטל היה רשום (לא בהמתנה), בדיקת קידום
          if (oldStatus === 'registered') {
            const checkWaitlistSql = `
              SELECT * FROM registrations 
              WHERE class_id = ? AND status = 'waitlist' 
              ORDER BY created_at ASC 
              LIMIT 1
            `; // FIFO - הראשון שנרשם להמתנה מקודם ראשון

            db.query(checkWaitlistSql, [classId], (err3, waitlistUsers) => {
              if (!err3 && waitlistUsers.length > 0) {
                // קידום המשתמשת הבאה בתור
                const nextUser = waitlistUsers[0];
                db.query(
                  "UPDATE registrations SET status = 'registered' WHERE id = ?",
                  [nextUser.id],
                  (err4) => {
                    if (!err4) {
                      console.log(`User ${nextUser.user_id} promoted from waitlist for class ${classId}`);
                    }
                  }
                );
              } else {
                // אין אף אחד בהמתנה - הפחתת ספירה
                db.query('UPDATE classes SET current_participants = current_participants - 1 WHERE id = ?', [classId]);
              }
            });
          }

          res.json({ success: true, message: 'הרישום לשיעור בוטל בהצלחה' });
        }
      );
    }
  );
});

// הוספת מתאמן על ידי מנהלת לשיעור או לרשימת המתנה
app.post('/admin-add-user', (req, res) => {
  const { userId, classId, asWaitlist } = req.body;

  //  בדיקה כפילות בהרשמות
  db.query(
    'SELECT * FROM registrations WHERE user_id = ? AND class_id = ?',
    [userId, classId],
    (err, results) => {
      if (results && results.length > 0) {
        return res.json({ success: false, message: 'המתאמן כבר רשום לשיעור זה (או ברשימת המתנה)' });
      }

      // בדיקת נתוני השיעור
      db.query('SELECT current_participants, max_participants FROM classes WHERE id = ?', [classId], (err2, classRes) => {
        if (err2 || classRes.length === 0) {
          return res.json({ success: false, message: 'שגיאה בבדיקת נתוני השיעור' });
        }

        const { current_participants, max_participants } = classRes[0];
        const isFull = current_participants >= max_participants;

        //  הוספה לרשימת המתנה 
        if (asWaitlist) {
          db.query(
            "INSERT INTO registrations (user_id, class_id, status) VALUES (?, ?, 'waitlist')",
            [userId, classId],
            (err3) => {
              if (err3) return res.json({ success: false, message: 'אירעה שגיאה בהוספה להמתנה' });
              res.json({ success: true, message: 'המתאמן נוסף לרשימת ההמתנה בהצלחה' });
            }
          );
        }
        // אם אין מקום בשיעור מציע להוסיף לרשימת המתנה  
        else {
          if (isFull) {
            return res.json({
              success: false,
              code: 'CLASS_FULL',
              message: 'השיעור מלא. האם להוסיף לרשימת המתנה?'
            });
          }

          // הוספה לרשימת הרשומים לשיעור 
          db.query(
            "INSERT INTO registrations (user_id, class_id, status) VALUES (?, ?, 'registered')",
            [userId, classId],
            (err3) => {
              if (err3) return res.json({ success: false, message: 'אירעה שגיאה בהוספת המתאמן' });

              db.query('UPDATE classes SET current_participants = current_participants + 1 WHERE id = ?', [classId]);
              res.json({ success: true, message: 'המתאמן נוסף לשיעור בהצלחה' });
            }
          );
        }
      });
    }
  );
});

 // רשימת משתתפים בשיעור ספציפי 
app.get('/class-participants/:id', (req, res) => {
  const classId = req.params.id;
  const query = `
    SELECT u.first_name, u.last_name, u.email, r.status
    FROM registrations r
    JOIN users u ON r.user_id = u.email
    WHERE r.class_id = ?
    ORDER BY r.created_at ASC
  `;
  db.query(query, [classId], (err, results) => {
    if (err) res.status(500).send('אירעה שגיאה בטעינת המשתתפות בשיעור');
    else res.json(results);
  });
});


//  הודעות
app.post('/add-message', (req, res) => {
  db.query('INSERT INTO messages (content) VALUES (?)', [req.body.content], (err) => {
    if (err) res.status(500).json({ success: false, message: 'אירעה שגיאה בהוספת ההודעה' });
    else res.json({ success: true, message: 'ההודעה נוספה בהצלחה' });
  });
});

app.get('/messages', (req, res) => {
  db.query('SELECT * FROM messages ORDER BY created_at DESC', (err, results) => {
    if (err) res.status(500).send('אירעה שגיאה בטעינת ההודעות');
    else res.json(results);
  });
});

app.delete('/delete-message/:id', (req, res) => {
  db.query('DELETE FROM messages WHERE id = ?', [req.params.id], (err) => {
    if (err) res.status(500).json({ success: false, message: 'אירעה שגיאה במחיקת ההודעה' });
    else res.json({ success: true, message: 'ההודעה נמחקה בהצלחה' });
  });
});



app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
