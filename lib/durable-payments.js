"use strict";
// Documents remain queryable after completion so a lost HTTP response can be retried.
module.exports = function durablePayments(firestore) {
  const collection = firestore.collection("payment_pending");
  return {
    async set(id, data) {
      await collection.doc(id).set({ ...data, archived: false });
    },
    async get(id) {
      const snap = await collection.doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    async values() {
      const snap = await collection.where("archived", "==", false).get();
      return snap.docs.map((d) => ({ ...d.data(), token: d.id }));
    },
    async delete(id) {
      await collection
        .doc(id)
        .update({ archived: true, archivedAt: new Date().toISOString() });
    },
    async clear() {
      /* Never discard another operator's unresolved payments. */
    },
  };
};
