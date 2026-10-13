(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ChannelSummary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DETAIL_SHEET = "323_支付退款分析（更新）";
  const ROSTER_SHEET = "渠道业绩汇总表";
  const MAPPING_SHEET = "店铺清单";
  const CHANNELS = ["视频号", "抖音", "小红书"];
  const ALL_CHANNELS_LABEL = "全渠道汇总";
  const OUTPUT_CHANNELS = [...CHANNELS, ALL_CHANNELS_LABEL];

  function rawValue(cell) {
    const value = cell && Object.prototype.hasOwnProperty.call(cell, "value") ? cell.value : cell;
    if (value && typeof value === "object") {
      if (Object.prototype.hasOwnProperty.call(value, "result")) return value.result;
      if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("");
      if (Object.prototype.hasOwnProperty.call(value, "text")) return value.text;
    }
    return value;
  }

  function formulaText(cell) {
    const value = cell?.value;
    if (value && typeof value === "object" && value.formula) return String(value.formula);
    return typeof value === "string" && value.startsWith("=") ? value : "";
  }

  function cleanText(value) {
    const resolved = rawValue(value);
    return resolved === null || resolved === undefined ? "" : String(resolved).trim();
  }

  function validText(value) {
    const text = cleanText(value);
    return !text || text.startsWith("#") ? "" : text;
  }

  function decimalNumber(value) {
    const resolved = rawValue(value);
    if (resolved === null || resolved === undefined || resolved === "") return null;
    if (typeof resolved === "number") return Number.isFinite(resolved) ? resolved : null;
    const parsed = Number(String(resolved).replace(/[￥¥,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function monthNumber(value) {
    const parsed = decimalNumber(value);
    if (parsed === null) return null;
    const month = Math.trunc(parsed);
    return month >= 1 && month <= 12 ? month : null;
  }

  function cents(value) {
    return Math.round((Number(value) || 0) * 100);
  }

  function money(valueInCents) {
    return Math.round(valueInCents) / 100;
  }

  function findSheet(workbook, expectedName) {
    if (!workbook) return null;
    const exact = typeof workbook.getWorksheet === "function" ? workbook.getWorksheet(expectedName) : null;
    if (exact) return exact;
    return (workbook.worksheets || []).find((sheet) => String(sheet.name || "").includes(expectedName)) || null;
  }

  function requireSheet(workbook, name) {
    const sheet = findSheet(workbook, name);
    if (!sheet) throw new Error(`源文件缺少工作表：${name}`);
    return sheet;
  }

  function readAccountMapping(workbook) {
    const sheet = requireSheet(workbook, MAPPING_SHEET);
    const mapping = new Map();
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const account = validText(sheet.getCell(rowNumber, 2));
      const affiliation = validText(sheet.getCell(rowNumber, 3));
      if (account && affiliation) mapping.set(account, affiliation);
    }
    return mapping;
  }

  function channelFromFormula(cell, rowNumber) {
    const formula = formulaText(cell);
    const matched = CHANNELS.find((channel) => formula.includes(channel));
    if (matched) return matched;
    return rowNumber <= 18 ? "视频号" : "";
  }

  function readRoster(workbook, mapping = readAccountMapping(workbook)) {
    const sheet = requireSheet(workbook, ROSTER_SHEET);
    const roster = [];
    const seen = new Set();
    const affiliationAccounts = new Map();

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const account = validText(sheet.getCell(rowNumber, 4));
      if (!account || account === "账号" || account === "合计") continue;
      const affiliation = validText(sheet.getCell(rowNumber, 2)) || mapping.get(account) || "";
      if (!affiliation || affiliation === "总计" || affiliation === "终端号总计：") continue;
      const channel = channelFromFormula(sheet.getCell(rowNumber, 6), rowNumber);
      if (!channel) continue;

      const key = `${channel}\u0000${affiliation}\u0000${account}`;
      if (seen.has(key)) continue;
      seen.add(key);
      roster.push({ channel, affiliation, account });

      const affiliationKey = `${channel}\u0000${affiliation}`;
      if (!affiliationAccounts.has(affiliationKey)) affiliationAccounts.set(affiliationKey, new Set());
      affiliationAccounts.get(affiliationKey).add(account);
    }

    const conflicts = [];
    affiliationAccounts.forEach((accounts, key) => {
      if (accounts.size <= 1) return;
      const [channel, affiliation] = key.split("\u0000");
      conflicts.push(`${channel}/${affiliation}: ${[...accounts].join("、")}`);
    });
    if (conflicts.length) throw new Error(`同一渠道和归属对应多个账号：${conflicts.join("；")}`);
    if (!roster.length) throw new Error("未能从渠道业绩汇总表识别任何有效账号。");
    return roster;
  }

  function summarizeTransactions(workbook, month, roster, mapping = readAccountMapping(workbook)) {
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("月份必须是 1 至 12 的整数。");
    const sheet = requireSheet(workbook, DETAIL_SHEET);
    const totals = new Map();
    const unresolved = [];
    let emptyStreak = 0;

    for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) {
      let hasRawData = false;
      for (let column = 1; column <= 16; column += 1) {
        const value = rawValue(sheet.getCell(rowNumber, column));
        if (value !== null && value !== undefined && value !== "") { hasRawData = true; break; }
      }
      if (!hasRawData) {
        emptyStreak += 1;
        if (emptyStreak >= 100) break;
        continue;
      }
      emptyStreak = 0;

      if (monthNumber(sheet.getCell(rowNumber, 19)) !== month) continue;
      const channel = validText(sheet.getCell(rowNumber, 3));
      if (!CHANNELS.includes(channel)) continue;
      const account = validText(sheet.getCell(rowNumber, 6));
      const rawAffiliation = validText(sheet.getCell(rowNumber, 17));
      const affiliation = rawAffiliation || mapping.get(account) || "";
      if (!affiliation) {
        unresolved.push({ rowNumber, channel, account, affiliation: cleanText(sheet.getCell(rowNumber, 17)), reason: "无法识别归属" });
        continue;
      }

      const sourceAmount = decimalNumber(sheet.getCell(rowNumber, 12)) || 0;
      const salesValue = decimalNumber(sheet.getCell(rowNumber, 18));
      const refundValue = decimalNumber(sheet.getCell(rowNumber, 22));
      const sales = salesValue === null ? Math.max(sourceAmount, 0) : salesValue;
      const refunds = refundValue === null ? Math.min(sourceAmount, 0) : refundValue;
      const key = `${channel}\u0000${affiliation}`;
      const bucket = totals.get(key) || { salesCents: 0, refundCents: 0 };
      bucket.salesCents += cents(sales);
      bucket.refundCents += cents(refunds);
      totals.set(key, bucket);
    }

    const rows = roster.map((item) => {
      const bucket = totals.get(`${item.channel}\u0000${item.affiliation}`) || { salesCents: 0, refundCents: 0 };
      const sales = money(bucket.salesCents);
      const refunds = money(bucket.refundCents);
      return { ...item, sales, refunds, refundRate: sales === 0 ? 0 : refunds / sales };
    });
    return { rows, unresolved };
  }

  function addAllChannelsSummary(rows) {
    const totals = new Map();
    const order = [];
    rows.forEach((item) => {
      const key = `${item.affiliation}\u0000${item.account}`;
      if (!totals.has(key)) {
        totals.set(key, { salesCents: 0, refundCents: 0 });
        order.push(key);
      }
      const bucket = totals.get(key);
      bucket.salesCents += cents(item.sales);
      bucket.refundCents += cents(item.refunds);
    });
    return order.map((key) => {
      const [affiliation, account] = key.split("\u0000");
      const bucket = totals.get(key);
      const sales = money(bucket.salesCents);
      const refunds = money(bucket.refundCents);
      return { channel: ALL_CHANNELS_LABEL, affiliation, account, sales, refunds, refundRate: sales === 0 ? 0 : refunds / sales };
    });
  }

  function makeSection(channel, rows) {
    const sectionRows = rows.filter((item) => item.channel === channel);
    const salesCents = sectionRows.reduce((sum, item) => sum + cents(item.sales), 0);
    const refundCents = sectionRows.reduce((sum, item) => sum + cents(item.refunds), 0);
    const sales = money(salesCents);
    const refunds = money(refundCents);
    return {
      channel,
      rows: sectionRows,
      totals: { accountCount: sectionRows.length, sales, refunds, refundRate: sales === 0 ? 0 : refunds / sales }
    };
  }

  function summarizeWorkbook(workbook, month, options = {}) {
    const normalizedMonth = Number(month);
    if (!Number.isInteger(normalizedMonth) || normalizedMonth < 1 || normalizedMonth > 12) throw new Error("月份必须是 1 至 12 的整数。");
    const mapping = readAccountMapping(workbook);
    const roster = readRoster(workbook, mapping);
    const { rows, unresolved } = summarizeTransactions(workbook, normalizedMonth, roster, mapping);
    const allRows = [...rows, ...addAllChannelsSummary(rows)];
    return {
      schemaVersion: 1,
      month: normalizedMonth,
      sourceFileName: String(options.sourceFileName || ""),
      calculatedAt: options.calculatedAt || new Date().toISOString(),
      sections: OUTPUT_CHANNELS.map((channel) => makeSection(channel, allRows)),
      unresolved
    };
  }

  function styleCell(cell, options = {}) {
    cell.font = { name: "Arial", size: options.size || 10, bold: Boolean(options.bold), color: options.color ? { argb: options.color } : undefined };
    cell.alignment = { horizontal: options.align || "left", vertical: "middle" };
    cell.border = {
      top: { style: "thin", color: { argb: "FFB7C3D0" } },
      left: { style: "thin", color: { argb: "FFB7C3D0" } },
      bottom: { style: "thin", color: { argb: "FFB7C3D0" } },
      right: { style: "thin", color: { argb: "FFB7C3D0" } }
    };
    if (options.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: options.fill } };
  }

  function createSummaryWorkbook(ExcelJS, record) {
    if (!ExcelJS?.Workbook) throw new Error("Excel 组件未加载。");
    if (!record?.sections) throw new Error("经营汇总记录无效。");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "直播排班工具";
    workbook.created = new Date(record.calculatedAt || Date.now());
    const sheet = workbook.addWorksheet("月度汇总", { views: [{ showGridLines: false, state: "frozen", ySplit: 2 }] });
    let rowNumber = 1;

    record.sections.forEach((section) => {
      sheet.mergeCells(rowNumber, 1, rowNumber, 5);
      const title = sheet.getCell(rowNumber, 1);
      title.value = section.channel;
      styleCell(title, { fill: "FFD9EAF7", bold: true, size: 12, align: "center" });
      for (let column = 2; column <= 5; column += 1) styleCell(sheet.getCell(rowNumber, column), { fill: "FFD9EAF7" });
      sheet.getRow(rowNumber).height = 22;
      rowNumber += 1;

      ["归属", "账号", "本月销售", "本月退款", "退款率"].forEach((header, index) => {
        const cell = sheet.getCell(rowNumber, index + 1);
        cell.value = header;
        styleCell(cell, { fill: "FFEAF2F8", bold: true, align: "center" });
      });
      rowNumber += 1;

      section.rows.forEach((item) => {
        [item.affiliation, item.account, item.sales, item.refunds, item.refundRate].forEach((value, index) => {
          const cell = sheet.getCell(rowNumber, index + 1);
          cell.value = value;
          styleCell(cell, { align: index < 2 ? "left" : "right" });
        });
        sheet.getCell(rowNumber, 3).numFmt = "#,##0.00";
        sheet.getCell(rowNumber, 4).numFmt = "#,##0.00;[Red]-#,##0.00";
        sheet.getCell(rowNumber, 5).numFmt = "0.00%;[Red]-0.00%";
        rowNumber += 1;
      });
      rowNumber += 1;
    });

    sheet.columns = [{ width: 28 }, { width: 32 }, { width: 15 }, { width: 15 }, { width: 12 }];

    if (record.unresolved?.length) {
      const unresolvedSheet = workbook.addWorksheet("未映射明细", { views: [{ showGridLines: false, state: "frozen", ySplit: 1 }] });
      ["源表行号", "渠道", "直播账号", "原归属值", "原因"].forEach((header, index) => {
        const cell = unresolvedSheet.getCell(1, index + 1);
        cell.value = header;
        styleCell(cell, { fill: "FFEAF2F8", bold: true, align: "center" });
      });
      record.unresolved.forEach((item, index) => {
        [item.rowNumber, item.channel, item.account, item.affiliation, item.reason].forEach((value, column) => {
          const cell = unresolvedSheet.getCell(index + 2, column + 1);
          cell.value = value;
          styleCell(cell);
        });
      });
      unresolvedSheet.columns = [{ width: 12 }, { width: 12 }, { width: 30 }, { width: 28 }, { width: 24 }];
    }
    return workbook;
  }

  function exportFileName(record) {
    return `渠道月度汇总-${Number(record?.month) || ""}月.xlsx`;
  }

  return {
    DETAIL_SHEET,
    ROSTER_SHEET,
    MAPPING_SHEET,
    CHANNELS,
    ALL_CHANNELS_LABEL,
    OUTPUT_CHANNELS,
    rawValue,
    readAccountMapping,
    readRoster,
    summarizeTransactions,
    addAllChannelsSummary,
    summarizeWorkbook,
    createSummaryWorkbook,
    exportFileName
  };
});
