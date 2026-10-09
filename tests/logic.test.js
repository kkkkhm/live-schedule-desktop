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

test("migrates V1 data to unassigned V3 without losing schedules", () => {
  const v1 = { version: 1, people: [{ id: "a", name: "甲", active: true }], schedules: { "2026-10-05": { monday: { morning: { hostId: "a" } } } } };
  const result = Logic.migrateState(v1);
  assert.equal(result.version, 3);
  assert.deepEqual(result.rooms, []);
  assert.equal(result.people[0].employmentType, "formal");
  assert.deepEqual(result.schedules.unassigned["2026-10-05"].days.monday.leavePeople, []);
  assert.equal(result.schedules.unassigned["2026-10-05"].days.monday.morning.hostId, "a");
  assert.equal(result.schedules.unassigned["2026-10-05"].roomNameSnapshot, "未指定直播间");
});

test("migrates a single-room V2 week into that room", () => {
  const v2 = { version: 2, rooms: [{ id: "r1", name: "一号间", account: "room-1", active: true }], people: [], schedules: {
    "2026-10-05": { monday: { morning: { roomId: "r1", roomNameSnapshot: "一号间", roomAccountSnapshot: "room-1", hostId: "a", startTime: "08:00", endTime: "13:00" }, leavePeople: [] } }
  } };
  const result = Logic.migrateState(v2);
  assert.equal(result.version, 3);
  assert.equal(result.schedules.r1["2026-10-05"].roomId, "r1");
  assert.equal(result.schedules.r1["2026-10-05"].days.monday.morning.roomId, undefined);
});

test("keeps mixed-room V2 weeks unassigned", () => {
  const v2 = { version: 2, rooms: [], people: [], schedules: { "2026-10-05": { monday: {
    morning: { roomId: "r1", hostId: "a" }, afternoon: { roomId: "r2", hostId: "b" }, leavePeople: []
  } } } };
  assert.ok(Logic.migrateState(v2).schedules.unassigned["2026-10-05"]);
});

test("returns only non-empty history from the last three months", () => {
  const filled = { days: { monday: { morning: { hostId: "a", startTime: "08:00", endTime: "13:00" }, leavePeople: [] } } };
  const state = { schedules: { r1: { "2026-10-05": filled, "2026-06-01": filled, "2026-10-12": { days: {} } } } };
  const records = Logic.historyRecords(state, "2026-10-09");
  assert.deepEqual(records.map((item) => item.weekKey), ["2026-10-05"]);
});

test("copies a historical week without sharing mutable data", () => {
  const source = { roomId: "r1", roomNameSnapshot: "一号间", days: { monday: { morning: { hostId: "a", startTime: "08:00", endTime: "13:00" }, leavePeople: [] } } };
  const copied = Logic.copyWeekRecord(source, false, "2026-10-09T00:00:00.000Z");
  assert.equal(copied.days.monday.morning.hostId, "a");
  copied.days.monday.morning.hostId = "b";
  assert.equal(source.days.monday.morning.hostId, "a");
});

test("creates an empty week when clear content is selected", () => {
  const source = { roomId: "r1", days: { monday: { morning: { hostId: "a" } } } };
  assert.deepEqual(Logic.copyWeekRecord(source, true, "2026-10-09T00:00:00.000Z").days, {});
});

test("allows only empty copy targets", () => {
  assert.equal(Logic.targetWeekAvailable(undefined), true);
  assert.equal(Logic.targetWeekAvailable({ days: {} }), true);
  assert.equal(Logic.targetWeekAvailable({ days: { monday: { leavePeople: [{ personId: "a" }] } } }), false);
});

console.log("All logic tests passed.");
