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

test("migrates V1 data without losing schedules", () => {
  const v1 = { version: 1, people: [{ id: "a", name: "甲", active: true }], schedules: { "2026-10-05": { monday: { morning: { hostId: "a" } } } } };
  const result = Logic.migrateState(v1);
  assert.equal(result.version, 2);
  assert.deepEqual(result.rooms, []);
  assert.equal(result.people[0].employmentType, "formal");
  assert.deepEqual(result.schedules["2026-10-05"].monday.leavePeople, []);
  assert.equal(result.schedules["2026-10-05"].monday.morning.hostId, "a");
  assert.equal(result.schedules["2026-10-05"].monday.morning.roomId, "");
});

console.log("All logic tests passed.");
