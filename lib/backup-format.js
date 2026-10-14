"use strict";
const { createHash } = require("node:crypto");
function encode(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value))
      return { $type: "number", value: String(value) };
    return value;
  }
  if (typeof value.toDate === "function" && Number.isInteger(value.seconds))
    return {
      $type: "timestamp",
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    };
  if (value instanceof Date)
    return { $type: "date", value: value.toISOString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return { $type: "bytes", value: Buffer.from(value).toString("base64") };
  if (value.constructor?.name === "DocumentReference")
    return { $type: "reference", path: value.path };
  if (value.constructor?.name === "GeoPoint")
    return {
      $type: "geo",
      latitude: value.latitude,
      longitude: value.longitude,
    };
  if (Array.isArray(value)) return { $type: "array", value: value.map(encode) };
  return {
    $type: "map",
    value: Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, encode(v)]),
    ),
  };
}
function decode(value, types = {}) {
  if (value === null || typeof value !== "object") return value;
  if (value.$type === "map")
    return Object.fromEntries(
      Object.entries(value.value).map(([k, v]) => [k, decode(v, types)]),
    );
  if (value.$type === "array") return value.value.map((v) => decode(v, types));
  if (value.$type === "timestamp")
    return types.timestamp
      ? types.timestamp(value.seconds, value.nanoseconds)
      : { $timestamp: [value.seconds, value.nanoseconds] };
  if (value.$type === "date") return new Date(value.value);
  if (value.$type === "bytes") return Buffer.from(value.value, "base64");
  if (value.$type === "reference")
    return types.reference
      ? types.reference(value.path)
      : { $reference: value.path };
  if (value.$type === "geo")
    return types.geo
      ? types.geo(value.latitude, value.longitude)
      : { $geo: [value.latitude, value.longitude] };
  if (value.$type === "number") return Number(value.value);
  throw new Error("Tipo de backup inválido.");
}
function buildBackup(documents) {
  const payload = documents
    .map((d) => ({ path: d.path, data: encode(d.data) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    documents: payload,
  };
}
function verifyBackup(backup) {
  if (backup.version !== 1 || !Array.isArray(backup.documents))
    throw new Error("Formato de backup inválido.");
  const digest = createHash("sha256")
    .update(JSON.stringify(backup.documents))
    .digest("hex");
  if (digest !== backup.sha256)
    throw new Error("Checksum inválido: arquivo alterado ou incompleto.");
  const seen = new Set();
  for (const d of backup.documents) {
    if (
      !d.path ||
      d.path.split("/").length % 2 !== 0 ||
      d.path.split("/").some((x) => !x) ||
      seen.has(d.path)
    )
      throw new Error("Caminho de documento inválido ou duplicado.");
    seen.add(d.path);
    decode(d.data);
  }
  return backup.documents.length;
}
module.exports = { encode, decode, buildBackup, verifyBackup };
