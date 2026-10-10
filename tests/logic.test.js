const assert = require("node:assert/strict");
const Logic = require("../logic.js");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("returns Monday as start of week", () => {
  assert.equal(Logic.toIsoDate(Logic.startOfWeek("2026-10-09")), "2026-10-05");
});

test("builds Monday through Sunday", () => {
  const dates = Logic.getWeekDates("2026-10-05").map(Logic.toIsoDate);
  assert.deepEqual(dates, ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
});

test("calculates ordinary and overnight hours", () => {
  assert.equal(Logic.durationHours("08:00", "13:00"), 5);
  assert.equal(Logic.durationHours("23:00", "01:30"), 2.5);
  assert.equal(Logic.durationHours("08:00", "08:00"), 0);
});

test("calculates live hours without distinguishing roles", () => {
  const people = [{ id: "a", name: "甲" }, { id: "b", name: "乙" }];
  const week = { monday: { morning: { hostId: "a", coHostId: "b", startTime: "08:00", endTime: "13:00" } } };
  const result = Logic.calculateStatistics(week, people);
  assert.equal(result.sessionCount, 1);
  assert.equal(result.totalPersonHours, 10);
  const byName = Object.fromEntries(result.rows.map((row) => [row.name, row]));
  assert.deepEqual([byName["甲"].liveHours, byName["甲"].overtimeHours, byName["甲"].totalHours], [5, 0, 5]);
  assert.deepEqual([byName["乙"].liveHours, byName["乙"].overtimeHours, byName["乙"].totalHours], [5, 0, 5]);
});

test("separates overtime and counts the same person only once per slot", () => {
  const people = [{ id: "a", name: "甲" }];
  const week = { monday: {
    morning: { hostId: "a", coHostId: "a", startTime: "08:00", endTime: "13:00" },
    overtimeMorning: { hostId: "a", coHostId: "", startTime: "13:00", endTime: "15:00" }
  } };
  const result = Logic.calculateStatistics(week, people);
  assert.deepEqual([result.rows[0].liveHours, result.rows[0].overtimeHours, result.rows[0].totalHours], [5, 2, 7]);
  assert.equal(result.totalPersonHours, 7);
});

test("counts embedded overtime separately without adding a live session", () => {
  const people = [{ id: "a", name: "甲" }, { id: "b", name: "乙" }];
  const week = { monday: { morning: { hostId: "a", coHostId: "b", startTime: "08:00", endTime: "12:30", overtimeStartTime: "12:30", overtimeEndTime: "14:00" } } };
  const result = Logic.calculateStatistics(week, people);
  assert.equal(result.sessionCount, 1);
  assert.deepEqual([result.rows[0].liveHours, result.rows[0].overtimeHours], [4.5, 1.5]);
});

test("plans four, three and two-group days from leave conflicts", () => {
  const templates = [
    { id: "g1", hostId: "h1", coHostId: "c1", shiftKey: "morning" },
    { id: "g2", hostId: "h2", coHostId: "c2", shiftKey: "afternoon" },
    { id: "g3", hostId: "h3", coHostId: "c3", shiftKey: "evening" },
    { id: "g4", hostId: "h4", coHostId: "c4", shiftKey: "secondary" }
  ];
  assert.equal(Logic.planDayFromTemplates(templates, []).scenario, "four");
  const partTime = { id: "pt", hostId: "ph", coHostId: "pc" };
  const three = Logic.planDayFromTemplates(templates, ["h1"], partTime);
  assert.deepEqual([three.scenario, three.needsPartTime, three.missingShiftKeys], ["three", true, []]);
  assert.equal(three.assignments.find((item) => item.groupType === "partTime").shiftKey, "morning");
  const two = Logic.planDayFromTemplates(templates, ["h1", "h2"], partTime);
  assert.equal(two.scenario, "two");
  assert.deepEqual(two.assignments.map((item) => item.shiftKey), ["morning", "afternoon", "evening"]);
  assert.deepEqual(two.assignments.slice(0, 2).map((item) => [item.overtimeStartTime, item.overtimeEndTime]), [["12:30", "14:00"], ["17:30", "19:00"]]);
  assert.equal(two.missingShiftKeys.length, 0);
  assert.deepEqual(two.requiredOvertimeGroupIds.sort(), ["g3", "g4"]);
});

test("does not use the fixed part-time group when either member is on leave", () => {
  const templates = [
    { id: "g1", hostId: "h1", coHostId: "c1", shiftKey: "morning" },
    { id: "g2", hostId: "h2", coHostId: "c2", shiftKey: "afternoon" },
    { id: "g3", hostId: "h3", coHostId: "c3", shiftKey: "evening" },
    { id: "g4", hostId: "h4", coHostId: "c4", shiftKey: "secondary" }
  ];
  const plan = Logic.planDayFromTemplates(templates, ["h1", "ph"], { id: "pt", hostId: "ph", coHostId: "pc" });
  assert.equal(plan.partTimeConflict, true);
  assert.equal(plan.assignments.some((item) => item.groupType === "partTime"), false);
  assert.deepEqual(plan.missingShiftKeys, ["morning"]);
});

test("re-evaluates guidance from the current schedule instead of stale generation metadata", () => {
  const day = {
    leavePeople: [{ personId: "old-part-time" }],
    autoSchedule: { scenario: "three", partTimeConflict: true },
    morning: { hostId: "h1", coHostId: "c1", startTime: "08:00", endTime: "12:30" },
    afternoon: { hostId: "h2", coHostId: "c2", startTime: "13:00", endTime: "17:30" },
    evening: { hostId: "h3", coHostId: "c3", startTime: "19:00", endTime: "23:30" },
    secondary: { hostId: "replacement-host", coHostId: "replacement-cohost", startTime: "13:30", endTime: "18:00" }
  };
  const result = Logic.evaluateDaySchedule(day);
  assert.equal(result.completeCount, 4);
  assert.equal(result.hasLeaveConflict, false);
});

test("detects overlapping assignments", () => {
  const people = [{ id: "a", name: "甲" }, { id: "b", name: "乙" }, { id: "c", name: "丙" }];
  const week = { monday: {
    morning: { hostId: "a", coHostId: "b", startTime: "08:00", endTime: "13:00" },
    afternoon: { hostId: "a", coHostId: "c", startTime: "12:30", endTime: "18:00" }
  } };
  const conflicts = Logic.findConflicts(week, people);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, "overlap");
  assert.equal(conflicts[0].personName, "甲");
});

test("detects same person in both roles", () => {
  const people = [{ id: "a", name: "甲" }];
  const week = { monday: { morning: { hostId: "a", coHostId: "a", startTime: "08:00", endTime: "13:00" } } };
  assert.equal(Logic.findConflicts(week, people)[0].type, "same-role-person");
});

test("warns when a person on leave is scheduled", () => {
  const people = [{ id: "a", name: "甲" }];
  const week = { monday: {
    morning: { hostId: "a", coHostId: "", startTime: "08:00", endTime: "13:00" },
    leavePeople: [{ personId: "a", personNameSnapshot: "甲" }]
  } };
  assert.equal(Logic.findConflicts(week, people).some((item) => item.type === "leave-scheduled"), true);
});

test("migrates V1 data to unassigned V4 without losing schedules", () => {
  const v1 = { version: 1, people: [{ id: "a", name: "甲", active: true }], schedules: { "2026-10-05": { monday: { morning: { hostId: "a" } } } } };
  const result = Logic.migrateState(v1);
  assert.equal(result.version, 4);
  assert.deepEqual(result.rooms, []);
  assert.equal(result.people[0].employmentType, "formal");
  assert.deepEqual(result.schedules.unassigned.days["2026-10-05"].leavePeople, []);
  assert.equal(result.schedules.unassigned.days["2026-10-05"].morning.hostId, "a");
  assert.equal(result.schedules.unassigned.roomNameSnapshot, "未指定直播间");
});

test("migrates a single-room V2 week into that room", () => {
  const v2 = { version: 2, rooms: [{ id: "r1", name: "一号间", account: "room-1", active: true }], people: [], schedules: {
    "2026-10-05": { monday: { morning: { roomId: "r1", roomNameSnapshot: "一号间", roomAccountSnapshot: "room-1", hostId: "a", startTime: "08:00", endTime: "13:00" }, leavePeople: [] } }
  } };
  const result = Logic.migrateState(v2);
  assert.equal(result.version, 4);
  assert.equal(result.schedules.r1.roomId, "r1");
  assert.equal(result.schedules.r1.days["2026-10-05"].morning.roomId, undefined);
});

test("keeps mixed-room V2 weeks unassigned", () => {
  const v2 = { version: 2, rooms: [], people: [], schedules: { "2026-10-05": { monday: {
    morning: { roomId: "r1", hostId: "a" }, afternoon: { roomId: "r2", hostId: "b" }, leavePeople: []
  } } } };
  assert.ok(Logic.migrateState(v2).schedules.unassigned.days["2026-10-05"]);
});

test("returns only non-empty history from the last three months", () => {
  const filled = { morning: { hostId: "a", startTime: "08:00", endTime: "13:00" }, leavePeople: [], leaveNote: "" };
  const state = { schedules: { r1: { days: { "2026-10-05": filled, "2026-06-01": filled, "2026-10-12": {} } } } };
  const records = Logic.historyRecords(state, "2026-10-09");
  assert.deepEqual(records.map((item) => item.dateKey), ["2026-10-05"]);
});

test("clears only selected schedule days while preserving leave information", () => {
  const roomSchedule = { days: {
    "2026-10-01": { morning: { hostId: "a" }, overtimeMorning: { hostId: "b" }, autoSchedule: { scenario: "two" }, leavePeople: [{ personId: "c" }], leaveNote: "年假", updatedAt: "old" },
    "2026-10-02": { afternoon: { hostId: "d" }, leavePeople: [], leaveNote: "" },
    "2026-10-03": { evening: { hostId: "e" }, leavePeople: [], leaveNote: "区间外" }
  } };
  const cleared = Logic.clearScheduleDays(roomSchedule, ["2026-10-01", "2026-10-02"], ["morning", "afternoon", "evening", "overtimeMorning"], "new-time");
  assert.equal(cleared, 2);
  assert.deepEqual(roomSchedule.days["2026-10-01"].leavePeople, [{ personId: "c" }]);
  assert.equal(roomSchedule.days["2026-10-01"].leaveNote, "年假");
  assert.equal(roomSchedule.days["2026-10-01"].morning, undefined);
  assert.equal(roomSchedule.days["2026-10-01"].overtimeMorning, undefined);
  assert.equal(roomSchedule.days["2026-10-01"].autoSchedule, undefined);
  assert.equal(roomSchedule.days["2026-10-01"].updatedAt, "new-time");
  assert.equal(roomSchedule.days["2026-10-02"].afternoon, undefined);
  assert.equal(roomSchedule.days["2026-10-03"].evening.hostId, "e");
});

test("builds flexible date ranges across week boundaries", () => {
  assert.deepEqual(Logic.dateRange("2026-10-03", "2026-10-06").map(Logic.toIsoDate), ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]);
});

test("accepts one and fourteen day ranges", () => {
  assert.equal(Logic.dateRange("2026-10-01", "2026-10-01").length, 1);
  assert.equal(Logic.dateRange("2026-10-01", "2026-10-14").length, 14);
});

test("rejects reversed and overlong ranges", () => {
  assert.throws(() => Logic.dateRange("2026-10-02", "2026-10-01"));
  assert.throws(() => Logic.dateRange("2026-10-01", "2026-10-15"));
});

test("selects a hotel-style date range in two steps", () => {
  assert.deepEqual(Logic.chooseRangeDate("", "2026-10-05"), { start: "2026-10-05", end: "", complete: false });
  assert.deepEqual(Logic.chooseRangeDate("2026-10-05", "2026-10-11"), { start: "2026-10-05", end: "2026-10-11", complete: true });
});

test("restarts the range when an earlier date is clicked and rejects day fifteen", () => {
  assert.deepEqual(Logic.chooseRangeDate("2026-10-05", "2026-10-03"), { start: "2026-10-03", end: "", complete: false });
  assert.throws(() => Logic.chooseRangeDate("2026-10-01", "2026-10-15"), /最多支持14天/);
});

test("migrates V3 leave notes to concrete dates", () => {
  const v3 = { version: 3, people: [], rooms: [], settings: {}, schedules: { r1: { "2026-10-05": { roomId: "r1", roomNameSnapshot: "一号间", days: { monday: { leavePeople: [], leaveNote: "周本休" } } } } } };
  const result = Logic.migrateState(v3);
  assert.equal(result.schedules.r1.days["2026-10-05"].leaveNote, "周本休");
});

console.log("All logic tests passed.");
