import React, { useState } from 'react';
// Reuses the planner page's .mini-cal styles for a consistent look.
import '../pages/css/Calendar.css';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function buildMonth(year, month) {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(new Date(year, month, 1 - firstDow + i));
  for (let i = 1; i <= daysInMonth; i++) cells.push(new Date(year, month, i));
  while (cells.length % 7) cells.push(new Date(cells[cells.length - 1].getTime() + 86400000));
  return cells;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Compact month-grid date picker, styled to match the planner's mini calendar.
export default function MiniCalendar({ selected, onSelect }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [year, setYear] = useState(selected.getFullYear());
  const [month, setMonth] = useState(selected.getMonth());
  const cells = buildMonth(year, month);

  const prevMonth = () => { const d = new Date(year, month - 1, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); };
  const nextMonth = () => { const d = new Date(year, month + 1, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); };

  return (
    <div className="mini-cal">
      <div className="mini-cal-header">
        <button type="button" className="mini-cal-nav" onClick={prevMonth}>‹</button>
        <span className="mini-cal-title">{MONTH_NAMES[month]} {year}</span>
        <button type="button" className="mini-cal-nav" onClick={nextMonth}>›</button>
      </div>
      <div className="mini-cal-grid">
        {DAY_NAMES.map(d => <span key={d} className="mini-cal-dow">{d[0]}</span>)}
        {cells.map((cell, i) => {
          const inMonth = cell.getMonth() === month;
          const isToday = sameDay(cell, today);
          const isSel = sameDay(cell, selected);
          return (
            <button
              key={i}
              type="button"
              className={[
                'mini-cal-cell',
                !inMonth && 'mini-cal-other',
                isToday && 'mini-cal-today',
                isSel && 'mini-cal-selected',
              ].filter(Boolean).join(' ')}
              onClick={() => onSelect(cell)}
            >
              {cell.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
