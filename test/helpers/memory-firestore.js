"use strict";
// Deterministic transactional double. Real Firestore integration remains a separate check.
class MemoryFirestore {
  constructor(seed = {}) {
    this.records = new Map(Object.entries(seed));
    this.tail = Promise.resolve();
  }
  collection(path) {
    const db = this;
    const query = (filters = [], limit = Infinity, order = null) => ({
      doc(id) {
        if (!id || String(id).includes("/"))
          throw new Error("Invalid document id");
        return db.ref(`${path}/${id}`);
      },
      where(key, op, value) {
        if (op !== "==") throw new Error("Unsupported query");
        return query([...filters, [key, value]], limit);
      },
      limit(n) {
        return query(filters, n, order);
      },
      orderBy(key, direction) {
        return query(filters, limit, [key, direction]);
      },
      async get() {
        const docs = [...db.records.keys()]
          .filter(
            (k) =>
              k.startsWith(path + "/") &&
              k.split("/").length === path.split("/").length + 1,
          )
          .map((k) => db.snapshot(k))
          .filter((s) => filters.every(([k, v]) => s.data()[k] === v))
          .sort((a, b) =>
            order
              ? String(a.data()[order[0]]).localeCompare(
                  String(b.data()[order[0]]),
                ) * (order[1] === "desc" ? -1 : 1)
              : 0,
          )
          .slice(0, limit);
        return { docs, size: docs.length };
      },
    });
    return query();
  }
  snapshot(path) {
    const v = this.records.get(path);
    return {
      id: path.split("/").pop(),
      exists: v !== undefined,
      data: () => structuredClone(v),
      ref: this.ref(path),
    };
  }
  ref(path) {
    const db = this;
    return {
      id: path.split("/").pop(),
      path,
      collection(name) {
        return db.collection(`${path}/${name}`);
      },
      async get() {
        return db.snapshot(path);
      },
      async set(data, options) {
        db.records.set(
          path,
          options?.merge
            ? { ...db.records.get(path), ...structuredClone(data) }
            : structuredClone(data),
        );
      },
      async update(data) {
        if (!db.records.has(path)) throw new Error("Missing document");
        db.records.set(path, {
          ...db.records.get(path),
          ...structuredClone(data),
        });
      },
      async delete() {
        db.records.delete(path);
      },
    };
  }
  batch() {
    const operations = [];
    return {
      set(ref, data, options) { operations.push([ref, data, options]); },
      commit: () => this.runTransaction(async tx => {
        for (const [ref, data, options] of operations) tx.set(ref, data, options);
      })
    };
  }
  runTransaction(fn) {
    const run = this.tail.then(async () => {
      const writes = [];
      let writing = false;
      const tx = {
        get: async (ref) => {
          if (writing) throw new Error("Read after write");
          return ref.get();
        },
        create: (ref, data) => {
          writing = true;
          writes.push(["create", ref, data]);
        },
        set: (ref, data, options) => {
          writing = true;
          writes.push(["set", ref, data, options]);
        },
        update: (ref, data) => {
          writing = true;
          writes.push(["update", ref, data]);
        },
        delete: (ref) => {
          writing = true;
          writes.push(["delete", ref]);
        },
      };
      const result = await fn(tx);
      for (const [op, ref] of writes) {
        if (op === "create" && this.records.has(ref.path))
          throw new Error("Already exists");
        if (op === "update" && !this.records.has(ref.path))
          throw new Error("Missing document");
      }
      for (const [op, ref, data, options] of writes) {
        if (op === "create") await ref.set(data);
        else await ref[op](data, options);
      }
      return result;
    });
    this.tail = run.catch(() => {});
    return run;
  }
}
module.exports = MemoryFirestore;
