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

  function isOvertimeShift(shiftKey) {
    return /^overtime/.test(shiftKey || "");
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
          isOvertime: isOvertimeShift(shiftKey),
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
      liveHours: 0,
      overtimeHours: 0,
      totalHours: 0
    }));

    const entries = collectWeekEntries(week, people);
    entries.forEach(({ slot, hours, isOvertime }) => {
      if (!hours) return;
      const assignedPeople = [...new Set([slot.hostId, slot.coHostId].filter(Boolean))];
      assignedPeople.forEach((personId) => {
        const snapshot = personId === slot.hostId ? slot.hostNameSnapshot : slot.coHostNameSnapshot;
        if (!rows.has(personId)) rows.set(personId, { id: personId, name: snapshot || "未知人员", liveHours: 0, overtimeHours: 0, totalHours: 0 });
        const row = rows.get(personId);
        if (isOvertime) row.overtimeHours += hours;
        else row.liveHours += hours;
        row.totalHours += hours;
      });
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

    Object.entries(week || {}).forEach(([dayKey, day]) => {
      const leavePeople = Array.isArray(day?.leavePeople) ? day.leavePeople : [];
      leavePeople.forEach((leave) => {
        const scheduledShifts = entries
          .filter((entry) => entry.dayKey === dayKey && (entry.slot.hostId === leave.personId || entry.slot.coHostId === leave.personId))
          .map((entry) => entry.shiftKey);
        if (scheduledShifts.length) {
          conflicts.push({
            type: "leave-scheduled",
            dayKey,
            shifts: [...new Set(scheduledShifts)],
            personId: leave.personId,
            personName: getPersonName(leave.personId, people, leave.personNameSnapshot)
          });
        }
      });
    });

    return conflicts;
  }

  function hasDayContent(day) {
    if (!day || typeof day !== "object") return false;
    if ((Array.isArray(day.leavePeople) && day.leavePeople.length) || day.leaveNote) return true;
    return Object.entries(day).some(([key, slot]) => !["leavePeople", "leaveNote", "updatedAt"].includes(key) && slot && typeof slot === "object" &&
      (slot.hostId || slot.coHostId || slot.note || (slot.startTime && slot.endTime && isOvertimeShift(key))));
  }

  function hasWeekContent(weekRecord) {
    const days = weekRecord?.days || weekRecord || {};
    return Object.values(days).some(hasDayContent);
  }

  function dateRange(startValue, endValue, maxDays = 14) {
    const start = startValue instanceof Date ? startValue : parseLocalDate(startValue);
    const end = endValue instanceof Date ? endValue : parseLocalDate(endValue);
    if (!start || !end) throw new Error("请选择开始日期和结束日期");
    const count = Math.round((end - start) / DAY_MS) + 1;
    if (count < 1) throw new Error("结束日期不能早于开始日期");
    if (count > maxDays) throw new Error(`日期区间最多支持${maxDays}天`);
    return Array.from({ length: count }, (_, index) => addDays(start, index));
  }

  function historyRecords(state, todayValue) {
    const today = todayValue instanceof Date ? new Date(todayValue) : parseLocalDate(todayValue);
    if (!today || Number.isNaN(today.getTime())) return [];
    const threshold = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
    const records = [];
    Object.entries(state?.schedules || {}).forEach(([roomKey, roomSchedule]) => {
      Object.entries(roomSchedule?.days || {}).forEach(([dateKey, day]) => {
        const date = parseLocalDate(dateKey);
        if (!date || date < threshold || date > today || !hasDayContent(day)) return;
        records.push({ roomKey, dateKey, day, roomSchedule });
      });
    });
    return records.sort((a, b) => b.dateKey.localeCompare(a.dateKey) || a.roomKey.localeCompare(b.roomKey));
  }

  function targetWeekAvailable(existing) {
    return !existing || !hasWeekContent(existing);
  }

  function copyWeekRecord(source, clearContent, timestamp) {
    if (!source || !source.days || typeof source.days !== "object") throw new Error("历史周表格式无效");
    const time = timestamp || new Date().toISOString();
    return {
      roomId: source.roomId || "",
      roomNameSnapshot: source.roomNameSnapshot || "",
      roomAccountSnapshot: source.roomAccountSnapshot || "",
      days: clearContent ? {} : JSON.parse(JSON.stringify(source.days)),
      createdAt: time,
      updatedAt: time
    };
  }

  function migrateState(input) {
    if (!input || !Array.isArray(input.people) || !input.schedules || typeof input.schedules !== "object") {
      throw new Error("数据格式无效");
    }
    if (![1, 2, 3, 4].includes(input.version)) throw new Error("不支持的数据版本");
    const output = JSON.parse(JSON.stringify(input));
    output.rooms = Array.isArray(output.rooms) ? output.rooms : [];
    output.settings = output.settings && typeof output.settings === "object" ? output.settings : {};
    output.people = output.people.map((person) => ({
      ...person,
      employmentType: person.employmentType === "partTime" ? "partTime" : "formal"
    }));
    if (output.version === 4) {
      Object.values(output.schedules).forEach((roomSchedule) => Object.values(roomSchedule?.days || {}).forEach((day) => {
        day.leavePeople = Array.isArray(day.leavePeople) ? day.leavePeople : [];
        day.leaveNote = day.leaveNote || "";
      }));
      return output;
    }

    if (output.version < 3) Object.values(output.schedules).forEach((week) => {
      Object.values(week || {}).forEach((day) => {
        if (!day || typeof day !== "object") return;
        day.leavePeople = Array.isArray(day.leavePeople) ? day.leavePeople : [];
        Object.entries(day).forEach(([key, slot]) => {
          if (key === "leavePeople" || !slot || typeof slot !== "object" || Array.isArray(slot)) return;
          slot.roomId = slot.roomId || "";
          slot.roomNameSnapshot = slot.roomNameSnapshot || "";
          slot.roomAccountSnapshot = slot.roomAccountSnapshot || "";
        });
      });
    });

    if (output.version < 3) {
      const v3Schedules = {};
      Object.entries(output.schedules).forEach(([weekKey, days]) => {
      const roomIds = new Set();
      let snapshotName = "";
      let snapshotAccount = "";
      Object.values(days || {}).forEach((day) => {
        Object.entries(day || {}).forEach(([key, slot]) => {
          if (key === "leavePeople" || !slot || typeof slot !== "object") return;
          if ((slot.hostId || slot.coHostId) && slot.roomId) roomIds.add(slot.roomId);
          if (!snapshotName && slot.roomNameSnapshot) snapshotName = slot.roomNameSnapshot;
          if (!snapshotAccount && slot.roomAccountSnapshot) snapshotAccount = slot.roomAccountSnapshot;
          delete slot.roomId;
          delete slot.roomNameSnapshot;
          delete slot.roomAccountSnapshot;
        });
      });
      const roomKey = roomIds.size === 1 ? [...roomIds][0] : "unassigned";
      const room = output.rooms.find((item) => item.id === roomKey);
      if (!v3Schedules[roomKey]) v3Schedules[roomKey] = {};
      v3Schedules[roomKey][weekKey] = {
        roomId: roomKey === "unassigned" ? "" : roomKey,
        roomNameSnapshot: room?.name || snapshotName || (roomKey === "unassigned" ? "未指定直播间" : "历史直播间"),
        roomAccountSnapshot: room?.account || snapshotAccount || "",
        days,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      });
      output.version = 3;
      output.schedules = v3Schedules;
    }

    const weekdayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const v4Schedules = {};
    Object.entries(output.schedules).forEach(([roomKey, weeks]) => {
      const firstRecord = Object.values(weeks || {})[0] || {};
      v4Schedules[roomKey] = {
        roomId: firstRecord.roomId || (roomKey === "unassigned" ? "" : roomKey),
        roomNameSnapshot: firstRecord.roomNameSnapshot || (roomKey === "unassigned" ? "未指定直播间" : "历史直播间"),
        roomAccountSnapshot: firstRecord.roomAccountSnapshot || "",
        days: {}
      };
      Object.entries(weeks || {}).forEach(([weekKey, record]) => {
        const monday = parseLocalDate(weekKey);
        if (!monday || !record?.days) return;
        weekdayKeys.forEach((dayKey, index) => {
          const day = record.days[dayKey];
          if (!day) return;
          const dateKey = toIsoDate(addDays(monday, index));
          const migratedDay = { ...day, leavePeople: Array.isArray(day.leavePeople) ? day.leavePeople : [], leaveNote: day.leaveNote || "", updatedAt: record.updatedAt || new Date().toISOString() };
          const existing = v4Schedules[roomKey].days[dateKey];
          if (!existing || !hasDayContent(existing) || String(migratedDay.updatedAt) >= String(existing.updatedAt || "")) v4Schedules[roomKey].days[dateKey] = migratedDay;
        });
      });
    });
    output.version = 4;
    output.schedules = v4Schedules;
    return output;
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
    isOvertimeShift,
    calculateStatistics,
    findConflicts,
    hasDayContent,
    hasWeekContent,
    dateRange,
    historyRecords,
    targetWeekAvailable,
    copyWeekRecord,
    migrateState
  };
});
