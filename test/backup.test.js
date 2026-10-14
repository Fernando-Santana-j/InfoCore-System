const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBackup, verifyBackup, decode } = require("../lib/backup-format");
const { Timestamp, GeoPoint } = require("firebase-admin/firestore");
test("backup restores typed nested documents and detects corruption", () => {
  const source = [
    {
      path: "operator_work/a/held_sales/b",
      data: {
        at: new Timestamp(10, 20),
        geo: new GeoPoint(1, 2),
        bytes: Buffer.from("image"),
        nested: [{ name: "SSD", $type: "user-value" }],
        value: NaN,
      },
    },
  ];
  const backup = buildBackup(source);
  assert.equal(verifyBackup(backup), 1);
  const restored = backup.documents.map((d) => ({
    path: d.path,
    data: decode(d.data, {
      timestamp: (s, n) => new Timestamp(s, n),
      geo: (a, b) => new GeoPoint(a, b),
    }),
  }));
  assert.equal(buildBackup(restored).sha256, backup.sha256);
  backup.documents[0].path = "sales/changed";
  assert.throws(() => verifyBackup(backup), /Checksum/);
});
