(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ScheduleLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;

  function parseLocalDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function startOfWeek(value) {
    const date = value instanceof Date
      ? new Date(value.getFullYear(), value.getMonth(), value.getDate())
      : parseLocalDate(value);
    if (!date || Number.isNaN(date.getTime())) return null;
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    return date;
  }

  function addDays(date, count) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    result.setDate(result.getDate() + count);
    return result;
  }

  function getWeekDates(weekKey) {
    const monday = startOfWeek(weekKey);
    if (!monday) return [];
    return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  }

  function timeToMinutes(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(value || "");
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function durationHours(startTime, endTime) {
    const start = timeToMinutes(startTime);
    let end = timeToMinutes(endTime);
    if (start === null || end === null || start === end) return 0;
    if (end < start) end += 24 * 60;
    return (end - start) / 60;
  }

  function intervalForSlot(slot) {
    const start = timeToMinutes(slot.startTime);
    let end = timeToMinutes(slot.endTime);
    if (start === null || end === null || start === end) return null;
    if (end < start) end += 24 * 60;
    return { start, end };
  }

  function intervalsOverlap(first, second) {
    return first.start < second.end && second.start < first.end;
  }

  function hasAssignment(slot) {
    return Boolean(slot && (slot.hostId || slot.coHostId));
  }

  function getPersonName(personId, people, snapshot) {
    const person = people.find((item) => item.id === personId);
    return person ? person.name : (snapshot || "未知人员");
  }

  function collectWeekEntries(week, people) {
    const entries = [];
    Object.entries(week || {}).forEach(([dayKey, shifts]) => {
      Object.entries(shifts || {}).forEach(([shiftKey, slot]) => {
        if (!hasAssignment(slot)) return;
        const hours = durationHours(slot.startTime, slot.endTime);
        entries.push({
          dayKey,
          shiftKey,
          slot,
          hours,
          interval: intervalForSlot(slot),
          hostName: slot.hostId ? getPersonName(slot.hostId, people, slot.hostNameSnapshot) : "",
          coHostName: slot.coHostId ? getPersonName(slot.coHostId, people, slot.coHostNameSnapshot) : ""
        });
      });
    });
    return entries;
  }

  function calculateStatistics(week, people) {
    const rows = new Map();
    people.forEach((person) => rows.set(person.id, {
      id: person.id,
      name: person.name,
      hostHours: 0,
      coHostHours: 0,
      totalHours: 0
    }));

    const entries = collectWeekEntries(week, people);
    entries.forEach(({ slot, hours }) => {
      if (!hours) return;
      if (slot.hostId) {
        if (!rows.has(slot.hostId)) rows.set(slot.hostId, { id: slot.hostId, name: slot.hostNameSnapshot || "未知人员", hostHours: 0, coHostHours: 0, totalHours: 0 });
        rows.get(slot.hostId).hostHours += hours;
        rows.get(slot.hostId).totalHours += hours;
      }
      if (slot.coHostId) {
        if (!rows.has(slot.coHostId)) rows.set(slot.coHostId, { id: slot.coHostId, name: slot.coHostNameSnapshot || "未知人员", hostHours: 0, coHostHours: 0, totalHours: 0 });
        rows.get(slot.coHostId).coHostHours += hours;
        rows.get(slot.coHostId).totalHours += hours;
      }
    });

    return {
      sessionCount: entries.filter((entry) => entry.hours > 0).length,
      totalPersonHours: Array.from(rows.values()).reduce((sum, row) => sum + row.totalHours, 0),
      rows: Array.from(rows.values()).filter((row) => row.totalHours > 0).sort((a, b) => b.totalHours - a.totalHours || a.name.localeCompare(b.name, "zh-CN"))
    };
  }

  function findConflicts(week, people) {
    const conflicts = [];
    const entries = collectWeekEntries(week, people);

    entries.forEach((entry) => {
      const { slot } = entry;
      if (slot.hostId && slot.coHostId && slot.hostId === slot.coHostId) {
        conflicts.push({
          type: "same-role-person",
          dayKey: entry.dayKey,
          shifts: [entry.shiftKey],
          personId: slot.hostId,
          personName: entry.hostName
        });
      }
      if (hasAssignment(slot) && !entry.interval) {
        conflicts.push({
          type: "invalid-time",
          dayKey: entry.dayKey,
          shifts: [entry.shiftKey]
        });
      }
    });

    const byDay = new Map();
    entries.filter((entry) => entry.interval).forEach((entry) => {
      if (!byDay.has(entry.dayKey)) byDay.set(entry.dayKey, []);
      byDay.get(entry.dayKey).push(entry);
    });

    byDay.forEach((dayEntries, dayKey) => {
      for (let i = 0; i < dayEntries.length; i += 1) {
        for (let j = i + 1; j < dayEntries.length; j += 1) {
          const first = dayEntries[i];
          const second = dayEntries[j];
          if (!intervalsOverlap(first.interval, second.interval)) continue;
          const firstPeople = [first.slot.hostId, first.slot.coHostId].filter(Boolean);
          const secondPeople = [second.slot.hostId, second.slot.coHostId].filter(Boolean);
          const duplicates = [...new Set(firstPeople.filter((id) => secondPeople.includes(id)))];
          duplicates.forEach((personId) => {
            conflicts.push({
              type: "overlap",
              dayKey,
              shifts: [first.shiftKey, second.shiftKey],
              personId,
              personName: getPersonName(personId, people, "未知人员")
            });
          });
        }
      }
    });

    return conflicts;
  }

  return {
    DAY_MS,
    parseLocalDate,
    toIsoDate,
    startOfWeek,
    addDays,
    getWeekDates,
    timeToMinutes,
    durationHours,
    intervalsOverlap,
    calculateStatistics,
    findConflicts
  };
});
