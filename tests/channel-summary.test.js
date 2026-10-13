const assert = require("assert");
const ExcelJS = require("../vendor/exceljs.min.js");
const Summary = require("../channel-summary.js");

function buildFixture() {
  const workbook = new ExcelJS.Workbook();
  const detail = workbook.addWorksheet(Summary.DETAIL_SHEET);
  const roster = workbook.addWorksheet(Summary.ROSTER_SHEET);
  const mapping = workbook.addWorksheet(Summary.MAPPING_SHEET);

  mapping.addRow(["原来", "改名后", "原来"]);
  mapping.addRow(["旧视频号", "视频账号", "归属甲"]);
  mapping.addRow(["旧抖音号", "抖音账号", "归属乙"]);
  mapping.addRow(["旧小红书号", "小红书账号", "归属丙"]);
  mapping.addRow(["旧零值号", "零值账号", "归属零"]);

  roster.addRow(["大区", "归属", "定位", "账号", "目标", "本月销售"]);
  roster.getCell(2, 2).value = "归属甲";
  roster.getCell(2, 4).value = "视频账号";
  roster.getCell(2, 6).value = { formula: "SUM(A:A)", result: 0 };
  for (let row = 3; row <= 18; row += 1) roster.getCell(row, 4).value = "合计";
  roster.getCell(23, 2).value = "归属乙";
  roster.getCell(23, 4).value = "抖音账号";
  roster.getCell(23, 6).value = { formula: 'SUMIFS(A:A,C:C,"抖音")', result: 0 };
  roster.getCell(24, 2).value = "归属零";
  roster.getCell(24, 4).value = "零值账号";
  roster.getCell(24, 6).value = { formula: 'SUMIFS(A:A,C:C,"抖音")', result: 0 };
  roster.getCell(54, 2).value = "归属丙";
  roster.getCell(54, 4).value = "小红书账号";
  roster.getCell(54, 6).value = { formula: 'SUMIFS(A:A,C:C,"小红书")', result: 0 };
  roster.getCell(55, 2).value = "归属甲";
  roster.getCell(55, 4).value = "视频账号";
  roster.getCell(55, 6).value = { formula: 'SUMIFS(A:A,C:C,"小红书")', result: 0 };

  detail.addRow(["测试"]);
  detail.addRow(["说明"]);
  detail.addRow(["销售订单", "支付/退款", "渠道", "大区", "店铺名称", "直播间账号名"]);
  function addTransaction(order, channel, account, amount, month, affiliation = "") {
    const row = detail.addRow([]);
    row.getCell(1).value = order;
    row.getCell(3).value = channel;
    row.getCell(6).value = account;
    row.getCell(12).value = amount;
    row.getCell(17).value = affiliation;
    row.getCell(18).value = amount > 0 ? amount : 0;
    row.getCell(19).value = month;
    row.getCell(22).value = amount < 0 ? amount : 0;
  }
  addTransaction("1", "视频号", "视频账号", 100, 9);
  addTransaction("2", "视频号", "视频账号", -20, 9);
  addTransaction("3", "抖音", "抖音账号", 200, 9);
  addTransaction("4", "抖音", "抖音账号", -50, 9);
  addTransaction("5", "小红书", "小红书账号", 300, 8);
  addTransaction("6", "小红书", "视频账号", 50, 9);
  addTransaction("7", "视频号", "未知账号", 10, 9);
  return workbook;
}

(async () => {
  const record = Summary.summarizeWorkbook(buildFixture(), 9, { sourceFileName: "测试.xlsx", calculatedAt: "2026-10-13T00:00:00.000Z" });
  assert.equal(record.month, 9);
  assert.equal(record.sourceFileName, "测试.xlsx");
  assert.equal(record.unresolved.length, 1);
  assert.equal(record.unresolved[0].rowNumber, 10);

  const byChannel = Object.fromEntries(record.sections.map((section) => [section.channel, section]));
  assert.deepEqual(Object.fromEntries(record.sections.map((section) => [section.channel, section.totals.accountCount])), {
    视频号: 1,
    抖音: 2,
    小红书: 2,
    全渠道汇总: 4
  });
  assert.equal(byChannel.视频号.totals.sales, 100);
  assert.equal(byChannel.视频号.totals.refunds, -20);
  assert.equal(byChannel.抖音.totals.sales, 200);
  assert.equal(byChannel.抖音.totals.refunds, -50);
  assert.equal(byChannel.小红书.totals.sales, 50);
  assert.equal(byChannel.全渠道汇总.totals.sales, 350);
  assert.equal(byChannel.全渠道汇总.totals.refunds, -70);
  const videoAccount = byChannel.全渠道汇总.rows.find((row) => row.affiliation === "归属甲" && row.account === "视频账号");
  assert.equal(videoAccount.sales, 150);
  assert.equal(videoAccount.refunds, -20);
  const zeroAccount = byChannel.全渠道汇总.rows.find((row) => row.account === "零值账号");
  assert.equal(zeroAccount.sales, 0);
  assert.equal(zeroAccount.refundRate, 0);

  const exported = Summary.createSummaryWorkbook(ExcelJS, record);
  const buffer = await exported.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  assert.equal(reopened.getWorksheet("月度汇总").getCell("A1").value, "视频号");
  assert.ok(reopened.getWorksheet("未映射明细"));
  assert.equal(Summary.exportFileName(record), "渠道月度汇总-9月.xlsx");

  assert.throws(() => Summary.summarizeWorkbook(new ExcelJS.Workbook(), 9), /店铺清单/);
  assert.throws(() => Summary.summarizeWorkbook(buildFixture(), 13), /1 至 12/);
  console.log("channel summary tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
