"use strict";
const { createHash } = require("node:crypto");
const text = (v, max = 300) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const money = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e9)
    throw new Error("Valor inválido.");
  return Math.round(n * 100) / 100;
};
const date = (v) => {
  const s = text(v, 10);
  if (
    s &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(s) ||
      new Date(s + "T12:00:00Z").toISOString().slice(0, 10) !== s)
  )
    throw new Error("Data inválida.");
  return s;
};
const hash = (value) =>
  createHash("sha256").update(String(value)).digest("hex");
function equipmentId(serial) {
  const s = text(serial, 100).toUpperCase().replace(/\s/g, "");
  return s ? hash(s) : "";
}
function operationalFields(row = {}) {
  return {
    serial: text(row.serial, 100),
    equipmentId: text(row.equipmentId, 64),
    technician: text(row.technician, 120),
    dueDate: text(row.dueDate, 10),
    nextAction: text(row.nextAction),
    blockedReason: text(row.blockedReason),
    followUpDate: text(row.followUpDate, 10),
    warrantyUntil: text(row.warrantyUntil, 10),
    warrantyCoverage: text(row.warrantyCoverage, 1000),
    originalServiceId: text(row.originalServiceId, 100),
    returnCause: text(row.returnCause, 1000),
    laborHours: Number(row.laborHours) || 0,
    hourlyCost: Number(row.hourlyCost) || 0,
    reworkCost: Number(row.reworkCost) || 0,
    partsCost: Number(row.partsCost) || 0,
    delivery: row.delivery || null,
    blockedSince: row.blockedSince || null,
    blockedHours: row.blockedHours || {},
    operationalVersion: Number(row.operationalVersion) || 0,
  };
}
function canDeliver(row) {
  const d = row.delivery;
  return !!(
    d?.tested &&
    d?.accessoriesChecked &&
    d?.customerConfirmed &&
    text(d?.receivedBy) &&
    d?.confirmedAt
  );
}
function repairMetrics(rows, now = Date.now()) {
  const hours = (start, end) =>
    Math.max(
      0,
      (new Date(end).getTime() - new Date(start).getTime()) / 3600000,
    ) || 0;
  const delivered = rows.filter((r) => r.delivery?.confirmedAt);
  const blocked = Object.create(null);
  rows.forEach((r) => {
    Object.entries(r.blockedHours || {}).forEach(([k, v]) => {
      blocked[k] = (blocked[k] || 0) + Number(v || 0);
    });
    if (r.blockedReason && r.blockedSince)
      blocked[r.blockedReason] =
        (blocked[r.blockedReason] || 0) + hours(r.blockedSince, now);
  });
  return {
    total: rows.length,
    returnCount: rows.filter((r) => r.originalServiceId).length,
    returnRate: rows.length
      ? (rows.filter((r) => r.originalServiceId).length / rows.length) * 100
      : 0,
    averageHours: delivered.length
      ? delivered.reduce(
          (sum, r) => sum + hours(r.createdAt, r.delivery.confirmedAt),
          0,
        ) / delivered.length
      : 0,
    blockedHours: blocked,
    margins: rows.map((r) => ({
      id: r.id,
      code: r.code,
      estimatedRevenue: Number(r.estimateValue) || 0,
      cost:
        (Number(r.partsCost) || 0) +
        (Number(r.laborHours) || 0) * (Number(r.hourlyCost) || 0) +
        (Number(r.reworkCost) || 0),
      profit:
        (Number(r.estimateValue) || 0) -
        (Number(r.partsCost) || 0) -
        (Number(r.laborHours) || 0) * (Number(r.hourlyCost) || 0) -
        (Number(r.reworkCost) || 0),
    })),
  };
}
module.exports = {
  text,
  money,
  date,
  hash,
  equipmentId,
  operationalFields,
  canDeliver,
  repairMetrics,
};
